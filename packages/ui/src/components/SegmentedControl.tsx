import { useId } from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';
import type { SolidIconName } from '../icons/SolidIcon';
import { SolidIcon } from '../icons/SolidIcon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName | SolidIconName;
  /** Use SolidIcon (filled) instead of Icon (outline) */
  solid?: boolean;
  /**
   * Hide the visible label when an icon already carries the meaning. The
   * label still becomes the accessible name and the tooltip, so the option
   * is never an unlabelled glyph (WCAG 4.1.2; the 2026-09-16 icon-only
   * control research).
   */
  hideLabel?: boolean;
  /** Explicit tooltip when it should say more than the label. */
  tooltip?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Extra class on the radiogroup (e.g. varve-segmented--distribute). */
  className?: string;
  /** Pill-shaped track (view-mode switches); labels collapse below 640px. */
  variant?: 'default' | 'pill';
  /** Shared radio name for the options. Generated when omitted. */
  name?: string;
}

/**
 * SegmentedControl — APG radiogroup for short enumerations (stroke align,
 * text align, blend category, layout direction, view mode).
 *
 * The single canonical implementation: the styled `<label>` provides the
 * visuals while the clipped native radio inside carries the semantics, so
 * selection is exposed through `checked` and never through a redundant
 * `aria-checked` override. Exactly one radio carries tabindex="0" (the
 * checked one, or the first enabled one); Arrow keys move focus + selection
 * between options; Home/End jump to first/last. Disabled options are
 * skipped and expose their reason as a tooltip.
 *
 * Research basis: WAI-ARIA APG "Radio Group" pattern.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
  variant = 'default',
  name,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusIndex =
    checkedIndex >= 0 && !options[checkedIndex]?.disabled
      ? checkedIndex
      : Math.max(
          0,
          options.findIndex((option) => !option.disabled),
        );
  const groupName = name ?? `${groupId}-options`;

  function move(from: number, delta: number) {
    if (options.length === 0 || options.every((option) => option.disabled)) return;
    const n = options.length;
    let next = from;
    for (let step = 0; step < n; step += 1) {
      next = (((next + delta) % n) + n) % n;
      if (!options[next]?.disabled) break;
    }
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      const btn = document.getElementById(`${groupId}-${next}`);
      btn?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        e.preventDefault();
        move(index, -index);
        break;
      case 'End':
        e.preventDefault();
        move(index, options.length - 1 - index);
        break;
    }
  }

  const groupClass = [
    'varve-segmented',
    variant === 'pill' ? 'varve-segmented--pill' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={groupClass}
      data-disabled={disabled || undefined}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        const optionDisabled = disabled || opt.disabled;
        const tooltip = optionDisabled ? opt.disabledReason : (opt.tooltip ?? opt.label);
        return (
          <label key={opt.value} className="varve-segmented__btn" title={tooltip}>
            <input
              id={`${groupId}-${i}`}
              type="radio"
              name={groupName}
              checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={optionDisabled}
              aria-label={opt.hideLabel || variant === 'pill' ? opt.label : undefined}
              title={tooltip}
              onChange={() => onChange(opt.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="varve-segmented__input"
            />
            {opt.icon &&
              (opt.solid ? (
                <SolidIcon name={opt.icon as SolidIconName} label={undefined} size="0.95em" />
              ) : (
                <Icon name={opt.icon as IconName} label={undefined} size="0.95em" />
              ))}
            <span
              className={
                opt.hideLabel
                  ? 'varve-segmented__label varve-visually-hidden'
                  : 'varve-segmented__label'
              }
            >
              {opt.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
