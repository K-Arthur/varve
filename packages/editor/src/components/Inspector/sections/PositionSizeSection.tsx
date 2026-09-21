/**
 * Layout section — position, size, rotation, flip, skew, and constraints
 * for the current selection (ADR-0230: merged Position & Size + Constraints).
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

import type { FrameNode, SceneNode } from '@varve/scene';
import { getParent, isExportRegion } from '@varve/scene';
import { decomposeAffineFull, formatCoordForRuler } from '@varve/shared';
import { Icon, Tooltip, TooltipProvider } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { nodeLocalBounds } from '../../../scene/nodeBounds';
import { deriveNumericBindingPresentation } from '../boundPropertyState';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { InspectorFieldGroup } from '../controls/FieldRow';
import { FramePresetDropdown } from '../controls/FramePresetDropdown';
import { NumberField } from '../controls/NumberField';
import { classifySelectionProperty, type InspectorPropertyState } from '../propertyState';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';
import { ConstraintControls } from './ConstraintSection';

/** Plain-language names for the layout-computed sizing modes. */
const SIZING_MODE_DESCRIPTIONS = {
  hug: 'Hug contents',
  fill: 'Fill container',
} as const;

export function PositionSizeSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const doc = editor.state.document;

  // Auto-layout detection: hide constraint controls when ALL selected nodes
  // are inside auto-layout frames (ADR-0230). Constraints are meaningless
  // when a parent frame uses flex/grid layout.
  const parentHasAutoLayout = useMemo(() => {
    if (nodes.length === 0) return false;
    return nodes.every((n) => {
      const parentId = getParent(doc, n.id);
      if (!parentId) return false;
      const parent = doc.nodes[parentId];
      if (parent?.kind !== 'frame') return false;
      return Boolean((parent as FrameNode).layoutStyle);
    });
  }, [nodes, doc]);

  // Layout-driven per-axis sizing: when the axis is Hug/Fill, the parent's
  // layout computes the dimension every frame, so the numeric field shows the
  // actual size but is read-only and explains itself ("Sizing mode: Fill /
  // Actual size: 428 px"). Fixed/relative axes stay directly editable.
  const widthSizing = commonValue(
    nodes,
    (n) =>
      n.layoutSizingWidth ??
      (n as { layoutSizing?: 'fixed' | 'hug' | 'fill' | 'relative' }).layoutSizing ??
      'fixed',
  );
  const heightSizing = commonValue(
    nodes,
    (n) =>
      n.layoutSizingHeight ??
      (n as { layoutSizing?: 'fixed' | 'hug' | 'fill' | 'relative' }).layoutSizing ??
      'fixed',
  );
  const sizingDescription = (sizing: MaybeMixed<string>): string | undefined =>
    parentHasAutoLayout && !isMixed(sizing) && typeof sizing === 'string'
      ? SIZING_MODE_DESCRIPTIONS[sizing as 'hug' | 'fill']
      : undefined;
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

  const rawXValues = nodes.map((n) => n.transform[4] ?? 0);
  const rawYValues = nodes.map((n) => n.transform[5] ?? 0);
  const rawXState = classifySelectionProperty(rawXValues);
  const rawYState = classifySelectionProperty(rawYValues);
  const variableStore = docVariableStore(doc);
  const xBinding = deriveNumericBindingPresentation(nodes, 'x', rawXValues, variableStore);
  const yBinding = deriveNumericBindingPresentation(nodes, 'y', rawYValues, variableStore);
  const xState = xBinding?.state ?? rawXState;
  const yState = yBinding?.state ?? rawYState;
  const xValue = xBinding?.value ?? (rawXState.kind === 'common' ? rawXState.value : 0);
  const yValue = yBinding?.value ?? (rawYState.kind === 'common' ? rawYState.value : 0);
  const draftKey = `${doc.id}:${nodes
    .map((node) => node.id)
    .sort()
    .join(',')}`;
  // Only node kinds `nodeLocalBounds` can measure (shape/text/frame) get a W/H
  // editor — groups/adjustment nodes have no geometry of their own.
  const allSizable = nodes.every((n) => nodeLocalBounds(n) !== null);
  const wRaw: MaybeMixed<number> | null = allSizable
    ? commonValue(nodes, (n) => nodeLocalBounds(n)?.w ?? 0)
    : null;
  const hRaw: MaybeMixed<number> | null = allSizable
    ? commonValue(nodes, (n) => nodeLocalBounds(n)?.h ?? 0)
    : null;
  // A layout-computed axis shows the actual size with the `calculated`
  // property state: read-only in the field, with the sizing mode as its
  // accessible description. Bindings keep precedence when both apply.
  const widthSizingDescription = sizingDescription(widthSizing);
  const heightSizingDescription = sizingDescription(heightSizing);
  const wPropertyState: InspectorPropertyState<number> | undefined =
    widthSizingDescription && wRaw !== null && !isMixed(wRaw)
      ? { kind: 'calculated', value: wRaw, description: widthSizingDescription }
      : undefined;
  const hPropertyState: InspectorPropertyState<number> | undefined =
    heightSizingDescription && hRaw !== null && !isMixed(hRaw)
      ? { kind: 'calculated', value: hRaw, description: heightSizingDescription }
      : undefined;
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

  const hasSkew =
    (typeof skewRaw === 'number' && Math.abs(skewRaw) > 0.001) ||
    (typeof skewYRaw === 'number' && Math.abs(skewYRaw) > 0.001) ||
    isMixed(skewRaw) ||
    isMixed(skewYRaw);
  const [showSkew, setShowSkew] = useState(false);
  const isSkewVisible = showSkew || hasSkew;

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

  const isFrameSelection =
    nodes.length > 0 &&
    nodes.every(
      (n) => n.kind === 'frame' && !isExportRegion(n) && !('componentId' in n && n.componentId),
    );

  const handleSwapOrientation = useCallback(() => {
    if (nodes.length === 0 || wRaw === null || hRaw === null || isMixed(wRaw) || isMixed(hRaw))
      return;
    editor.beginTransaction();
    editor.setSelectedW(hRaw);
    editor.setSelectedH(wRaw);
    editor.commitTransaction();
  }, [editor, nodes, wRaw, hRaw]);

  /**
   * Relative move channel for gestures on X/Y. Typing an absolute value still
   * sets every selected object to that value (`setSelectedX/Y`); scrubbing,
   * arrow steps, and wheel deltas move each object by the same amount so a
   * mixed multi-selection keeps its relative layout instead of collapsing onto
   * one coordinate. The document updater form reads the live document, so a
   * long gesture never writes against a stale node list.
   */
  const translateSelectionBy = useCallback(
    (dx: number, dy: number) => {
      if (nodes.length === 0 || (dx === 0 && dy === 0)) return;
      const ids = nodes.map((n) => n.id);
      editor.beginTransaction();
      editor.updateDoc((doc) => {
        let changed = false;
        const nextNodes = { ...doc.nodes };
        for (const id of ids) {
          const node = nextNodes[id];
          if (!node) continue;
          nextNodes[id] = {
            ...node,
            transform: [
              node.transform[0],
              node.transform[1],
              node.transform[2],
              node.transform[3],
              (node.transform[4] ?? 0) + dx,
              (node.transform[5] ?? 0) + dy,
            ] as SceneNode['transform'],
          } as SceneNode;
          changed = true;
        }
        return changed ? { ...doc, nodes: nextNodes } : doc;
      });
      editor.commitTransaction();
    },
    [editor, nodes],
  );

  const handleDeltaX = useCallback(
    (delta: number) => translateSelectionBy(delta, 0),
    [translateSelectionBy],
  );
  const handleDeltaY = useCallback(
    (delta: number) => translateSelectionBy(0, delta),
    [translateSelectionBy],
  );

  return (
    <DisclosureSection title="Position & Size" sectionId="position-size">
      {isFrameSelection && (
        <div className="insp-preset-row">
          <FramePresetDropdown frames={nodes as FrameNode[]} />
          <Tooltip label="Swap orientation (Portrait / Landscape)">
            <button
              type="button"
              className="insp-orientation-btn"
              onClick={handleSwapOrientation}
              aria-label="Swap orientation"
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
                <path d="M8 3 4 7l4 4" />
                <path d="M4 7h16" />
                <path d="m16 21 4-4-4-4" />
                <path d="M20 17H4" />
              </svg>
            </button>
          </Tooltip>
        </div>
      )}
      {useArtboardCoords && (
        <p className="insp-panel__empty-hint">Coordinates shown relative to active artboard</p>
      )}
      <div
        ref={bindingTriggerRef}
        className="insp-field-group insp-field-group--columns-2 insp-field-group--numeric-pair insp-field-group--binding insp-field-group--position"
      >
        <NumberField
          label={useArtboardCoords ? 'X (AB)' : 'X'}
          displayLabel="X"
          unit="px"
          value={toDisplayX(xValue)}
          mixed={xState.kind === 'mixed'}
          propertyState={xState}
          readOnly={xBinding?.readOnly ?? false}
          bindingLabel={nodes.length === 1 ? xBinding?.sourceLabel : undefined}
          onUnbind={
            nodes.length === 1 && xBinding ? () => editor.setSelectedBinding('x', null) : undefined
          }
          draftKey={draftKey}
          onChange={(v) => editor.setSelectedX(fromDisplayX(v))}
          onDelta={handleDeltaX}
          fieldName="x"
          onShiftClick={() => editor.setBindingField('x')}
        />
        <span className="insp-field-group__action-slot" aria-hidden="true" />
        <NumberField
          label={useArtboardCoords ? 'Y (AB)' : 'Y'}
          displayLabel="Y"
          unit="px"
          value={toDisplayY(yValue)}
          mixed={yState.kind === 'mixed'}
          propertyState={yState}
          readOnly={yBinding?.readOnly ?? false}
          bindingLabel={nodes.length === 1 ? yBinding?.sourceLabel : undefined}
          onUnbind={
            nodes.length === 1 && yBinding ? () => editor.setSelectedBinding('y', null) : undefined
          }
          draftKey={draftKey}
          onChange={(v) => editor.setSelectedY(fromDisplayY(v))}
          onDelta={handleDeltaY}
          fieldName="y"
          onShiftClick={() => editor.setBindingField('y')}
        />
        <span className="insp-field-group__action-slot" aria-hidden="true" />
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
        <InspectorFieldGroup>
          {isLineOrArrow ? (
            <InspectorFieldGroup columns={2} className="insp-field-group--numeric-pair">
              <NumberField
                label="L"
                unit="px"
                value={lineLength}
                min={0}
                draftKey={draftKey}
                onChange={handleLineLength}
              />
              <NumberField
                label="A"
                unit="°"
                value={lineAngle}
                min={-180}
                max={360}
                draftKey={draftKey}
                onChange={handleLineAngle}
              />
            </InspectorFieldGroup>
          ) : (
            <InspectorFieldGroup className="insp-field-group--size insp-field-group--numeric-pair">
              <NumberField
                label="W"
                displayLabel="W"
                unit="px"
                value={wRaw !== null && !isMixed(wRaw) ? wRaw : 0}
                mixed={wRaw !== null && isMixed(wRaw)}
                propertyState={wPropertyState}
                min={0}
                draftKey={draftKey}
                onChange={handleW}
                fieldName="width"
                onShiftClick={() => editor.setBindingField('width')}
              />
              {isFrameSelection ? (
                <Tooltip label="Swap orientation (Portrait / Landscape)">
                  <button
                    type="button"
                    className="insp-orientation-btn"
                    onClick={handleSwapOrientation}
                    aria-label="Swap orientation"
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
                      <path d="M8 3 4 7l4 4" />
                      <path d="M4 7h16" />
                      <path d="m16 21 4-4-4-4" />
                      <path d="M20 17H4" />
                    </svg>
                  </button>
                </Tooltip>
              ) : (
                <span className="insp-field-group__action-slot" aria-hidden="true" />
              )}
              <NumberField
                label="H"
                displayLabel="H"
                unit="px"
                value={hRaw !== null && !isMixed(hRaw) ? hRaw : 0}
                mixed={hRaw !== null && isMixed(hRaw)}
                propertyState={hPropertyState}
                min={0}
                draftKey={draftKey}
                onChange={handleH}
                fieldName="height"
                onShiftClick={() => editor.setBindingField('height')}
              />
              <label
                className="insp-proportion-lock"
                title={locked ? 'Constrain proportions (active)' : 'Constrain proportions'}
              >
                <input
                  type="checkbox"
                  className="insp-proportion-lock__input"
                  checked={locked}
                  onChange={() => setLocked((p) => !p)}
                  aria-label="Constrain proportions"
                />
                {/* Linked/unlinked use the Lucide chain pair rather than a
                    bespoke path, so the slashed state is unmistakable at 14px
                    (2026-09-15 competitor research: ambiguous lock affordances). */}
                <Icon
                  name={locked ? 'Link2' : 'Link2Off'}
                  size={14}
                  className={`insp-proportion-icon${locked ? ' insp-proportion-icon--locked' : ''}`}
                />
              </label>
              <span className="insp-field-group__action-slot" aria-hidden="true" />
            </InspectorFieldGroup>
          )}
        </InspectorFieldGroup>
      )}
      {/* Rotation + Flip row */}
      <InspectorFieldGroup className="insp-field-group--rotation">
        <NumberField
          label="R"
          displayLabel="R"
          unit="°"
          value={isMixed(rotationRaw) ? 0 : rotationRaw}
          mixed={isMixed(rotationRaw)}
          min={0}
          max={360}
          draftKey={draftKey}
          onChange={(v) => editor.setSelectedRotation(v % 360 < 0 ? (v % 360) + 360 : v % 360)}
          fieldName="rotation"
          onShiftClick={() => editor.setBindingField('rotation')}
        />
        <TooltipProvider>
          <div className="insp-flip-group" role="group" aria-label="Transform controls">
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
            <Tooltip label={isSkewVisible ? 'Hide skew controls' : 'More transforms (Skew)'}>
              <button
                type="button"
                aria-label={isSkewVisible ? 'Hide skew controls' : 'Show skew controls'}
                aria-expanded={isSkewVisible}
                onClick={() => setShowSkew((p) => !p)}
                className={`insp-flip-btn ${isSkewVisible ? 'insp-flip-btn--active' : ''}`}
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
                  <path d="M4 20h14l4-16H8L4 20z" />
                </svg>
              </button>
            </Tooltip>
          </div>
        </TooltipProvider>
      </InspectorFieldGroup>
      {/* Skew row — progressively disclosed */}
      {isSkewVisible && (
        <InspectorFieldGroup className="insp-field-group--skew insp-field-group--numeric-pair">
          <NumberField
            label="Skew X"
            unit="°"
            value={isMixed(skewRaw) ? 0 : skewRaw}
            mixed={isMixed(skewRaw)}
            min={-89}
            max={89}
            draftKey={draftKey}
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
            draftKey={draftKey}
            onChange={(v) => editor.setSelectedSkew(isMixed(skewRaw) ? 0 : skewRaw, v)}
            fieldName="skewY"
          />
          <TooltipProvider>
            <Tooltip label="Reset skew to 0">
              <button
                type="button"
                aria-label="Reset skew"
                onClick={() => {
                  editor.setSelectedSkew(0, 0);
                  setShowSkew(false);
                }}
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
        </InspectorFieldGroup>
      )}
      {/* Constraint controls — embedded from the former standalone Constraints
          section (ADR-0230). Hidden when the parent frame uses auto-layout
          where constraints are semantically meaningless. */}
      {!parentHasAutoLayout && <ConstraintControls nodes={nodes} />}
    </DisclosureSection>
  );
}
