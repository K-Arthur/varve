import { useId } from 'react';
import type { IconName } from '../icons/Icon';
import { Icon } from '../icons/Icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
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
      className="strata-segmented"
      data-disabled={disabled || undefined}
    >
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={opt.value}
            id={`${groupId}-${i}`}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            className="strata-segmented__btn"
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
