import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, type IconName, SolidIcon, type SolidIconName } from '../icons';
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
  return (
    <button
      ref={ref}
      className={`strata-btn strata-btn--${variant} strata-btn--${size} strata-iconbtn`.trim()}
      aria-pressed={pressed ?? undefined}
      aria-label={label}
      {...rest}
    >
      {solid ? (
        <SolidIcon name={icon as SolidIconName} size="1.15em" />
      ) : (
        <Icon name={icon as IconName} size="1.15em" />
      )}
    </button>
  );
});
