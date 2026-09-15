/**
 * Appearance section — opacity, blend mode for the current selection.
 *
 * F6 (Inspector): opacity via NumberField (0-100%, step 1), blend mode via
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
import { deriveNumericBindingPresentation } from '../boundPropertyState';
import { BindingMenu } from '../controls/BindingMenu';
import { groupBlendOptions } from '../controls/blendModeOptionGroups';
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
  const opacityValue = opacityBinding?.value ?? (isMixed(opacityRaw) ? 1 : opacityRaw);

  return (
    <DisclosureSection title="Appearance" sectionId="appearance">
      <NumberField
        label="Opacity"
        value={opacityValue * 100}
        mixed={opacityState.kind === 'mixed'}
        propertyState={opacityState}
        readOnly={opacityBinding?.readOnly ?? false}
        bindingLabel={opacityBinding?.sourceLabel}
        onUnbind={opacityBinding ? () => editor.setSelectedBinding('opacity', null) : undefined}
        unit="%"
        step={1}
        min={0}
        max={100}
        onChange={(value) => setSelectedOpacity(value / 100)}
        fieldName="opacity"
        onShiftClick={() => editor.setBindingField('opacity')}
        containerRef={bindingTriggerRef}
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
      <FieldRow label="Blend mode">
        <Select
          label="Blend mode"
          value={isMixed(blendRaw) ? '' : blendRaw}
          options={isMixed(blendRaw) ? [{ value: '', label: 'Mixed', disabled: true }] : []}
          groups={groupBlendOptions(BLEND_OPTIONS)}
          onChange={(v) => {
            if (v) setSelectedBlendMode(v as BlendMode);
          }}
          placeholder="Mixed"
        />
      </FieldRow>
    </DisclosureSection>
  );
}
