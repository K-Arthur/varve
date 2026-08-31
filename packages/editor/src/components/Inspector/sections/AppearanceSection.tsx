/**
 * Appearance section — opacity, blend mode for the current selection.
 *
 * F6 (Inspector): opacity via NumberField (0-1, step 0.01), blend mode via
 * themed Select (portaled listbox — never native OS dark menus).
 *
 * Research basis: Figma/Sketch opacity slider + blend mode dropdown;
 * APG Spinbutton + Combobox.
 */
import type { BlendMode } from '@varve/engine';
import type { SceneNode } from '@varve/scene';
import { Select } from '@varve/ui';
import { useRef } from 'react';
import { useEditor } from '../../../context';
import { docVariableStore } from '../../../docVariableStore';
import { EffectStudioLauncher } from '../../EffectStudio/EffectStudioLauncher';
import { deriveNumericBindingPresentation } from '../boundPropertyState';
import { BindingMenu } from '../controls/BindingMenu';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { classifySelectionProperty } from '../propertyState';
import { commonValue, isMixed } from '../selection/selectionState';

const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'colorDodge', label: 'Color Dodge' },
  { value: 'colorBurn', label: 'Color Burn' },
  { value: 'hardLight', label: 'Hard Light' },
  { value: 'softLight', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

export function AppearanceSection({ nodes }: { nodes: SceneNode[] }) {
  const editor = useEditor();
  const { setSelectedOpacity, setSelectedBlendMode } = editor;

  const opacityRaw = commonValue(nodes, (n) => n.opacity ?? 1);
  const opacityValues = nodes.map((n) => n.opacity ?? 1);
  const opacityBinding = deriveNumericBindingPresentation(
    nodes,
    'opacity',
    opacityValues,
    docVariableStore(editor.state.document),
  );
  const opacityState = opacityBinding?.state ?? classifySelectionProperty(opacityValues);
  const blendRaw = commonValue(nodes, (n) => n.blendMode ?? 'normal');
  const bindingTriggerRef = useRef<HTMLDivElement>(null);

  return (
    <DisclosureSection title="Appearance" sectionId="appearance">
      <div ref={bindingTriggerRef} className="insp-field" style={{ position: 'relative' }}>
        <NumberField
          label="Opacity"
          value={opacityBinding?.value ?? (isMixed(opacityRaw) ? 1 : opacityRaw)}
          mixed={opacityState.kind === 'mixed'}
          propertyState={opacityState}
          readOnly={opacityBinding?.readOnly ?? false}
          bindingLabel={opacityBinding?.sourceLabel}
          onUnbind={opacityBinding ? () => editor.setSelectedBinding('opacity', null) : undefined}
          step={0.01}
          min={0}
          max={1}
          onChange={setSelectedOpacity}
          fieldName="opacity"
          onShiftClick={() => editor.setBindingField('opacity')}
        />
        {editor.bindingField === 'opacity' && (
          <BindingMenu
            variableStore={docVariableStore(editor.state.document)}
            targetType="number"
            targetField="opacity"
            onBind={(variableId, expression) => {
              editor.setSelectedBinding('opacity', { variableId, expression });
              editor.setBindingField(null);
            }}
            onClose={() => editor.setBindingField(null)}
            triggerRef={bindingTriggerRef}
          />
        )}
      </div>
      <FieldRow label="Blend mode">
        <Select
          label="Blend mode"
          value={isMixed(blendRaw) ? '' : blendRaw}
          options={[
            ...(isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []),
            ...BLEND_OPTIONS,
          ]}
          onChange={(v) => {
            if (v) setSelectedBlendMode(v as BlendMode);
          }}
          placeholder="Mixed"
        />
      </FieldRow>
      <FieldRow label="Creative effects">
        <EffectStudioLauncher />
      </FieldRow>
    </DisclosureSection>
  );
}
