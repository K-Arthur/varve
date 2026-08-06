/**
 * WarpOverlay — direct-manipulation cage/mesh editing for the active warp
 * modifier (skew / perspective / envelope / mesh / bend).
 *
 * Architecture mirrors SelectionOverlay: the overlay owns handle
 * interactions (React pointer events + SVG), mutations go through
 * updateDoc inside a begin/commit transaction (one undo step per drag), and
 * Escape aborts the in-flight drag (abortTransaction).
 *
 * Handle sizing is screen-constant (never scales away with zoom). Snap
 * targets: the pixel grid (when snapping is enabled).
 *
 * Foldover policy: after each committed drag, analyzeFoldover is evaluated;
 * 'prevent' reverts the drag, 'warn' shows a text+icon warning (never
 * color-only), 'allow' accepts freely.
 */

import {
  analyzeFoldover,
  type BendModifier,
  type EnvelopeModifier,
  type MeshWarpModifier,
  type NormalizedPoint,
  type PerspectiveModifier,
  type SkewModifier,
  type WarpModifier,
} from '@varve/engine';
import { nodeLocalBoundsSource, nodeWorldTransform, updateWarp, warpsOnNode } from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import {
  applyAffine,
  computeFloatingOrigin,
  worldToScreen as sharedWorldToScreen,
} from '@varve/shared';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { CANVAS_INTERACTIVE_OVERLAY_Z_INDEX } from '../canvas/overlayZIndex';
import { useEditor } from '../context';

const HANDLE_SIZE = 7;

type DragApply = (
  dxWorld: number,
  dyWorld: number,
  m: WarpModifier,
) => Record<string, unknown> | null;

