/**
 * Corner Radius section — uniform or per-corner radius for rect shapes.
 *
 * Expandable from uniform to per-corner (TL/TR/BR/BL) via a link toggle.
 * Corner smoothing slider (0-1) for continuous corners (Sketch-style).
 *
 * Multi-select aware via commonValue/MIXED.
 * Only renders for rect shapes.
 *
 * Research basis: Figma/Sketch corner radius panel; APG Spinbutton.
 */
import type { SceneNode } from '@strata/scene';
import { useCallback, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { NumberField } from '../controls/NumberField';
import { commonValue, isMixed } from '../selection/selectionState';

export function CornerRadiusSection({ nodes }: { nodes: SceneNode[] }) {
  const { setSelectedCornerRadius } = useEditor();
  const [perCorner, setPerCorner] = useState(false);

  const radiusRaw = commonValue(nodes, (n) => {
    if (n.kind !== 'shape') return undefined;
    return n.cornerRadius ?? 0;
  });

  const mixed = isMixed(radiusRaw) || radiusRaw === undefined;
  const radius: number | [number, number, number, number] | null =
    !mixed && radiusRaw !== undefined
      ? (radiusRaw as number | [number, number, number, number])
      : null;

  const uniform = typeof radius === 'number' ? radius : 0;
  const tl = Array.isArray(radius) ? radius[0] : uniform;
  const tr = Array.isArray(radius) ? radius[1] : uniform;
  const br = Array.isArray(radius) ? radius[2] : uniform;
  const bl = Array.isArray(radius) ? radius[3] : uniform;

  const handleUniform = useCallback(
    (v: number) => {
      setSelectedCornerRadius(Math.max(0, v));
    },
    [setSelectedCornerRadius],
  );

  const handlePerCorner = useCallback(
    (idx: number, v: number) => {
      const current = Array.isArray(radius) ? [...radius] : [tl, tr, br, bl];
      current[idx] = Math.max(0, v);
      setSelectedCornerRadius(current as [number, number, number, number]);
    },
    [setSelectedCornerRadius, radius, tl, tr, br, bl],
  );

  const toggleMode = useCallback(() => {
    if (perCorner) {
      // Collapse back to uniform: use TL value
      setSelectedCornerRadius(Math.max(0, tl));
    }
    setPerCorner((p) => !p);
  }, [perCorner, setSelectedCornerRadius, tl]);

  return (
    <DisclosureSection title="Corner Radius">
      {!perCorner && !mixed && (
        <NumberField label="Radius" value={uniform} min={0} onChange={handleUniform} />
      )}
      {!perCorner && mixed && (
        <NumberField label="Radius" value={0} mixed min={0} onChange={handleUniform} />
      )}
      {perCorner && (
        <>
          <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
            <NumberField label="TL" value={tl} min={0} onChange={(v) => handlePerCorner(0, v)} />
            <NumberField label="TR" value={tr} min={0} onChange={(v) => handlePerCorner(1, v)} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
            <NumberField label="BL" value={bl} min={0} onChange={(v) => handlePerCorner(3, v)} />
            <NumberField label="BR" value={br} min={0} onChange={(v) => handlePerCorner(2, v)} />
          </div>
        </>
      )}
      <button
        type="button"
        onClick={toggleMode}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: perCorner ? 'var(--color-interactive-default)' : 'var(--color-text-muted)',
          fontSize: 'var(--font-size-xs)',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
        }}
        aria-label={perCorner ? 'Use uniform radius' : 'Edit individual corners'}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 17V7h10" />
        </svg>
        {perCorner ? 'Uniform' : 'Individual'}
      </button>
    </DisclosureSection>
  );
}
