/**
 * Varve `<Checkbox>` — accessible checkbox (design system refresh).
 *
 * Uses filled icons via SolidIcon for the checkmark. Follows APG Checkbox pattern
 * with proper ARIA attributes and keyboard navigation. Supports indeterminate state.
 */

import { forwardRef, useId } from 'react';
import { SolidIcon } from '../icons/SolidIcon';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
  /** Optional description linked via aria-describedby. */
  description?: string;
  /** Optional error message linked via aria-describedby. */
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, description, error, className = '', id, ...rest },
  ref,
) {
  const generatedId = useId();
  const checkboxId = id || generatedId;
  const errorId = `${checkboxId}-error`;
  const descriptionId = description ? `${checkboxId}-description` : undefined;

  const describedBy = [error ? errorId : undefined, descriptionId].filter(Boolean).join(' ') || undefined;

  return (
    <label className={`varve-checkbox${className ? ` ${className}` : ''}`}>
      <input
        ref={ref}
        id={checkboxId}
        type="checkbox"
        className="varve-checkbox__input"
        data-indeterminate={indeterminate ? 'true' : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
        // WCAG 4.1.2 (2026-08-10): indeterminate must be announced as
        // aria-checked="mixed", not just drawn as a minus icon.
        aria-checked={
          indeterminate
            ? 'mixed'
            : rest.checked === undefined
              ? undefined
              : rest.checked
                ? 'true'
                : 'false'
        }
      />
      <span className="varve-checkbox__box">
        <SolidIcon name="Check" className="varve-checkbox__check" />
        <SolidIcon name="Minus" className="varve-checkbox__indeterminate" />
      </span>
      {label && <span className="varve-checkbox__label">{label}</span>}
      {description && (
        <span className="varve-checkbox__description" id={descriptionId}>
          {description}
        </span>
      )}
      {error && (
        <span className="varve-checkbox__error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </label>
  );
});
