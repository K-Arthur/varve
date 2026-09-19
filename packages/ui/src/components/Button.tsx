import { type ButtonHTMLAttributes, forwardRef, useEffect, useId, useState } from 'react';
import { Spinner } from './Spinner';
import { useDelayedLoading } from './useDelayedLoading';

/**
 * The small, semantic action vocabulary shared by editor and home surfaces.
 *
 * `toolbar` is intentionally a visual density variant only; persistent
 * selection belongs to ToggleButton/ToggleGroup, not to Button.
 */
export const BUTTON_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'destructive',
  'link',
  'toolbar',
] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/** Text controls and explicit icon-only controls share one geometry scale. */
export const BUTTON_SIZES = [
  'xs',
  'sm',
  'md',
  'lg',
  'icon-xs',
  'icon-sm',
  'icon',
  'icon-lg',
] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Accessible name while the action is pending (defaults to the button name). */
  loadingLabel?: string;
  /** When true, disabled state uses aria-disabled (focusable) instead of HTML disabled. */
  softDisabled?: boolean;
  /**
   * Why the action is unavailable. Pair it with `disabled`/`softDisabled`;
   * when unavailable, the control stays focusable (aria-disabled instead of
   * HTML disabled) and the reason reaches assistive technology and pointer
   * users, so a disabled button is never a communication dead end
   * (NN/g, GOV.UK, Shopify Polaris guidance).
   */
  disabledReason?: string;
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
    disabledReason,
    confirmLabel,
    type = 'button',
    className = '',
    children,
    onClick,
    onBlur,
    title,
    'aria-label': ariaLabel,
    'aria-disabled': ariaDisabled,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const [confirming, setConfirming] = useState(false);
  const showLoading = useDelayedLoading(loading);
  const reasonId = useId();
  const reasonActive = disabledReason !== undefined && (disabled || softDisabled) && !loading;
  const unavailable = loading || softDisabled || disabled;

  useEffect(() => {
    if (variant !== 'destructive' || !confirmLabel || disabled || softDisabled || loading) {
      setConfirming(false);
    }
  }, [variant, confirmLabel, disabled, softDisabled, loading]);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (unavailable) return;
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

  const isHtmlDisabled = !loading && !softDisabled && !reasonActive && disabled;
  const isAriaDisabled = loading || softDisabled || reasonActive;

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

  const describedBy =
    [ariaDescribedBy, reasonActive ? reasonId : undefined].filter(Boolean).join(' ') || undefined;

  return (
    <>
      <button
        {...rest}
        ref={ref}
        className={classes}
        type={type}
        disabled={isHtmlDisabled || undefined}
        aria-disabled={ariaDisabled ?? (isAriaDisabled || undefined)}
        aria-busy={loading || undefined}
        aria-label={loading && loadingLabel ? loadingLabel : ariaLabel}
        aria-describedby={describedBy}
        title={title ?? (reasonActive ? disabledReason : undefined)}
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
      {reasonActive && (
        <span id={reasonId} className="varve-visually-hidden">
          {disabledReason}
        </span>
      )}
    </>
  );
});
