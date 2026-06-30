/**
 * Appearance section — opacity, blend mode for the current selection.
 *
 * F6 (Inspector): opacity via NumberField (0-1, step 0.01), blend mode via
 * native <select>. Multi-select aware via commonValue/MIXED.
 *
 * Research basis: Figma/Sketch opacity slider + blend mode dropdown;
 * APG Spinbutton for the numeric field, native <select> for the dropdown.
 */
import type { BlendMode } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
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

const SELECT_STYLE: React.CSSProperties = {
  flex: 1,
  height: 'var(--space-5)',
  fontSize: 'var(--font-size-xs)',
  background: 'var(--color-surface-sunken)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-2)',
};

export function AppearanceSection({ nodes }: { nodes: SceneNode[] }) {
  const { setSelectedOpacity, setSelectedBlendMode } = useEditor();

  const opacityRaw = commonValue(nodes, (n) => n.opacity ?? 1);
  const blendRaw = commonValue(nodes, (n) => n.blendMode ?? 'normal');

  return (
    <DisclosureSection title="Appearance">
      <NumberField
        label="Opacity"
        value={isMixed(opacityRaw) ? 1 : opacityRaw}
        mixed={isMixed(opacityRaw)}
        step={0.01}
        min={0}
        max={1}
        onChange={setSelectedOpacity}
      />
      <FieldRow label="Blend" htmlFor="insp-blend">
        <select
          id="insp-blend"
          value={isMixed(blendRaw) ? '' : blendRaw}
          style={SELECT_STYLE}
          onChange={(e) => setSelectedBlendMode(e.target.value as BlendMode)}
          aria-label="Blend mode"
        >
          {isMixed(blendRaw) && <option value="">Mixed</option>}
          {BLEND_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldRow>
    </DisclosureSection>
  );
}
