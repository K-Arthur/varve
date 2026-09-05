import type { SVGAttributes } from 'react';
import './Spinner.css';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps extends Omit<SVGAttributes<SVGSVGElement>, 'aria-label' | 'role'> {
  /** Visual size. Keep the set small so loading hierarchy stays predictable. */
  size?: SpinnerSize;
  /** Accessible name for a standalone spinner. Prefer LoadingLabel when text is visible. */
  label?: string;
}

/**
 * Lightweight indeterminate activity indicator.
 *
 * The spinner is intentionally CSS/SVG-only: it has no timers, Motion
 * dependency, injected styles, or semantic colour variants. When a visible
 * task label is present the SVG is decorative and the parent status region
 * owns the announcement.
 */
export function Spinner({ size = 'sm', label, className = '', ...rest }: SpinnerProps) {
  const classes = ['varve-spinner', `varve-spinner--${size}`, className].filter(Boolean).join(' ');

  return (
    <svg
      {...rest}
      className={classes}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {label && <title>{label}</title>}
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
