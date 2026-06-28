import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, type IconName } from '../icons';
import type { ButtonSize, ButtonVariant } from './Button';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', pressed, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`strata-btn strata-btn--${variant} strata-btn--${size} strata-icobtn`.trim()}
      aria-pressed={pressed ?? undefined}
      aria-label={label}
      {...rest}
    >
      <Icon name={icon} size="1.15em" />
    </button>
  );
});
