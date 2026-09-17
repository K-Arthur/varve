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
import { Icon } from '@varve/ui';
import { useCallback, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { RangeValueControl } from '../controls/RangeValueControl';
import { commonValue, isMixed } from '../selection/selectionState';

export function CornerRadiusSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const { setSelectedCornerRadius, setSelectedCornerSmoothing } = editor;
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

  const isAsymmetric =
    Array.isArray(radius) &&
    (radius[0] !== radius[1] || radius[1] !== radius[2] || radius[2] !== radius[3]);
  const [userPerCorner, setUserPerCorner] = useState<boolean | null>(null);
  const perCorner = userPerCorner ?? isAsymmetric;

  const smoothingRaw = commonValue(nodes, (n) => {
    if (n.kind !== 'shape' && n.kind !== 'frame') return undefined;
    return n.cornerSmoothing ?? 0;
  });
  const smoothingMixed = isMixed(smoothingRaw);
  const smoothing = smoothingMixed ? 0 : Math.round((smoothingRaw as number | undefined) ?? 0);

  const uniform = typeof radius === 'number' ? radius : Array.isArray(radius) ? radius[0] : 0;
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
      setUserPerCorner(false);
    } else {
      setUserPerCorner(true);
    }
  }, [perCorner, setSelectedCornerRadius, tl]);

  const hasAnyRounding = uniform > 0 || tl > 0 || tr > 0 || br > 0 || bl > 0 || smoothing > 0;

  // Collapsed summary: the uniform radius, a per-corner marker, or "Mixed"
  // when the selection does not share one radius value.
  const radiusSummary = mixed
    ? 'Mixed'
    : !hasAnyRounding
      ? '0 px'
      : perCorner
        ? 'Per corner'
        : `${uniform} px`;

  return (
    <DisclosureSection title="Corner Radius" sectionId="corner-radius" summary={radiusSummary}>
      <div ref={bindingTriggerRef} className="insp-field-group insp-field-group--binding">
        <div className="insp-corner-radius-row">
          <NumberField
            label="Radius"
            unit="px"
            value={uniform}
            mixed={mixed}
            min={0}
            onChange={handleUniform}
            fieldName="cornerRadius"
            onShiftClick={() => editor.setBindingField('cornerRadius')}
          />
          <button
            type="button"
            onClick={toggleMode}
            className={`insp-flip-btn ${perCorner ? 'insp-flip-btn--active' : ''}`}
            style={{
              color: perCorner ? 'var(--color-interactive-default)' : 'var(--color-text-muted)',
            }}
            aria-label={perCorner ? 'Use uniform radius' : 'Edit individual corners'}
            aria-pressed={perCorner}
            title={perCorner ? 'Uniform radius' : 'Independent corners'}
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
              <path d="M7 17V7h10" />
            </svg>
          </button>
        </div>
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
        <fieldset className="insp-quad-grid">
          <legend className="sr-only">Individual corner radii</legend>
          <div className="insp-icon-field">
            <Icon
              name="CornerUpLeft"
              label={undefined}
              size="0.85em"
              className="insp-icon-field__icon"
            />
            <NumberField
              label="Top left"
              displayLabel="TL"
              unit="px"
              value={tl}
              min={0}
              onChange={(v) => handlePerCorner(0, v)}
            />
          </div>
          <div className="insp-icon-field">
            <Icon
              name="CornerUpRight"
              label={undefined}
              size="0.85em"
              className="insp-icon-field__icon"
            />
            <NumberField
              label="Top right"
              displayLabel="TR"
              unit="px"
              value={tr}
              min={0}
              onChange={(v) => handlePerCorner(1, v)}
            />
          </div>
          <div className="insp-icon-field">
            <Icon
              name="CornerDownLeft"
              label={undefined}
              size="0.85em"
              className="insp-icon-field__icon"
            />
            <NumberField
              label="Bottom left"
              displayLabel="BL"
              unit="px"
              value={bl}
              min={0}
              onChange={(v) => handlePerCorner(3, v)}
            />
          </div>
          <div className="insp-icon-field">
            <Icon
              name="CornerDownRight"
              label={undefined}
              size="0.85em"
              className="insp-icon-field__icon"
            />
            <NumberField
              label="Bottom right"
              displayLabel="BR"
              unit="px"
              value={br}
              min={0}
              onChange={(v) => handlePerCorner(2, v)}
            />
          </div>
        </fieldset>
      )}
      {/* Corner smoothing slider — contextual on rounding */}
      {hasAnyRounding && (
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
      )}
    </DisclosureSection>
  );
}
