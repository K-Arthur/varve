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

import type { SceneNode } from '@strata/scene';
import { formatCoordForRuler } from '@strata/shared';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { nodeLocalBounds } from '../../../scene/nodeBounds';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export function PositionSizeSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const [locked, setLocked] = useState(false);
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

  const handleW = useCallback(
    (w: number) => {
      const sel = nodes.map((n) => n.id);
      if (sel.length === 0) return;
      editor.beginTransaction();
      editor.setSelectedW(w);
      if (locked) {
        const ratio = aspectRatio();
        if (ratio !== null) {
          editor.setSelectedH(Math.round((w / ratio) * 100) / 100);
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
          editor.setSelectedW(Math.round(h * ratio * 100) / 100);
        }
      }
      editor.commitTransaction();
    },
    [editor, locked, aspectRatio, nodes],
  );

  return (
    <DisclosureSection title="Position & Size">
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
        <button
          type="button"
          aria-label="Flip horizontal"
          title="Flip horizontally"
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
        <button
          type="button"
          aria-label="Flip vertical"
          title="Flip vertically"
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
      </div>
      {/* P3: Clamp sizing controls */}
      {allSizable && (
        <div style={{ marginTop: 'var(--space-1)' }}>
          {(() => {
            const minWRaw = commonValue(nodes, (n) => n.minWidth);
            return (
              <NumberField
                label="Min W"
                unit="px"
                value={isMixed(minWRaw) ? 0 : (minWRaw ?? 0)}
                mixed={isMixed(minWRaw)}
                min={0}
                onChange={editor.setSelectedMinWidth}
              />
            );
          })()}
          {(() => {
            const maxWRaw = commonValue(nodes, (n) => n.maxWidth);
            return (
              <NumberField
                label="Max W"
                unit="px"
                value={isMixed(maxWRaw) ? 0 : (maxWRaw ?? 0)}
                mixed={isMixed(maxWRaw)}
                min={0}
                onChange={editor.setSelectedMaxWidth}
              />
            );
          })()}
          {(() => {
            const minHRaw = commonValue(nodes, (n) => n.minHeight);
            return (
              <NumberField
                label="Min H"
                unit="px"
                value={isMixed(minHRaw) ? 0 : (minHRaw ?? 0)}
                mixed={isMixed(minHRaw)}
                min={0}
                onChange={editor.setSelectedMinHeight}
              />
            );
          })()}
          {(() => {
            const maxHRaw = commonValue(nodes, (n) => n.maxHeight);
            return (
              <NumberField
                label="Max H"
                unit="px"
                value={isMixed(maxHRaw) ? 0 : (maxHRaw ?? 0)}
                mixed={isMixed(maxHRaw)}
                min={0}
                onChange={editor.setSelectedMaxHeight}
              />
            );
          })()}
        </div>
      )}
    </DisclosureSection>
  );
}
