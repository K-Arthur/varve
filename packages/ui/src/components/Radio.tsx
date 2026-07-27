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
      className={`strata-radio-group strata-radio-group--${orientation}`}
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
    >
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`strata-radio${checked ? ' strata-radio--checked' : ''}${
              opt.disabled || disabled ? ' strata-radio--disabled' : ''
            }`}
          >
            <input
              type="radio"
              name={name || groupName}
              value={opt.value}
              checked={checked}
              disabled={opt.disabled || disabled}
              onChange={() => onChange(opt.value)}
              className="strata-radio__input"
            />
            <span className="strata-radio__dot" aria-hidden="true" />
            <span className="strata-radio__label">{opt.label}</span>
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
    <label className={`strata-radio${className ? ` ${className}` : ''}`}>
      <input ref={ref} type="radio" className="strata-radio__input" {...rest} />
      <span className="strata-radio__dot" aria-hidden="true" />
      {label && <span className="strata-radio__label">{label}</span>}
    </label>
  );
});
