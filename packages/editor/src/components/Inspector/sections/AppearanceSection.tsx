/**
 * Appearance section — opacity, blend mode for the current selection.
 *
 * F6 (Inspector): opacity via NumberField (0-1, step 0.01), blend mode via
 * themed Select (portaled listbox — never native OS dark menus).
 *
 * Research basis: Figma/Sketch opacity slider + blend mode dropdown;
 * APG Spinbutton + Combobox.
 */
import type { BlendMode } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { Select } from '@strata/ui';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
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
  const { setSelectedOpacity, setSelectedBlendMode } = useEditor();

  const opacityRaw = commonValue(nodes, (n) => n.opacity ?? 1);
  const blendRaw = commonValue(nodes, (n) => n.blendMode ?? 'normal');

  return (
    <DisclosureSection title="Appearance" sectionId="appearance">
      <NumberField
        label="Opacity"
        value={isMixed(opacityRaw) ? 1 : opacityRaw}
        mixed={isMixed(opacityRaw)}
        step={0.01}
        min={0}
        max={1}
        onChange={setSelectedOpacity}
      />
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
    </DisclosureSection>
  );
}
