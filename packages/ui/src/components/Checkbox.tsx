/**
 * Strata `<Checkbox>` — accessible checkbox (design system refresh).
 *
 * Uses filled icons via SolidIcon for the checkmark. Follows APG Checkbox pattern
 * with proper ARIA attributes and keyboard navigation. Supports indeterminate state.
 */

import { forwardRef, useId } from 'react';
import { SolidIcon } from '../icons/SolidIcon';

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  indeterminate?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, className = '', id, ...rest },
  ref,
) {
  const generatedId = useId();
  const checkboxId = id || generatedId;

  return (
    <label className={`strata-checkbox${className ? ` ${className}` : ''}`}>
      <input
        ref={ref}
        id={checkboxId}
        type="checkbox"
        className="strata-checkbox__input"
        data-indeterminate={indeterminate || undefined}
        {...rest}
      />
      <span className="strata-checkbox__box">
        <SolidIcon name="Check" className="strata-checkbox__check" />
        <SolidIcon name="Minus" className="strata-checkbox__indeterminate" />
      </span>
      {label && <span className="strata-checkbox__label">{label}</span>}
    </label>
  );
});
