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
import type { Affine, Shape } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { useCallback, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed, type MaybeMixed } from '../selection/selectionState';

export function PositionSizeSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const [locked, setLocked] = useState(false);

  const xRaw = commonValue(nodes, (n) => n.transform[4] ?? 0);
  const yRaw = commonValue(nodes, (n) => n.transform[5] ?? 0);
  const allShapes = nodes.every((n) => n.kind === 'shape');
  const wRaw: MaybeMixed<number> | null = allShapes
    ? commonValue(nodes, (n) => shapeW((n as SceneNode & { shape: Shape }).shape))
    : null;
  const hRaw: MaybeMixed<number> | null = allShapes
    ? commonValue(nodes, (n) => shapeH((n as SceneNode & { shape: Shape }).shape))
    : null;
  const rotationRaw = commonValue(nodes, (n) => n.rotation ?? 0);

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
      <NumberField
        label="X"
        unit="px"
        value={isMixed(xRaw) ? 0 : xRaw}
        mixed={isMixed(xRaw)}
        onChange={editor.setSelectedX}
      />
      <NumberField
        label="Y"
        unit="px"
        value={isMixed(yRaw) ? 0 : yRaw}
        mixed={isMixed(yRaw)}
        onChange={editor.setSelectedY}
      />
      {allShapes && (
        <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'flex-start' }}>
            <NumberField
              label="W"
              unit="px"
              value={wRaw !== null && !isMixed(wRaw) ? wRaw : 0}
              mixed={wRaw !== null && isMixed(wRaw)}
              min={0}
              onChange={handleW}
            />
            <button
              type="button"
              role="checkbox"
              aria-checked={locked}
              aria-label="Constrain proportions"
              onClick={() => setLocked((p) => !p)}
              style={{
                width: 'var(--space-4)',
                height: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: locked ? 'var(--color-interactive-default)' : 'var(--color-text-muted)',
                padding: 0,
                flexShrink: 0,
                marginTop: 'var(--space-2)',
              }}
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
                {locked ? (
                  <>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                  </>
                )}
              </svg>
            </button>
            <NumberField
              label="H"
              unit="px"
              value={hRaw !== null && !isMixed(hRaw) ? hRaw : 0}
              mixed={hRaw !== null && isMixed(hRaw)}
              min={0}
              onChange={handleH}
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
          onChange={(v) => editor.setSelectedRotation(v % 360 < 0 ? v % 360 + 360 : v % 360)}
        />
        <button
          type="button"
          aria-label="Flip horizontal"
          title="Flip horizontally"
          onClick={editor.setSelectedFlipH}
          style={{
            width: 'var(--space-4)', height: 'var(--space-4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', padding: 0, flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" /><path d="M16 3h3a2 2 0 0 1 2 2v14c0 1.1-.9 2-2 2h-3" />
            <path d="M12 20v2" /><path d="M12 14v2" /><path d="M12 8v2" /><path d="M12 2v2" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Flip vertical"
          title="Flip vertically"
          onClick={editor.setSelectedFlipV}
          style={{
            width: 'var(--space-4)', height: 'var(--space-4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', padding: 0, flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v3" /><path d="M3 16v3c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-3" />
            <path d="M4 12H2" /><path d="M10 12H8" /><path d="M16 12h-2" /><path d="M22 12h-2" />
          </svg>
        </button>
      </div>
    </DisclosureSection>
  );
}

function shapeW(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.w;
    case 'ellipse':
      return shape.rx;
    case 'circle':
      return shape.r;
    case 'polygon':
      return shape.radius;
    case 'star':
      return shape.outerRadius;
    default:
      return 0;
  }
}

function shapeH(shape: Shape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.h;
    case 'ellipse':
      return shape.ry;
    case 'circle':
      return shape.r;
    case 'polygon':
      return shape.radius;
    case 'star':
      return shape.outerRadius;
    default:
      return 0;
  }
}
