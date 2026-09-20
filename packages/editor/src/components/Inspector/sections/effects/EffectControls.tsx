/**
 * EffectControls — the shared control vocabulary for Layer Effects parameter
 * editors.
 *
 * Every effect popover composes these primitives so blend, opacity, colour,
 * and closed-set choices read and behave identically across effect types,
 * regardless of which editor owns them. Only controls the scene model
 * supports are rendered: blur effects carry no blend mode, so they never show
 * an empty Blend row.
 *
 * Research basis: Photoshop exposes Blend + Opacity on every layer style and
 * groups Structure before Quality; Figma keeps per-effect blend and blur
 * controls in one settings surface; Sketch gives stacked shadows identical
 * controls and precise values. See
 * docs/research/effect-panel-competitive-2026-09-20.md.
 */
import type { BlendMode, ColorMode, ManagedColor } from '@varve/scene';
import { SegmentedControl, type SegmentedOption, Switch } from '@varve/ui';
import { BlendModeField } from '../../controls/BlendModeField';
import { FieldRow } from '../../controls/FieldRow';
import { InspectorColorPopover } from '../../controls/InspectorColorPopover';
import { NumberField } from '../../controls/NumberField';
import { toSwatchBg } from './EffectTypes';

/** Percent display for a 0..1 model value, rounded for the spinbutton. */
export function effectPercent(value: number): number {
  return Math.round(value * 100);
}

export interface EffectPercentFieldProps {
  label: string;
  /** Short visible label when the accessible name is longer (e.g. Tint). */
  displayLabel?: string;
  /** Model value in 0..1. */
  value: number;
  mixed: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

/**
 * EffectPercentField — the one percent-scaled numeric field for effect
 * parameters stored as 0..1 (effect opacity, tint, noise, edge opacity).
 * Raw decimals ("0.3") read as implementation detail; Photoshop, Sketch, and
 * Figma all present these as percentages.
 */
export function EffectPercentField({
  label,
  displayLabel,
  value,
  mixed,
  min = 0,
  max = 100,
  step = 1,
  onChange,
}: EffectPercentFieldProps) {
  return (
    <NumberField
      label={label}
      displayLabel={displayLabel ?? label}
      unit="%"
      value={mixed ? max : effectPercent(value)}
      mixed={mixed}
      step={step}
      min={min}
      max={max}
      onChange={(next) => onChange(next / 100)}
    />
  );
}

export interface EffectBlendRowProps {
  /** Effect-specific accessible name, e.g. "Aberration blend mode". */
  label: string;
  value: BlendMode;
  mixed: boolean;
  onChange: (mode: BlendMode) => void;
}

/** Per-effect blend mode, placed identically in every supporting editor. */
export function EffectBlendRow({ label, value, mixed, onChange }: EffectBlendRowProps) {
  return (
    <FieldRow label="Blend">
      <BlendModeField
        label={label}
        domain="effect"
        value={value}
        mixed={mixed}
        onChange={onChange}
      />
    </FieldRow>
  );
}

export interface EffectColourOpacityRowProps {
  colourLabel: string;
  colour: ManagedColor;
  colourMixed: boolean;
  /** Model opacity in 0..1. */
  opacity: number;
  opacityMixed: boolean;
  onColourChange: (colour: ManagedColor) => void;
  onOpacityChange: (opacity: number) => void;
  documentColorMode?: ColorMode;
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/** Colour swatch + percent opacity on one row (Photoshop colour/opacity pair). */
export function EffectColourOpacityRow({
  colourLabel,
  colour,
  colourMixed,
  opacity,
  opacityMixed,
  onColourChange,
  onOpacityChange,
  documentColorMode,
  onEditStart,
  onEditEnd,
}: EffectColourOpacityRowProps) {
  return (
    <FieldRow label="Colour & opacity">
      <InspectorColorPopover
        label={colourLabel}
        className="insp-swatch insp-swatch--round"
        value={colour}
        onChange={onColourChange}
        swatchStyle={{ background: toSwatchBg(colour) }}
        valueText={colourMixed ? 'Mixed' : undefined}
        documentColorMode={documentColorMode}
        onEditStart={onEditStart}
        onEditEnd={onEditEnd}
      />
      <EffectPercentField
        label="Opacity"
        value={opacity}
        mixed={opacityMixed}
        onChange={onOpacityChange}
      />
    </FieldRow>
  );
}

export interface EffectChoiceRowProps<T extends string> {
  label: string;
  value: T;
  mixed: boolean;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/**
 * Closed-set choice rendered as a segmented radiogroup instead of a select:
 * the options are few and visible, so one click replaces two. A mixed
 * multi-selection is represented by a disabled "Mixed" entry with nothing
 * selected, which keeps the control usable and honest.
 */
export function EffectChoiceRow<T extends string>({
  label,
  value,
  mixed,
  options,
  onChange,
}: EffectChoiceRowProps<T>) {
  const mixedValue = '' as T;
  const renderedOptions: readonly SegmentedOption<T>[] = mixed
    ? [{ value: mixedValue, label: 'Mixed', disabled: true }, ...options]
    : options;

  return (
    <FieldRow label={label}>
      <SegmentedControl
        label={label}
        value={mixed ? mixedValue : value}
        options={renderedOptions}
        onChange={onChange}
      />
    </FieldRow>
  );
}

export interface EffectToggleRowProps {
  label: string;
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** Boolean effect parameter using the canonical editor Switch. */
export function EffectToggleRow({
  label,
  checked,
  mixed = false,
  onChange,
  disabled,
}: EffectToggleRowProps) {
  return (
    <FieldRow label={label}>
      <Switch
        className="insp-switch"
        aria-label={mixed ? `${label} (mixed)` : label}
        checked={mixed ? false : checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </FieldRow>
  );
}
