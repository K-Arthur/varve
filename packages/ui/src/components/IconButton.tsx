import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { Icon, type IconName, SolidIcon, type SolidIconName } from '../icons';
import type { ButtonSize, ButtonVariant } from './Button';
import { Spinner } from './Spinner';
import { useDelayedLoading } from './useDelayedLoading';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName | SolidIconName;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  /** Show activity while keeping the button focusable and preventing repeats. */
  loading?: boolean;
  /** Accessible name while the action is pending. */
  loadingLabel?: string;
  /** Use SolidIcon (filled) instead of Icon (outline) */
  solid?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon,
    label,
    variant = 'ghost',
    size = 'md',
    pressed,
    solid = false,
    loading = false,
    loadingLabel,
    disabled = false,
    'aria-label': ariaLabel,
    onClick,
    ...rest
  },
  ref,
) {
  const showLoading = useDelayedLoading(loading);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || loading) return;
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      className={`varve-btn varve-btn--${variant} varve-btn--${size} varve-iconbtn`.trim()}
      aria-pressed={pressed ?? undefined}
      aria-label={
        loading ? (loadingLabel ?? `${ariaLabel ?? label}, loading`) : (ariaLabel ?? label)
      }
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      disabled={!loading && disabled ? true : undefined}
      onClick={handleClick}
      {...rest}
    >
      {showLoading ? (
        <Spinner size="sm" />
      ) : solid ? (
        <SolidIcon name={icon as SolidIconName} size="1.15em" />
      ) : (
        <Icon name={icon as IconName} size="1.15em" />
      )}
    </button>
  );
});
