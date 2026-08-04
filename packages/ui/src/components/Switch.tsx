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
      className={`varve-switch${
        disabled ? ' varve-switch--disabled' : ''
      }${className ? ` ${className}` : ''}`}
      htmlFor={switchId}
    >
      {labelPosition === 'start' && label && <span className="varve-switch__label">{label}</span>}
      <input
        ref={ref}
        id={switchId}
        type="checkbox"
        role="switch"
        className="varve-switch__input"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        {...rest}
      />
      <span className="varve-switch__track" aria-hidden="true">
        <span className="varve-switch__thumb" />
      </span>
      {labelPosition === 'end' && label && <span className="varve-switch__label">{label}</span>}
    </label>
  );
});
