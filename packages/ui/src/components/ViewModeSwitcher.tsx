/**
 * Varve `<ViewModeSwitcher>` — pill-shaped view mode toggle (design system refresh).
 *
 * Built on the pill button variants. Provides a compact, accessible way to switch
 * between view modes (e.g., grid/list, day/week/month). Uses filled icons via SolidIcon.
 */

import { useId } from 'react';
import type { SolidIconName } from '../icons/SolidIcon';
import { SolidIcon } from '../icons/SolidIcon';

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
  const groupId = useId();
  const checkedIndex = options.findIndex((o) => o.value === value);
  const focusIndex = checkedIndex >= 0 ? checkedIndex : 0;

  function move(from: number, delta: number) {
    if (options.length === 0) return;
    const n = options.length;
    const next = (((from + delta) % n) + n) % n;
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
      className="varve-view-mode-switcher"
      data-disabled={disabled || undefined}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <label key={opt.value} className="varve-view-mode-switcher__btn">
            <input
              id={`${groupId}-${i}`}
              type="radio"
              checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              disabled={disabled}
              onChange={() => onChange(opt.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="varve-visually-hidden"
            />
            <SolidIcon name={opt.icon} label={undefined} size="1em" />
            <span className="varve-view-mode-switcher__label">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}
