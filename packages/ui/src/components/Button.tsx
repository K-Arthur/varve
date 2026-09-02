import { type ButtonHTMLAttributes, forwardRef, useEffect, useState } from 'react';
import { Spinner } from './Spinner';
import { useDelayedLoading } from './useDelayedLoading';

/**
 * The small, semantic action vocabulary shared by editor and home surfaces.
 *
 * `toolbar` is intentionally a visual density variant only; persistent
 * selection belongs to ToggleButton/ToggleGroup, not to Button.
 */
export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'link'
  | 'toolbar';

/** Text controls and explicit icon-only controls share one geometry scale. */
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Accessible name while the action is pending (defaults to the button name). */
  loadingLabel?: string;
  /** When true, disabled state uses aria-disabled (focusable) instead of HTML disabled. */
  softDisabled?: boolean;
  /** For destructive actions: show a confirm toggle before firing onClick. */
  confirmLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    loading = false,
    loadingLabel,
    disabled = false,
    softDisabled = false,
    confirmLabel,
    type = 'button',
    className = '',
    children,
    onClick,
    onBlur,
    'aria-label': ariaLabel,
    'aria-disabled': ariaDisabled,
    ...rest
  },
  ref,
) {
  const [confirming, setConfirming] = useState(false);
  const showLoading = useDelayedLoading(loading);

  useEffect(() => {
    if (variant !== 'destructive' || !confirmLabel || disabled || softDisabled || loading) {
      setConfirming(false);
    }
  }, [variant, confirmLabel, disabled, softDisabled, loading]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || softDisabled || loading) return;
    if (variant === 'destructive' && confirmLabel && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onClick?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLButtonElement>) => {
    setConfirming(false);
    onBlur?.(e);
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
      {...rest}
      ref={ref}
      className={classes}
      type={type}
      disabled={isHtmlDisabled || undefined}
      aria-disabled={ariaDisabled ?? (isAriaDisabled || undefined)}
      aria-busy={loading || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
      onClick={handleClick}
      onBlur={handleBlur}
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
