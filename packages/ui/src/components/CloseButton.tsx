import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { SemanticIcon } from '../icons';

/**
 * The one dismiss control in the application.
 *
 * Every close/X affordance routes through this component so the visible size,
 * hit region, glyph weight, colour ramp, and focus treatment cannot drift per
 * surface. See `docs/architecture/interface-sizing-system.md` § Close
 * affordance for the audit that motivated it.
 */
export const CLOSE_BUTTON_SIZES = ['sm', 'md', 'lg'] as const;
export type CloseButtonSize = (typeof CLOSE_BUTTON_SIZES)[number];

export interface CloseButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * `sm` (24px) tabs, toasts, and dense rows; `md` (32px) panels and
   * popovers; `lg` (44px) modal dialogs.
   */
  size?: CloseButtonSize;
  /**
   * Accessible name. Keep it scoped to what is being dismissed
   * ("Close dialog", "Close Grain parameters") — a bare "Close" is ambiguous
   * when several dismissable surfaces are mounted at once.
   */
  label?: string;
}

export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function CloseButton(
  { size = 'md', label = 'Close', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`varve-close varve-close--${size}${className ? ` ${className}` : ''}`}
      aria-label={label}
      {...rest}
    >
      <SemanticIcon name="Close" className="varve-close__glyph" aria-hidden="true" />
    </button>
  );
});
