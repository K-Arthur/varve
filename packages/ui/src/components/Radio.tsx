import { forwardRef, type InputHTMLAttributes, useId } from 'react';

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  label: string;
  value: V;
  options: readonly RadioOption<V>[];
  onChange: (value: V) => void;
  name?: string;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
}

export function RadioGroup<V extends string>({
  label,
  value,
  options,
  onChange,
  name,
  disabled = false,
  orientation = 'vertical',
}: RadioGroupProps<V>) {
  const groupName = useId();

  return (
    <div
      className={`varve-radio-group varve-radio-group--${orientation}`}
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
    >
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`varve-radio${checked ? ' varve-radio--checked' : ''}${
              opt.disabled || disabled ? ' varve-radio--disabled' : ''
            }`}
          >
            <input
              type="radio"
              name={name || groupName}
              value={opt.value}
              checked={checked}
              disabled={opt.disabled || disabled}
              onChange={() => onChange(opt.value)}
              className="varve-radio__input"
            />
            <span className="varve-radio__dot" aria-hidden="true" />
            <span className="varve-radio__label">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, className = '', ...rest },
  ref,
) {
  return (
    <label className={`varve-radio${className ? ` ${className}` : ''}`}>
      <input ref={ref} type="radio" className="varve-radio__input" {...rest} />
      <span className="varve-radio__dot" aria-hidden="true" />
      {label && <span className="varve-radio__label">{label}</span>}
    </label>
  );
});
