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
import type { SceneNode } from '@varve/scene';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow, InspectorFieldGroup } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { RangeValueControl } from '../controls/RangeValueControl';
import { commonValue, isMixed } from '../selection/selectionState';

export function CornerRadiusSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const { setSelectedCornerRadius, setSelectedCornerSmoothing } = editor;
  const [perCorner, setPerCorner] = useState(false);
  const bindingTriggerRef = useRef<HTMLDivElement>(null);

  const radiusRaw = commonValue(nodes, (n) => {
    if (n.kind !== 'shape' && n.kind !== 'frame') return undefined;
    return n.cornerRadius ?? 0;
  });

  const mixed = isMixed(radiusRaw) || radiusRaw === undefined;
  const radius: number | [number, number, number, number] | null =
    !mixed && radiusRaw !== undefined
      ? (radiusRaw as number | [number, number, number, number])
      : null;

  const smoothingRaw = commonValue(nodes, (n) => {
    if (n.kind !== 'shape' && n.kind !== 'frame') return undefined;
    return n.cornerSmoothing ?? 0;
  });
  const smoothingMixed = isMixed(smoothingRaw);
  const smoothing = smoothingMixed ? 0 : Math.round((smoothingRaw as number | undefined) ?? 0);

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
    <DisclosureSection title="Corner Radius" sectionId="corner-radius">
      <div ref={bindingTriggerRef} className="insp-field-group insp-field-group--binding">
        {!perCorner && !mixed && (
          <NumberField
            label="Radius"
            value={uniform}
            min={0}
            onChange={handleUniform}
            fieldName="cornerRadius"
            onShiftClick={() => editor.setBindingField('cornerRadius')}
          />
        )}
        {!perCorner && mixed && (
          <NumberField
            label="Radius"
            value={0}
            mixed
            min={0}
            onChange={handleUniform}
            fieldName="cornerRadius"
            onShiftClick={() => editor.setBindingField('cornerRadius')}
          />
        )}
        {editor.bindingField === 'cornerRadius' && (
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
      {perCorner && (
        <>
          <InspectorFieldGroup columns={2}>
            <NumberField label="TL" value={tl} min={0} onChange={(v) => handlePerCorner(0, v)} />
            <NumberField label="TR" value={tr} min={0} onChange={(v) => handlePerCorner(1, v)} />
          </InspectorFieldGroup>
          <InspectorFieldGroup columns={2}>
            <NumberField label="BL" value={bl} min={0} onChange={(v) => handlePerCorner(3, v)} />
            <NumberField label="BR" value={br} min={0} onChange={(v) => handlePerCorner(2, v)} />
          </InspectorFieldGroup>
        </>
      )}
      <button
        type="button"
        onClick={toggleMode}
        className="insp-advanced-btn"
        style={{
          color: perCorner ? 'var(--color-interactive-default)' : 'var(--color-text-muted)',
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
      {/* Corner smoothing slider */}
      <FieldRow label="Smoothing" htmlFor="corner-smoothing-range">
        <RangeValueControl
          id="corner-smoothing"
          label="Smoothing"
          value={smoothing}
          min={0}
          max={100}
          unit="%"
          rangeClassName="insp-range"
          rangeAriaLabel="Corner smoothing"
          onChange={setSelectedCornerSmoothing}
        />
      </FieldRow>
    </DisclosureSection>
  );
}
