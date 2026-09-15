/**
 * Canvas overlay for mockup surface editing.
 *
 * When a single mockup frame is selected, every surface is outlined with a
 * labelled chip; clicking a chip selects that surface as the edit target.
 * The selected surface gets geometry handles (rect corners/edges for flat
 * surfaces, four corners for quad surfaces) whose drags commit through the
 * instance override in one transaction per gesture. Escape aborts the
 * gesture and restores the pre-drag geometry; Reset clears the override.
 *
 * Coordinate flow mirrors PerspectiveOverlay:
 *   screen → world (inverse camera) → frame-local (inverse worldMat) →
 *   template units (divide by the frame's template scale).
 */

import {
  getMockupTemplate,
  isMockupFrame,
  isValidMockupQuad,
  type MockupQuad,
  type MockupSurfaceDefinition,
  type MockupVec2,
  type NodeId,
  replaceMockupSurfaceOverride,
  setMockupSurfaceOverride,
} from '@varve/scene';
import {
  computeFloatingOrigin,
  screenDeltaToWorld,
  worldToScreen as sharedWorldToScreen,
} from '@varve/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getEditorViewport } from '../canvas/cameraState';
import { useEditor } from '../context';
import {
  clearMockupSurfaceSelection,
  getMockupSurfaceSelection,
  selectMockupSurface,
  subscribeMockupSurfaceSelection,
} from '../mockup/mockupSurfaceSelection';
import { effectiveSurface, surfacePlacement } from '../render/mockup/mockupIr';
import { nodeWorldTransform } from '../scene/world';
import './MockupSurfaceOverlay.css';

interface Props {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  selection: readonly NodeId[];
}

const HANDLE_HIT = 22;
const HANDLE_DOT = 5;
const MIN_SURFACE_SIZE = 4;

interface RectGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragKind =
  | { type: 'quad'; index: 0 | 1 | 2 | 3 }
  | { type: 'rect-corner'; index: 0 | 1 | 2 | 3 }
  | { type: 'rect-edge'; index: 0 | 1 | 2 | 3 };

function worldToLocal(
  dx: number,
  dy: number,
  worldMat: readonly [number, number, number, number, number, number],
): { x: number; y: number } {
  const [a, b, c, d] = worldMat;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
  return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
}

