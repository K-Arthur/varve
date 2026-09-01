import { type ButtonHTMLAttributes, forwardRef, useState } from 'react';
import { Spinner } from './Spinner';
import { useDelayedLoading } from './useDelayedLoading';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'pill' | 'pill-outline';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Accessible name while the action is pending (defaults to the button name). */
  loadingLabel?: string;
  /** When true, disabled state uses aria-disabled (focusable) instead of HTML disabled. */
  softDisabled?: boolean;
  /** For danger variant: show a confirm toggle before firing onClick. */
  confirmLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    disabled = false,
    softDisabled = false,
    confirmLabel,
    className = '',
    children,
    onClick,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const [confirming, setConfirming] = useState(false);
  const showLoading = useDelayedLoading(loading);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || softDisabled || loading) return;
    if (variant === 'danger' && confirmLabel && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onClick?.(e);
  };

  const isHtmlDisabled = !loading && !softDisabled && disabled;
  const isAriaDisabled = loading || softDisabled;

  const classes = [
    'varve-btn',
    `varve-btn--${variant}`,
    `varve-btn--${size}`,
    showLoading ? 'varve-btn--loading' : '',
    confirming ? 'varve-btn--confirming' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      className={classes}
      disabled={isHtmlDisabled || undefined}
      aria-disabled={isAriaDisabled || undefined}
      aria-busy={loading || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      onClick={handleClick}
      {...rest}
    >
      {showLoading && <Spinner size="sm" />}
      <span className="varve-btn__content">
        {confirming && confirmLabel ? (
          <>
            <span className="varve-btn__label">{children}</span>
            {confirmLabel}
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
});
