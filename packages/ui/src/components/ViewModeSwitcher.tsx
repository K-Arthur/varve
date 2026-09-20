/**
 * Varve `<ViewModeSwitcher>` — pill-shaped view mode toggle.
 *
 * Thin adapter over the canonical `SegmentedControl` (`variant="pill"`), so
 * the roving-tabindex APG radiogroup logic lives in exactly one place. Kept
 * as a named export for existing consumers; new code may use
 * `<SegmentedControl variant="pill" />` directly.
 */

import type { SolidIconName } from '../icons/SolidIcon';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

export interface ViewModeOption<T extends string> {
  value: T;
  label: string;
  icon: SolidIconName;
}

export interface ViewModeSwitcherProps<T extends string> {
  label: string;
  value: T;
  options: readonly ViewModeOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function ViewModeSwitcher<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: ViewModeSwitcherProps<T>) {
  const segmentedOptions: SegmentedOption<T>[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    icon: option.icon,
    solid: true,
  }));

  return (
    <SegmentedControl
      label={label}
      value={value}
      options={segmentedOptions}
      onChange={onChange}
      disabled={disabled}
      variant="pill"
    />
  );
}