export function MockupSurfaceOverlay({ zoom, pan, cameraRotation, selection }: Props) {
  const editor = useEditor();
  const doc = editor.state.document;
  const [, redraw] = useState(0);
  const [drag, setDrag] = useState<{
    kind: DragKind;
    startClientX: number;
    startClientY: number;
    startRect: RectGeometry;
    startQuad: MockupQuad | null;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  useEffect(() => subscribeMockupSurfaceSelection(() => redraw((v) => v + 1)), []);

  const frameId = selection.length === 1 ? selection[0] : undefined;
  const frame = frameId ? doc.nodes[frameId] : undefined;
  const mockupFrame = frame && isMockupFrame(frame) ? frame : undefined;
  const template = mockupFrame ? getMockupTemplate(doc, mockupFrame.mockup.templateId) : undefined;

  // Keep the surface target honest: drop it when the frame/template is gone.
  const surfaceSelection = getMockupSurfaceSelection();
  useEffect(() => {
    if (!mockupFrame || !template) {
      clearMockupSurfaceSelection();
      return;
    }
    if (surfaceSelection && surfaceSelection.frameId !== mockupFrame.id) {
      clearMockupSurfaceSelection();
      return;
    }
    if (
      surfaceSelection &&
      !template.surfaces.some((surface) => surface.id === surfaceSelection.surfaceId)
    ) {
      clearMockupSurfaceSelection();
    }
  }, [mockupFrame, template, surfaceSelection]);

  const worldMat = mockupFrame ? nodeWorldTransform(doc, mockupFrame.id) : null;

  const scaleX = mockupFrame && template ? mockupFrame.w / template.outputWidth : 1;
  const scaleY = mockupFrame && template ? mockupFrame.h / template.outputHeight : 1;

  const templateToScreen = useCallback(
    (tx: number, ty: number): { x: number; y: number } | null => {
      if (!worldMat) return null;
      const [a, b, c, d, e, f] = worldMat;
      const lx = tx * scaleX;
      const ly = ty * scaleY;
      const wx = a * lx + c * ly + e;
      const wy = b * lx + d * ly + f;
      const viewport = getEditorViewport();
      const camera = { zoom, pan, rotation: cameraRotation };
      const origin = computeFloatingOrigin(camera, viewport);
      const [x, y] = sharedWorldToScreen(camera, wx, wy, viewport, origin);
      return { x, y };
    },
    [worldMat, scaleX, scaleY, zoom, pan, cameraRotation],
  );

  const beginDrag = useCallback(
    (kind: DragKind, surface: MockupSurfaceDefinition, e: React.PointerEvent) => {
      if (!mockupFrame) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      editor.beginTransaction();
      setDrag({
        kind,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startRect: {
          x: surface.x,
          y: surface.y,
          width: surface.width,
          height: surface.height,
        },
        startQuad: surface.quad ? (surface.quad.map((p) => ({ ...p })) as MockupQuad) : null,
      });
    },
    [editor, mockupFrame],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !mockupFrame || !worldMat || !surfaceSelection) return;
      const [worldDx, worldDy] = screenDeltaToWorld(
        { zoom, pan, rotation: cameraRotation },
        e.clientX - drag.startClientX,
        e.clientY - drag.startClientY,
      );
      const local = worldToLocal(worldDx, worldDy, worldMat);
      const dx = scaleX > 0 ? local.x / scaleX : 0;
      const dy = scaleY > 0 ? local.y / scaleY : 0;
      const patch = computeDragPatch(drag, dx, dy);
      if (!patch) return;
      editor.updateDoc((current) =>
        setMockupSurfaceOverride(current, mockupFrame.id, surfaceSelection.surfaceId, patch),
      );
    },
    [
      drag,
      mockupFrame,
      worldMat,
      surfaceSelection,
      editor,
      zoom,
      pan,
      cameraRotation,
      scaleX,
      scaleY,
    ],
  );

  const endDrag = useCallback(
    (committed: boolean) => {
      if (!drag) return;
      setDrag(null);
      if (committed) editor.commitTransaction();
      else editor.abortTransaction();
    },
    [drag, editor],
  );

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, endDrag]);

  if (!mockupFrame || !template || !worldMat) return null;
  if (!surfaceSelection) {
    return (
      <div className="mockup-overlay">
        {template.surfaces.map((surface) => {
          const surfaceOverride = mockupFrame.mockup.overrides?.[surface.id];
          const surfaceEffective = effectiveSurface(surface, surfaceOverride);
          const center = templateToScreen(
            surfaceEffective.x + surfaceEffective.width / 2,
            surfaceEffective.y + surfaceEffective.height / 2,
          );
          const outline = surfaceOutline(surfaceEffective, templateToScreen);
          if (!outline) return null;
          return (
            <div key={surface.id}>
              <svg className="mockup-overlay__outline" aria-hidden="true">
                <polygon points={outline} />
              </svg>
              {center && (
                <button
                  type="button"
                  className="mockup-overlay__chip"
                  style={{ left: center.x, top: center.y }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={() =>
                    selectMockupSurface({ frameId: mockupFrame.id, surfaceId: surface.id })
                  }
                >
                  {surface.name}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const selectedSurface = template.surfaces.find((s) => s.id === surfaceSelection.surfaceId);
  if (!selectedSurface) return null;
  const override = mockupFrame.mockup.overrides?.[selectedSurface.id];
  const effective = effectiveSurface(selectedSurface, override);
  const placement = surfacePlacement(override);

  const outlinePoints =
    effective.kind === 'quad' && effective.quad
      ? (effective.quad.map((p) => templateToScreen(p.x, p.y)) as Array<{
          x: number;
          y: number;
        } | null>)
      : rectCorners(effective).map((p) => templateToScreen(p.x, p.y));

  if (outlinePoints.some((p) => !p)) return null;

  const handles: Array<{
    key: string;
    point: { x: number; y: number };
    kind: DragKind;
    label: string;
  }> = [];
  if (effective.kind === 'quad' && effective.quad) {
    const labels = ['top left', 'top right', 'bottom right', 'bottom left'] as const;
    effective.quad.forEach((p, index) => {
      const screen = templateToScreen(p.x, p.y);
      if (screen) {
        handles.push({
          key: `q${index}`,
          point: screen,
          kind: { type: 'quad', index: index as 0 | 1 | 2 | 3 },
          label: `Quad corner ${labels[index]}`,
        });
      }
    });
  } else {
    const cornerLabels = ['top left', 'top right', 'bottom right', 'bottom left'] as const;
    rectCorners(effective).forEach((p, index) => {
      const screen = templateToScreen(p.x, p.y);
      if (screen) {
        handles.push({
          key: `c${index}`,
          point: screen,
          kind: { type: 'rect-corner', index: index as 0 | 1 | 2 | 3 },
          label: `Corner ${cornerLabels[index]}`,
        });
      }
    });
    const edgeLabels = ['top', 'right', 'bottom', 'left'] as const;
    rectEdges(effective).forEach((p, index) => {
      const screen = templateToScreen(p.x, p.y);
      if (screen) {
        handles.push({
          key: `e${index}`,
          point: screen,
          kind: { type: 'rect-edge', index: index as 0 | 1 | 2 | 3 },
          label: `Edge ${edgeLabels[index]}`,
        });
      }
    });
  }

  return (
    <div className="mockup-overlay">
      <svg className="mockup-overlay__outline mockup-overlay__outline--active" aria-hidden="true">
        <polygon points={outlinePoints.map((p) => `${p!.x},${p!.y}`).join(' ')} />
      </svg>

      {handles.map((handle) => (
        <button
          type="button"
          key={handle.key}
          className="mockup-overlay__handle"
          style={{
            left: handle.point.x - HANDLE_HIT / 2,
            top: handle.point.y - HANDLE_HIT / 2,
            width: HANDLE_HIT,
            height: HANDLE_HIT,
          }}
          aria-label={`${selectedSurface.name}: ${handle.label}`}
          onPointerDown={(e) => beginDrag(handle.kind, effective, e)}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              endDrag(false);
            }
          }}
        >
          <span
            className="mockup-overlay__handle-dot"
            style={{ width: HANDLE_DOT, height: HANDLE_DOT }}
          />
        </button>
      ))}

      <div className="mockup-overlay__toolbar" role="toolbar" aria-label="Mockup surface actions">
        <span className="mockup-overlay__toolbar-label">
          {selectedSurface.name}
          {effective.kind === 'quad'
            ? ' · perspective'
            : effective.kind === 'cylindrical'
              ? ' · bounded cylinder'
              : ''}
        </span>
        <button
          type="button"
          className="mockup-overlay__action"
          onClick={() => {
            editor.beginTransaction();
            try {
              editor.updateDoc((current) =>
                replaceMockupSurfaceOverride(current, mockupFrame.id, selectedSurface.id, null),
              );
            } finally {
              editor.commitTransaction();
            }
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="mockup-overlay__action mockup-overlay__action--primary"
          onClick={() => clearMockupSurfaceSelection()}
        >
          Done
        </button>
      </div>

      {placement.rotation !== 0 || placement.flipH || placement.flipV ? (
        <p className="mockup-overlay__placement" role="status">
          Artwork rotated/flipped within surface
        </p>
      ) : null}
    </div>
  );
}

function computeDragPatch(
  drag: { kind: DragKind; startRect: RectGeometry; startQuad: MockupQuad | null },
  dx: number,
  dy: number,
): { x?: number; y?: number; width?: number; height?: number; quad?: MockupQuad } | null {
  if (drag.kind.type === 'quad') {
    if (!drag.startQuad) return null;
    const quad = drag.startQuad.map((p, index) =>
      index === drag.kind.index ? { x: p.x + dx, y: p.y + dy } : p,
    ) as MockupQuad;
    if (!isValidMockupQuad(quad)) return null;
    return { quad };
  }
  const rect = drag.startRect;
  let { x, y, width, height } = rect;
  if (drag.kind.type === 'rect-corner') {
    if (drag.kind.index === 0) {
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
    } else if (drag.kind.index === 1) {
      y += dy;
      width += dx;
      height -= dy;
    } else if (drag.kind.index === 2) {
      width += dx;
      height += dy;
    } else {
      x += dx;
      width -= dx;
      height += dy;
    }
  } else {
    if (drag.kind.index === 0) {
      y += dy;
      height -= dy;
    } else if (drag.kind.index === 1) {
      width += dx;
    } else if (drag.kind.index === 2) {
      height += dy;
    } else {
      x += dx;
      width -= dx;
    }
  }
  if (width < MIN_SURFACE_SIZE || height < MIN_SURFACE_SIZE) return null;
  return { x, y, width, height };
}

function rectCorners(surface: {
  x: number;
  y: number;
  width: number;
  height: number;
}): MockupVec2[] {
  return [
    { x: surface.x, y: surface.y },
    { x: surface.x + surface.width, y: surface.y },
    { x: surface.x + surface.width, y: surface.y + surface.height },
    { x: surface.x, y: surface.y + surface.height },
  ];
}

function rectEdges(surface: { x: number; y: number; width: number; height: number }): MockupVec2[] {
  return [
    { x: surface.x + surface.width / 2, y: surface.y },
    { x: surface.x + surface.width, y: surface.y + surface.height / 2 },
    { x: surface.x + surface.width / 2, y: surface.y + surface.height },
    { x: surface.x, y: surface.y + surface.height / 2 },
  ];
}

function surfaceOutline(
  surface: MockupSurfaceDefinition,
  toScreen: (x: number, y: number) => { x: number; y: number } | null,
): string | null {
  const points =
    surface.kind === 'quad' && surface.quad
      ? surface.quad.map((p) => toScreen(p.x, p.y))
      : rectCorners(surface).map((p) => toScreen(p.x, p.y));
  if (points.some((p) => !p)) return null;
  return points.map((p) => `${p!.x},${p!.y}`).join(' ');
}
