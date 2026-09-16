/**
 * SegmentedControl — APG Radiogroup for short enumerations (stroke align,
 * text align, blend category, layout direction).
 *
 * Research basis: WAI-ARIA APG "Radio Group" pattern with roving tabindex:
 * exactly one radio carries tabindex="0" (the checked one, or the first);
 * ArrowLeft/ArrowUp and ArrowRight/ArrowDown move focus + selection between
 * options. Home/End jump to first/last.
 */

import type { IconName } from '@varve/ui';
import { Icon } from '@varve/ui';
import { useId } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  disabledReason?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Extra class on the radiogroup (e.g. insp-segmented--distribute). */
  className?: string;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
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

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={className ? `insp-segmented ${className}` : 'insp-segmented'}
      data-disabled={disabled || undefined}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: APG radiogroup pattern uses role="radio" on buttons for custom segmented controls
          <button
            key={opt.value}
            id={`${groupId}-${i}`}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled || opt.disabled}
            title={opt.disabled ? opt.disabledReason : undefined}
            className="insp-segmented__btn"
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {opt.icon && <Icon name={opt.icon} label={undefined} size="0.95em" />}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
