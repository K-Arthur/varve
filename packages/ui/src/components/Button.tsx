import { type ButtonHTMLAttributes, forwardRef, useState } from 'react';
import { InlineActivityIndicator } from './InlineActivityIndicator';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'pill' | 'pill-outline';
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
    'varve-btn',
    `varve-btn--${variant}`,
    `varve-btn--${size}`,
    loading ? 'varve-btn--loading' : '',
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
      onClick={handleClick}
      {...rest}
    >
      {loading && <InlineActivityIndicator size={16} />}
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
