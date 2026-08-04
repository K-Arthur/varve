import { type ButtonHTMLAttributes, forwardRef } from 'react';
import type { IconName } from '../icons';
import { Icon } from '../icons/Icon';

export interface ToggleButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: IconName;
  label: string;
  size?: 'sm' | 'md' | 'lg';
}

export const ToggleButton = forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton(
  { pressed, onPressedChange, icon, label, size = 'md', className = '', disabled, ...rest },
  ref,
) {
  const classes = [
    'varve-toggle-btn',
    `varve-toggle-btn--${size}`,
    pressed ? 'varve-toggle-btn--pressed' : '',
    disabled ? 'varve-toggle-btn--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      aria-pressed={pressed}
      aria-label={label}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      {...rest}
    >
      {icon && <Icon name={icon} size={size} />}
    </button>
  );
});
