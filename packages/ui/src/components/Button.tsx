import { type ButtonHTMLAttributes, forwardRef, useState } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
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
    disabled = false,
    softDisabled = false,
    confirmLabel,
    className = '',
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const [confirming, setConfirming] = useState(false);

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
    'strata-btn',
    `strata-btn--${variant}`,
    `strata-btn--${size}`,
    loading ? 'strata-btn--loading' : '',
    confirming ? 'strata-btn--confirming' : '',
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
      onClick={handleClick}
      {...rest}
    >
      {loading && (
        <svg
          className="strata-btn__spinner"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <title>Loading</title>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      )}
      <span className="strata-btn__content">
        {confirming && confirmLabel ? (
          <>
            <span className="strata-btn__label">{children}</span>
            {confirmLabel}
          </>
        ) : (
          children
        )}
      </span>
    </button>
  );
});

export { IconButton } from './IconButton';