export function WarpOverlay({
  zoom,
  pan,
  cameraRotation,
}: {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}) {
  const { state, updateDoc, beginTransaction, commitTransaction, abortTransaction } = useEditor();
  const doc = state.document;
  const target = state.warpEdit;
  const [drag, setDrag] = useState<{
    key: string;
    startClient: { x: number; y: number };
    apply: DragApply;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const [selectedPoints, setSelectedPoints] = useState<Set<number>>(new Set());
  const [foldover, setFoldover] = useState<{ foldover: boolean; severity: string } | null>(null);

  const node = target ? doc.nodes[target.nodeId] : undefined;
  const modifier =
    target && node ? (warpsOnNode(node).find((w) => w.id === target.modifierId) ?? null) : null;

  const sourceBounds: Rect | null = node ? nodeLocalBoundsSource(node, doc) : null;
  const worldMat: Affine | null = target ? nodeWorldTransform(doc, target.nodeId) : null;

  useEffect(() => {
    setSelectedPoints(new Set());
    setFoldover(null);
  }, [target?.nodeId, target?.modifierId]);

  const worldDeltaToLocal = useCallback(
    (dx: number, dy: number): { x: number; y: number } => {
      if (!worldMat) return { x: 0, y: 0 };
      const a = worldMat[0];
      const b = worldMat[1];
      const c = worldMat[2];
      const d = worldMat[3];
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-12) return { x: 0, y: 0 };
      return { x: (d * dx - c * dy) / det, y: (-b * dx + a * dy) / det };
    },
    [worldMat],
  );

  const normFromLocal = useCallback(
    (lx: number, ly: number): NormalizedPoint => {
      if (!sourceBounds || sourceBounds.w === 0 || sourceBounds.h === 0) return { x: 0.5, y: 0.5 };
      return {
        x: (lx - sourceBounds.x) / sourceBounds.w,
        y: (ly - sourceBounds.y) / sourceBounds.h,
      };
    },
    [sourceBounds],
  );

  const endDrag = useCallback(
    (ok: boolean) => {
      if (!dragRef.current) return;
      setDrag(null);
      if (ok) {
        commitTransaction();
        if (target && sourceBounds) {
          const nodeAtEnd = doc.nodes[target.nodeId];
          const analysis = analyzeFoldover(
            sourceBounds,
            nodeAtEnd ? warpsOnNode(nodeAtEnd) : undefined,
            {
              settings: (
                nodeAtEnd as { warpSettings?: import('@varve/engine').WarpSettings } | undefined
              )?.warpSettings,
            },
          );
          setFoldover({ foldover: analysis.foldover, severity: analysis.severity });
          const policy =
            (nodeAtEnd as { warpSettings?: { foldoverPolicy?: string } } | undefined)?.warpSettings
              ?.foldoverPolicy ?? 'warn';
          if (analysis.foldover && policy === 'prevent') {
            abortTransaction();
          }
        }
      } else {
        abortTransaction();
      }
    },
    [commitTransaction, abortTransaction, target, sourceBounds, doc],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dragRef.current) {
        e.preventDefault();
        endDrag(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endDrag]);

  if (!target || !node || !modifier || !sourceBounds || !worldMat) return null;

  const settings = (node as { warpSettings?: import('@varve/engine').WarpSettings }).warpSettings;
  const foldoverPolicy = settings?.foldoverPolicy ?? 'warn';
  const foldoverVisible = foldover?.foldover && foldoverPolicy !== 'prevent';

  const startHandleDrag = (e: React.PointerEvent, key: string, apply: DragApply) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginTransaction();
    setDrag({ key, startClient: { x: e.clientX, y: e.clientY }, apply });
  };

  const handleDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !modifier) return;
    const patch = d.apply(e.clientX - d.startClient.x, e.clientY - d.startClient.y, modifier);
    if (!patch) return;
    updateDoc((doc2) => updateWarp(doc2, target!.nodeId, target!.modifierId, patch as never));
  };

  const snapToPixelGrid = (p: NormalizedPoint): NormalizedPoint => {
    if (!state.snapEnabled || !sourceBounds || sourceBounds.w === 0 || sourceBounds.h === 0)
      return p;
    const step = state.snapGrid > 0 ? state.snapGrid : 1;
    return {
      x: Math.round((p.x * sourceBounds.w) / step) * (step / sourceBounds.w),
      y: Math.round((p.y * sourceBounds.h) / step) * (step / sourceBounds.h),
    };
  };

  const toScreen = (lx: number, ly: number): { x: number; y: number } => {
    const w = applyAffine(worldMat, [lx, ly]);
    return worldToScreen(w[0], w[1], zoom, pan, cameraRotation);
  };

  const normToScreen = (p: NormalizedPoint): { x: number; y: number } =>
    toScreen(sourceBounds.x + p.x * sourceBounds.w, sourceBounds.y + p.y * sourceBounds.h);

  const cagePoints = (m: WarpModifier): Array<[number, number]> => {
    const c = modifierCorners(m);
    return [c.tl, c.tr, c.br, c.bl].map((corner) => {
      const s = normToScreen(corner);
      return [s.x, s.y];
    });
  };

  const modifierCorners = (m: WarpModifier): PerspectiveModifier['corners'] => {
    switch (m.kind) {
      case 'perspective':
      case 'envelope':
        return m.corners;
      case 'skew':
        return skewCorners(m);
      default:
        return { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
    }
  };

  const skewCorners = (m: SkewModifier): PerspectiveModifier['corners'] => {
    const kx = Math.tan((m.skewX * Math.PI) / 180);
    const ky = Math.tan((m.skewY * Math.PI) / 180);
    const ox = m.origin.x;
    const oy = m.origin.y;
    const rx = sourceBounds.w === 0 ? 1 : sourceBounds.h / sourceBounds.w;
    const ry = sourceBounds.h === 0 ? 1 : sourceBounds.w / sourceBounds.h;
    const mkV = (x: number, y: number): NormalizedPoint => ({
      x: ox + (x - ox) + kx * (y - oy) * rx,
      y: oy + (y - oy) + ky * (x - ox) * ry,
    });
    return { tl: mkV(0, 0), tr: mkV(1, 0), br: mkV(1, 1), bl: mkV(0, 1) };
  };

  const cornerDrag =
    (corner: keyof PerspectiveModifier['corners']): DragApply =>
    (dxW, dyW, m) => {
      if (m.kind !== 'perspective' && m.kind !== 'envelope') return null;
      const local = worldDeltaToLocal(dxW, dyW);
      const delta = normFromLocal(local.x, local.y);
      const current = m.corners[corner];
      const snapped = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
      return { corners: { ...m.corners, [corner]: snapped } };
    };

  const renderHandle = (
    key: string,
    point: NormalizedPoint,
    onDown: (e: React.PointerEvent) => void,
    size = HANDLE_SIZE,
  ) => {
    const s = normToScreen(point);
    return (
      <g key={key} transform={`translate(${s.x} ${s.y})`}>
        <rect
          x={-size - 3}
          y={-size - 3}
          width={(size + 3) * 2}
          height={(size + 3) * 2}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'move' }}
          onPointerDown={onDown}
          aria-label={`warp handle ${key}`}
        />
        <rect
          className="warp-overlay__handle"
          x={-size / 2}
          y={-size / 2}
          width={size}
          height={size}
          fill="var(--color-interactive-default)"
          stroke="var(--color-surface-overlay)"
          strokeWidth={1}
          rx={1}
          style={{ pointerEvents: 'none' }}
        />
      </g>
    );
  };

  const cage = cagePoints(modifier);
  const polygon = cage.map(([x, y]) => `${x},${y}`).join(' ');

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
      }}
      onPointerMove={handleDragMove}
      onPointerUp={() => {
        if (dragRef.current) endDrag(true);
      }}
      onPointerCancel={() => {
        if (dragRef.current) endDrag(false);
      }}
      role="presentation"
    >
      <polygon
        className="warp-overlay__cage"
        points={polygon}
        fill="none"
        stroke="var(--color-interactive-default)"
        strokeWidth={1.5 / Math.max(1, zoom * 0.5)}
        strokeDasharray="6 4"
      />

      {modifier.kind === 'skew' && (
        <SkewHandles
          modifier={modifier}
          startHandleDrag={startHandleDrag}
          toScreen={toScreen}
          cagePoints={cagePoints}
          polygonPoints={polygon}
          sourceBounds={sourceBounds}
          normFromLocal={normFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {modifier.kind === 'perspective' &&
        (['tl', 'tr', 'br', 'bl'] as const).map((c) =>
          renderHandle(`corner-${c}`, modifier.corners[c], (e) =>
            startHandleDrag(e, `corner-${c}`, cornerDrag(c)),
          ),
        )}

      {modifier.kind === 'envelope' && (
        <EnvelopeHandles
          modifier={modifier as EnvelopeModifier}
          renderHandle={renderHandle}
          startHandleDrag={startHandleDrag}
          normToScreen={normToScreen}
          snapToPixelGrid={snapToPixelGrid}
          normFromLocal={normFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {modifier.kind === 'mesh-warp' && (
        <MeshHandles
          modifier={modifier as MeshWarpModifier}
          selectedPoints={selectedPoints}
          setSelectedPoints={setSelectedPoints}
          startHandleDrag={startHandleDrag}
          normToScreen={normToScreen}
          snapToPixelGrid={snapToPixelGrid}
          normFromLocal={normFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
          zoom={zoom}
        />
      )}

      {modifier.kind === 'bend' && (
        <BendHandles
          modifier={modifier as BendModifier}
          startHandleDrag={startHandleDrag}
          sourceBounds={sourceBounds}
          worldMat={worldMat}
          zoom={zoom}
          pan={pan}
          cameraRotation={cameraRotation}
          normFromLocal={normFromLocal}
          worldDeltaToLocal={worldDeltaToLocal}
        />
      )}

      {foldoverVisible && (
        <g transform="translate(12 12)">
          <rect
            x={0}
            y={0}
            width={230}
            height={34}
            rx={6}
            fill="var(--color-surface-raised)"
            stroke="var(--color-feedback-warning)"
          />
          <text x={10} y={21} fontSize={12} fill="var(--color-feedback-warning)">
            {foldover!.severity === 'severe'
              ? 'Severe foldover — geometry overlaps'
              : 'Foldover — geometry overlaps'}
          </text>
        </g>
      )}
    </svg>
  );
}

function worldToScreen(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const origin = computeFloatingOrigin({ zoom, pan, rotation }, viewport);
  const [x, y] = sharedWorldToScreen({ zoom, pan, rotation }, wx, wy, viewport, origin);
  return { x, y };
}

function SkewHandles({
  modifier,
  startHandleDrag,
  toScreen,
  cagePoints,
  polygonPoints,
  sourceBounds,
  normFromLocal,
  worldDeltaToLocal,
}: {
  modifier: WarpModifier;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  toScreen: (lx: number, ly: number) => { x: number; y: number };
  cagePoints: (m: WarpModifier) => Array<[number, number]>;
  polygonPoints: string;
  sourceBounds: Rect;
  normFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier as SkewModifier;
  const corners = cagePoints(modifier);
  const mids: Array<[number, number]> = [
    [(corners[0]![0] + corners[1]![0]) / 2, (corners[0]![1] + corners[1]![1]) / 2],
    [(corners[1]![0] + corners[2]![0]) / 2, (corners[1]![1] + corners[2]![1]) / 2],
    [(corners[2]![0] + corners[3]![0]) / 2, (corners[2]![1] + corners[3]![1]) / 2],
    [(corners[3]![0] + corners[0]![0]) / 2, (corners[3]![1] + corners[0]![1]) / 2],
  ];
  const pivot = toScreen(
    sourceBounds.x + m.origin.x * sourceBounds.w,
    sourceBounds.y + m.origin.y * sourceBounds.h,
  );
  const handle = (key: string, world: [number, number], axis: 'x' | 'y') => (
    <g key={key} transform={`translate(${world[0]} ${world[1]})`}>
      <rect
        x={-10}
        y={-10}
        width={20}
        height={20}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
        onPointerDown={(e) =>
          startHandleDrag(e, key, (dxW, dyW, mm) => {
            if (mm.kind !== 'skew') return null;
            const local = worldDeltaToLocal(dxW, dyW);
            const delta = normFromLocal(local.x, local.y);
            if (axis === 'x') {
              return { skewX: Math.max(-89.9, Math.min(89.9, mm.skewX + delta.x * 60)) };
            }
            return { skewY: Math.max(-89.9, Math.min(89.9, mm.skewY - delta.y * 60)) };
          })
        }
      />
      <rect
        x={-4}
        y={-4}
        width={8}
        height={8}
        fill="var(--color-interactive-default)"
        stroke="var(--color-surface-overlay)"
        rx={1}
        transform="rotate(45)"
      />
    </g>
  );
  return (
    <>
      <polygon
        points={polygonPoints}
        fill="var(--color-interactive-default)"
        fillOpacity={0.08}
        stroke="none"
      />
      <circle
        cx={pivot.x}
        cy={pivot.y}
        r={3}
        fill="#fff"
        stroke="var(--color-interactive-default)"
      />
      {handle('skew-x', mids[0]!, 'x')}
      {handle('skew-x-bottom', mids[2]!, 'x')}
      {handle('skew-y', mids[1]!, 'y')}
      {handle('skew-y-left', mids[3]!, 'y')}
    </>
  );
}

function EnvelopeHandles({
  modifier,
  renderHandle,
  startHandleDrag,
  normToScreen,
  snapToPixelGrid,
  normFromLocal,
  worldDeltaToLocal,
}: {
  modifier: EnvelopeModifier;
  renderHandle: (
    key: string,
    point: NormalizedPoint,
    onDown: (e: React.PointerEvent) => void,
    size?: number,
  ) => React.ReactNode;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  normToScreen: (p: NormalizedPoint) => { x: number; y: number };
  snapToPixelGrid: (p: NormalizedPoint) => NormalizedPoint;
  normFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier;
  const edgeCurve = (edge: 'top' | 'right' | 'bottom' | 'left'): string => {
    const pts = edgePoints(edge);
    const out: string[] = [];
    for (let t = 0; t <= 20; t++) {
      const u = t / 20;
      const uu = (1 - u) ** 2;
      const tt = u * u;
      const bx =
        (1 - u) * uu * pts[0]!.x +
        3 * uu * u * pts[1]!.x +
        3 * (1 - u) * tt * pts[2]!.x +
        tt * u * pts[3]!.x;
      const by =
        (1 - u) * uu * pts[0]!.y +
        3 * uu * u * pts[1]!.y +
        3 * (1 - u) * tt * pts[2]!.y +
        tt * u * pts[3]!.y;
      const s = normToScreen({ x: bx, y: by });
      out.push(`${s.x},${s.y}`);
    }
    return out.join(' ');
  };
  const edgePoints = (edge: 'top' | 'right' | 'bottom' | 'left'): NormalizedPoint[] => {
    const c = m.corners;
    const e = m.edges;
    switch (edge) {
      case 'top':
        return [c.tl, e.top[0], e.top[1], c.tr];
      case 'right':
        return [c.tr, e.right[0], e.right[1], c.br];
      case 'bottom':
        return [c.br, e.bottom[0], e.bottom[1], c.bl];
      case 'left':
        return [c.bl, e.left[0], e.left[1], c.tl];
    }
  };
  const edgeHandle = (edge: 'top' | 'right' | 'bottom' | 'left', i: 0 | 1) =>
    renderHandle(
      `edge-${edge}-${i}`,
      m.edges[edge][i]!,
      (e) =>
        startHandleDrag(e, `edge-${edge}-${i}`, (dxW, dyW, mm) => {
          if (mm.kind !== 'envelope') return null;
          const local = worldDeltaToLocal(dxW, dyW);
          const delta = normFromLocal(local.x, local.y);
          const current = mm.edges[edge][i]!;
          const next = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
          const edges = { ...mm.edges };
          edges[edge] = i === 0 ? [next, mm.edges[edge][1]] : [mm.edges[edge][0], next];
          return { edges };
        }),
      6,
    );
  const cornerHandle = (corner: 'tl' | 'tr' | 'br' | 'bl') =>
    renderHandle(`corner-${corner}`, m.corners[corner], (e) =>
      startHandleDrag(e, `corner-${corner}`, (dxW, dyW, mm) => {
        if (mm.kind !== 'envelope') return null;
        const local = worldDeltaToLocal(dxW, dyW);
        const delta = normFromLocal(local.x, local.y);
        const current = mm.corners[corner];
        const snapped = snapToPixelGrid({ x: current.x + delta.x, y: current.y + delta.y });
        return { corners: { ...mm.corners, [corner]: snapped } };
      }),
    );
  return (
    <>
      {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
        <polyline
          key={edge}
          points={edgeCurve(edge)}
          fill="none"
          stroke="var(--color-interactive-default)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      ))}
      {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
        <Fragment key={edge}>
          {edgeHandle(edge, 0)}
          {edgeHandle(edge, 1)}
        </Fragment>
      ))}
      {cornerHandle('tl')}
      {cornerHandle('tr')}
      {cornerHandle('br')}
      {cornerHandle('bl')}
    </>
  );
}

function MeshHandles({
  modifier,
  selectedPoints,
  setSelectedPoints,
  startHandleDrag,
  normToScreen,
  snapToPixelGrid,
  normFromLocal,
  worldDeltaToLocal,
  zoom,
}: {
  modifier: MeshWarpModifier;
  selectedPoints: Set<number>;
  setSelectedPoints: (s: Set<number>) => void;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  normToScreen: (p: NormalizedPoint) => { x: number; y: number };
  snapToPixelGrid: (p: NormalizedPoint) => NormalizedPoint;
  normFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
  zoom: number;
}) {
  const m = modifier;
  const { rows, columns, points } = m;
  const v = (r: number, c: number) => r * (columns + 1) + c;
  const lines: Array<[number, number]> = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < columns; c++) lines.push([v(r, c), v(r, c + 1)]);
  }
  for (let c = 0; c <= columns; c++) {
    for (let r = 0; r < rows; r++) lines.push([v(r, c), v(r + 1, c)]);
  }
  const dragSelected =
    (index: number): DragApply =>
    (dxW, dyW, mm) => {
      if (mm.kind !== 'mesh-warp') return null;
      const local = worldDeltaToLocal(dxW, dyW);
      const delta = normFromLocal(local.x, local.y);
      const set = selectedPoints.size > 0 ? selectedPoints : new Set([index]);
      const next = [...mm.points];
      for (const i of set) {
        const p = mm.points[i];
        if (!p) continue;
        next[i] = snapToPixelGrid({
          x: Math.max(0, Math.min(1, p.x + delta.x)),
          y: Math.max(0, Math.min(1, p.y + delta.y)),
        });
      }
      return { points: next };
    };
  return (
    <>
      {lines.map(([a, b]) => {
        const pa = normToScreen(points[a]!);
        const pb = normToScreen(points[b]!);
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke="var(--color-interactive-default)"
            strokeOpacity={0.45}
            strokeWidth={1 / Math.max(1, zoom * 0.5)}
          />
        );
      })}
      {points.map((p, i) => {
        const s = normToScreen(p);
        const selected = selectedPoints.has(i);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: mesh point index is the stable grid identity (row-major)
          <g key={`pt-${i}`} transform={`translate(${s.x} ${s.y})`}>
            <rect
              x={-8}
              y={-8}
              width={16}
              height={16}
              fill="transparent"
              style={{ pointerEvents: 'all', cursor: 'move' }}
              onPointerDown={(e) => {
                if (e.shiftKey) {
                  e.stopPropagation();
                  const next = new Set(selectedPoints);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setSelectedPoints(next);
                  return;
                }
                startHandleDrag(e, `mesh-${i}`, dragSelected(i));
              }}
              aria-label={`mesh point row ${Math.floor(i / (columns + 1)) + 1} of ${rows + 1}, column ${(i % (columns + 1)) + 1} of ${columns + 1}`}
            />
            <circle
              r={selected ? 4.5 : 3.2}
              fill={selected ? 'var(--color-surface-overlay)' : 'var(--color-interactive-default)'}
              stroke="var(--color-surface-overlay)"
              strokeWidth={selected ? 1 : 0.5}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}
    </>
  );
}

function BendHandles({
  modifier,
  startHandleDrag,
  sourceBounds,
  worldMat,
  zoom,
  pan,
  cameraRotation,
  normFromLocal,
  worldDeltaToLocal,
}: {
  modifier: BendModifier;
  startHandleDrag: (e: React.PointerEvent, key: string, apply: DragApply) => void;
  sourceBounds: Rect;
  worldMat: Affine;
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  normFromLocal: (x: number, y: number) => NormalizedPoint;
  worldDeltaToLocal: (dx: number, dy: number) => { x: number; y: number };
}) {
  const m = modifier;
  const w = applyAffine(worldMat, [sourceBounds.x + 0.5 * sourceBounds.w, sourceBounds.y]);
  const s = worldToScreen(w[0], w[1], zoom, pan, cameraRotation);
  return (
    <>
      <line
        x1={s.x}
        y1={s.y}
        x2={s.x}
        y2={s.y - 30}
        stroke="var(--color-interactive-default)"
        strokeWidth={1}
        strokeDasharray="3 3"
        strokeOpacity={0.6}
      />
      <g transform={`translate(${s.x} ${s.y - 30})`}>
        <rect
          x={-10}
          y={-10}
          width={20}
          height={20}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'ns-resize' }}
          onPointerDown={(e) =>
            startHandleDrag(e, 'bend-strength', (dxW, dyW, mm) => {
              if (mm.kind !== 'bend') return null;
              const local = worldDeltaToLocal(dxW, dyW);
              const delta = normFromLocal(local.x, local.y);
              const amount =
                mm.axis === 'horizontal' ? mm.amount - delta.y * 6 : mm.amount + delta.x * 6;
              return { amount: Math.max(-1, Math.min(1, amount)) };
            })
          }
        />
        <circle
          r={5}
          fill="var(--color-interactive-default)"
          stroke="var(--color-surface-overlay)"
          strokeWidth={1}
          style={{ pointerEvents: 'none' }}
        />
      </g>
      <text
        x={s.x + 8}
        y={s.y - 24}
        fontSize={11}
        fill="var(--color-text-primary-on-overlay)"
        style={{ pointerEvents: 'none' }}
      >
        {m.mode} {Math.round(m.amount * 100)}%
      </text>
    </>
  );
}
