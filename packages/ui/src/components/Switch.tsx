import { forwardRef, type InputHTMLAttributes, useId } from 'react';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label?: string;
  /** When true, renders the label to the right of the track (default). */
  labelPosition?: 'start' | 'end';
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, labelPosition = 'end', className = '', id, checked, disabled, ...rest },
  ref,
) {
  const generatedId = useId();
  const switchId = id || generatedId;

  return (
    <label
      className={`strata-switch${
        disabled ? ' strata-switch--disabled' : ''
      }${className ? ` ${className}` : ''}`}
      htmlFor={switchId}
    >
      {labelPosition === 'start' && label && <span className="strata-switch__label">{label}</span>}
      <input
        ref={ref}
        id={switchId}
        type="checkbox"
        role="switch"
        className="strata-switch__input"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        {...rest}
      />
      <span className="strata-switch__track" aria-hidden="true">
        <span className="strata-switch__thumb" />
      </span>
      {labelPosition === 'end' && label && <span className="strata-switch__label">{label}</span>}
    </label>
  );
});
