import { cloneElement, Fragment, isValidElement, type ReactElement } from 'react';
import './ShineBorder.css';

export type ShineBorderVariant = 'static' | 'subtle' | 'beam';
export type ShineBorderTone = 'accent' | 'success';

export interface ShineBorderProps {
  /**
   * One className-forwarding host element. ShineBorder clones this element so
   * its layout role, radius, dimensions, semantics, ref, and focus order stay
   * unchanged.
   */
  children: ReactElement<{ className?: string }>;
  /** Static fallback, hover-only subtle movement, or one state-triggered cycle. */
  variant?: ShineBorderVariant;
  /** Semantic token family; arbitrary gradient strings are intentionally unsupported. */
  tone?: ShineBorderTone;
  /** State gate. Toggling false -> true replays the beam variant. */
  active?: boolean;
  /** Suppress only the decoration; child disabled semantics remain child-owned. */
  disabled?: boolean;
  /** Additional class applied to the existing host element. */
  className?: string;
}

/**
 * Decorative, zero-wrapper border emphasis for rare product states.
 *
 * @maturity beta
 */
export function ShineBorder({
  children,
  variant = 'subtle',
  tone = 'accent',
  active = true,
  disabled = false,
  className = '',
}: ShineBorderProps) {
  if (!isValidElement(children) || children.type === Fragment) {
    throw new Error('ShineBorder requires exactly one className-forwarding host element.');
  }

  const classes = [
    children.props.className,
    'varve-shine-border',
    `varve-shine-border--${variant}`,
    `varve-shine-border--tone-${tone}`,
    active && !disabled ? 'varve-shine-border--active' : '',
    disabled ? 'varve-shine-border--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return cloneElement(children, { className: classes });
}
