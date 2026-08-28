/**
 * Position & Size section — X/Y/W/H/Rotation/Flip for the current selection.
 *
 * Multi-select: each axis uses `commonValue`; a differing axis renders the
 * NumberField in its `mixed` state (WCAG 1.4.1 — conveyed as "Mixed values"
 * via aria-valuetext, not by colour alone). Editing one axis commits via the
 * batch setters in ONE undo step and preserves the other axis per-node.
 *
 * Proportion lock: linking W/H preserves aspect ratio. When locked and the
 * user changes W, H is auto-updated (and vice versa) in a single undo step.
 *
 * Rotation: deg field (0-360, wraps at boundaries). Flip H/V buttons negate
 * the transform scale axis.
 *
 * Research basis: Figma/Sketch position/size panel with aspect lock.
 */

import type { SceneNode } from '@varve/scene';
import { decomposeAffineFull, formatCoordForRuler } from '@varve/shared';
import { Tooltip, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { nodeLocalBounds } from '../../../scene/nodeBounds';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export function PositionSizeSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  // Default aspect lock ON for image/raster nodes — they should preserve
  // aspect ratio unless the user explicitly unlocks.
  const isImageNode = nodes.some(
    (n) =>
      n.kind === 'shape' &&
      (n as import('@varve/scene').ShapeNode).fills?.some(
        (f) => f.type === 'image' || f.type === 'pattern',
      ),
  );
  const [locked, setLocked] = useState(isImageNode);

  // Sync aspect lock when selection changes between image and non-image nodes.
  useEffect(() => {
    setLocked(isImageNode);
  }, [isImageNode]);
  const bindingTriggerRef = useRef<HTMLDivElement>(null);

  const xRaw = commonValue(nodes, (n) => n.transform[4] ?? 0);
  const yRaw = commonValue(nodes, (n) => n.transform[5] ?? 0);
  // Only node kinds `nodeLocalBounds` can measure (shape/text/frame) get a W/H
  // editor — groups/adjustment nodes have no geometry of their own.
  const allSizable = nodes.every((n) => nodeLocalBounds(n) !== null);
  const wRaw: MaybeMixed<number> | null = allSizable
    ? commonValue(nodes, (n) => nodeLocalBounds(n)?.w ?? 0)
    : null;
  const hRaw: MaybeMixed<number> | null = allSizable
    ? commonValue(nodes, (n) => nodeLocalBounds(n)?.h ?? 0)
    : null;
  const rotationRaw = commonValue(nodes, (n) => n.rotation ?? 0);

  // Skew: decompose the affine transform to extract shear components.
  const skewRaw = commonValue(nodes, (n) => {
    const decomposed = decomposeAffineFull(n.transform);
    if (!decomposed) return 0;
    return (Math.atan(decomposed.skewX) * 180) / Math.PI;
  });
  const skewYRaw = commonValue(nodes, (n) => {
    const [a, b, c, d] = n.transform;
    const scaleY = Math.hypot(c, d);
    if (scaleY < 1e-10) return 0;
    const skewYFactor = -(a * c + b * d) / (scaleY * scaleY);
    return (Math.atan(skewYFactor) * 180) / Math.PI;
  });

  const activePage = editor.state.document.pages?.find(
    (p) => p.id === editor.state.document.activePageId,
  );
  const artboard = activePage ? { x: 0, y: 0, w: activePage.width, h: activePage.height } : null;
  const useArtboardCoords = editor.state.rulerMode === 'artboard' && artboard !== null;

  const toDisplayX = (worldX: number) =>
    useArtboardCoords
      ? formatCoordForRuler(
          worldX,
          'x',
          'artboard',
          artboard,
          activePage?.rulerOrigin
            ? [activePage.rulerOrigin.x, activePage.rulerOrigin.y]
            : undefined,
        )
      : worldX;
  const toDisplayY = (worldY: number) =>
    useArtboardCoords
      ? formatCoordForRuler(
          worldY,
          'y',
          'artboard',
          artboard,
          activePage?.rulerOrigin
            ? [activePage.rulerOrigin.x, activePage.rulerOrigin.y]
            : undefined,
        )
      : worldY;
  const fromDisplayX = (displayX: number) => {
    if (!useArtboardCoords || !artboard) return displayX;
    const origin = activePage?.rulerOrigin;
    return displayX + artboard.x + (origin?.x ?? 0);
  };
  const fromDisplayY = (displayY: number) => {
    if (!useArtboardCoords || !artboard) return displayY;
    const origin = activePage?.rulerOrigin;
    return displayY + artboard.y + (origin?.y ?? 0);
  };

  const aspectRatio = useCallback(() => {
    if (wRaw === null || hRaw === null || isMixed(wRaw) || isMixed(hRaw)) return null;
    if (hRaw === 0) return null;
    return wRaw / hRaw;
  }, [wRaw, hRaw]);

  // Line/arrow-specific: compute length and angle from from/to points.
  const isLineOrArrow =
    nodes.length > 0 &&
    nodes.every((n) => {
      if (n.kind !== 'shape') return false;
      return n.shape.kind === 'line' || n.shape.kind === 'arrow';
    });

  const lineShape = isLineOrArrow
    ? ((nodes[0] as import('@varve/scene').ShapeNode).shape as
        | { kind: 'line'; from: readonly [number, number]; to: readonly [number, number] }
        | { kind: 'arrow'; from: readonly [number, number]; to: readonly [number, number] })
    : null;

  const lineLength = lineShape
    ? Math.sqrt(
        (lineShape.to[0] - lineShape.from[0]) ** 2 + (lineShape.to[1] - lineShape.from[1]) ** 2,
      )
    : 0;

  const lineAngle = lineShape
    ? (Math.atan2(lineShape.to[1] - lineShape.from[1], lineShape.to[0] - lineShape.from[0]) * 180) /
      Math.PI
    : 0;

  const handleLineLength = useCallback(
    (len: number) => {
      if (!lineShape || len < 0) return;
      const dx = lineShape.to[0] - lineShape.from[0];
      const dy = lineShape.to[1] - lineShape.from[1];
      const currentLen = Math.sqrt(dx * dx + dy * dy);
      if (currentLen === 0) return;
      editor.beginTransaction();
      for (const n of nodes) {
        if (n.kind !== 'shape') continue;
        const s = n.shape;
        if (s.kind !== 'line' && s.kind !== 'arrow') continue;
        const ndx = s.to[0] - s.from[0];
        const ndy = s.to[1] - s.from[1];
        const nLen = Math.sqrt(ndx * ndx + ndy * ndy);
        if (nLen === 0) continue;
        const nScale = len / nLen;
        editor.updateNode(n.id, (node) => {
          if (node.kind !== 'shape') return node;
          const ns = node.shape;
          if (ns.kind !== 'line' && ns.kind !== 'arrow') return node;
          return {
            ...node,
            shape: { ...ns, to: [ns.from[0] + ndx * nScale, ns.from[1] + ndy * nScale] },
          } as typeof node;
        });
      }
      editor.commitTransaction();
    },
    [editor, lineShape, nodes],
  );

  const handleLineAngle = useCallback(
    (deg: number) => {
      if (!lineShape) return;
      const rad = (deg * Math.PI) / 180;
      editor.beginTransaction();
      for (const n of nodes) {
        if (n.kind !== 'shape') continue;
        const s = n.shape;
        if (s.kind !== 'line' && s.kind !== 'arrow') continue;
        const len = Math.sqrt((s.to[0] - s.from[0]) ** 2 + (s.to[1] - s.from[1]) ** 2);
        editor.updateNode(n.id, (node) => {
          if (node.kind !== 'shape') return node;
          const ns = node.shape;
          if (ns.kind !== 'line' && ns.kind !== 'arrow') return node;
          return {
            ...node,
            shape: {
              ...ns,
              to: [ns.from[0] + len * Math.cos(rad), ns.from[1] + len * Math.sin(rad)],
            },
          } as typeof node;
        });
      }
      editor.commitTransaction();
    },
    [editor, lineShape, nodes],
  );

  const handleW = useCallback(
    (w: number) => {
      const sel = nodes.map((n) => n.id);
      if (sel.length === 0) return;
      editor.beginTransaction();
      editor.setSelectedW(w);
      if (locked) {
        const ratio = aspectRatio();
        if (ratio !== null) {
          editor.setSelectedH(w / ratio);
        }
      }
      editor.commitTransaction();
    },
    [editor, locked, aspectRatio, nodes],
  );

  const handleH = useCallback(
    (h: number) => {
      const sel = nodes.map((n) => n.id);
      if (sel.length === 0) return;
      editor.beginTransaction();
      editor.setSelectedH(h);
      if (locked) {
        const ratio = aspectRatio();
        if (ratio !== null) {
          editor.setSelectedW(h * ratio);
        }
      }
      editor.commitTransaction();
    },
    [editor, locked, aspectRatio, nodes],
  );

  return (
    <DisclosureSection title="Position & Size" sectionId="position-size">
      {useArtboardCoords && (
        <p className="insp-panel__empty-hint">Coordinates shown relative to active artboard</p>
      )}
      <div ref={bindingTriggerRef} className="insp-field" style={{ position: 'relative' }}>
        <NumberField
          label={useArtboardCoords ? 'X (AB)' : 'X'}
          unit="px"
          value={isMixed(xRaw) ? 0 : toDisplayX(xRaw)}
          mixed={isMixed(xRaw)}
          onChange={(v) => editor.setSelectedX(fromDisplayX(v))}
          fieldName="x"
          onShiftClick={() => editor.setBindingField('x')}
        />
        <NumberField
          label={useArtboardCoords ? 'Y (AB)' : 'Y'}
          unit="px"
          value={isMixed(yRaw) ? 0 : toDisplayY(yRaw)}
          mixed={isMixed(yRaw)}
          onChange={(v) => editor.setSelectedY(fromDisplayY(v))}
          fieldName="y"
          onShiftClick={() => editor.setBindingField('y')}
        />
        {editor.bindingField &&
          ['x', 'y', 'width', 'height', 'rotation'].includes(editor.bindingField) && (
            <BindingMenu
              variableStore={docVariableStore(editor.state.document)}
              targetType="number"
              onBind={(variableId, expression) => {
                if (editor.bindingField) {
                  editor.setSelectedBinding(editor.bindingField, { variableId, expression });
                }
                editor.setBindingField(null);
              }}
              onClose={() => editor.setBindingField(null)}
              triggerRef={bindingTriggerRef}
            />
          )}
      </div>
      {allSizable && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          {isLineOrArrow ? (
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'flex-start' }}>
              <NumberField
                label="L"
                unit="px"
                value={lineLength}
                min={0}
                onChange={handleLineLength}
              />
              <NumberField
                label="A"
                unit="°"
                value={lineAngle}
                min={-180}
                max={360}
                onChange={handleLineAngle}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'flex-start' }}>
              <NumberField
                label="W"
                unit="px"
                value={wRaw !== null && !isMixed(wRaw) ? wRaw : 0}
                mixed={wRaw !== null && isMixed(wRaw)}
                min={0}
                onChange={handleW}
                fieldName="width"
                onShiftClick={() => editor.setBindingField('width')}
              />
              <label aria-label="Constrain proportions" className="insp-proportion-lock">
                <input
                  type="checkbox"
                  className="insp-checkbox--icon-only"
                  checked={locked}
                  onChange={() => setLocked((p) => !p)}
                  style={{
                    width: 0,
                    height: 0,
                    opacity: 0,
                    position: 'absolute',
                    pointerEvents: 'none',
                  }}
                />
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label="Constrain proportions"
                  className="insp-proportion-icon"
                  style={{
                    color: locked ? 'var(--color-interactive-default)' : 'var(--color-text-muted)',
                  }}
                >
                  <title>Constrain proportions</title>
                  <path d="M12 3v18" />
                  <path d="M8 21h8" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </label>
              <NumberField
                label="H"
                unit="px"
                value={hRaw !== null && !isMixed(hRaw) ? hRaw : 0}
                mixed={hRaw !== null && isMixed(hRaw)}
                min={0}
                onChange={handleH}
                fieldName="height"
                onShiftClick={() => editor.setBindingField('height')}
              />
            </div>
          )}
        </div>
      )}
      {/* Rotation + Flip row */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
        <NumberField
          label="R"
          unit="°"
          value={isMixed(rotationRaw) ? 0 : rotationRaw}
          mixed={isMixed(rotationRaw)}
          min={0}
          max={360}
          onChange={(v) => editor.setSelectedRotation(v % 360 < 0 ? (v % 360) + 360 : v % 360)}
          fieldName="rotation"
          onShiftClick={() => editor.setBindingField('rotation')}
        />
        <TooltipProvider>
          <Tooltip label="Flip horizontally">
            <button
              type="button"
              aria-label="Flip horizontal"
              onClick={editor.setSelectedFlipH}
              className="insp-flip-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
                <path d="M16 3h3a2 2 0 0 1 2 2v14c0 1.1-.9 2-2 2h-3" />
                <path d="M12 20v2" />
                <path d="M12 14v2" />
                <path d="M12 8v2" />
                <path d="M12 2v2" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip label="Flip vertically">
            <button
              type="button"
              aria-label="Flip vertical"
              onClick={editor.setSelectedFlipV}
              className="insp-flip-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 8V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v3" />
                <path d="M3 16v3c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-3" />
                <path d="M4 12H2" />
                <path d="M10 12H8" />
                <path d="M16 12h-2" />
                <path d="M22 12h-2" />
              </svg>
            </button>
          </Tooltip>
        </TooltipProvider>
      </div>
      {/* Skew row */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
        <NumberField
          label="Skew X"
          unit="°"
          value={isMixed(skewRaw) ? 0 : skewRaw}
          mixed={isMixed(skewRaw)}
          min={-89}
          max={89}
          onChange={(v) => editor.setSelectedSkew(v, isMixed(skewYRaw) ? 0 : skewYRaw)}
          fieldName="skewX"
        />
        <NumberField
          label="Skew Y"
          unit="°"
          value={isMixed(skewYRaw) ? 0 : skewYRaw}
          mixed={isMixed(skewYRaw)}
          min={-89}
          max={89}
          onChange={(v) => editor.setSelectedSkew(isMixed(skewRaw) ? 0 : skewRaw, v)}
          fieldName="skewY"
        />
        <TooltipProvider>
          <Tooltip label="Reset skew to 0">
            <button
              type="button"
              aria-label="Reset skew"
              onClick={() => editor.setSelectedSkew(0, 0)}
              className="insp-flip-btn"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <title>Reset skew</title>
                <path d="M3 12a9 9 0 1 0 9-9" />
                <path d="M3 4v5h5" />
              </svg>
            </button>
          </Tooltip>
        </TooltipProvider>
      </div>
    </DisclosureSection>
  );
}
