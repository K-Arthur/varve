import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, type IconName } from '../icons';
import { SolidIcon, type SolidIconName } from '../icons';
import type { ButtonSize, ButtonVariant } from './Button';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName | SolidIconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  /** Use SolidIcon (filled) instead of Icon (outline) */
  solid?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', pressed, solid = false, ...rest },
  ref,
) {
  const IconComponent = solid ? SolidIcon : Icon;
  return (
    <button
      ref={ref}
      className={`strata-btn strata-btn--${variant} strata-btn--${size} strata-iconbtn`.trim()}
      aria-pressed={pressed ?? undefined}
      aria-label={label}
      {...rest}
    >
      <IconComponent name={icon as any} size="1.15em" />
    </button>
  );
});
