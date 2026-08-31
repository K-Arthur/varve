import { forwardRef, type InputHTMLAttributes, type ReactNode, useId, useState } from 'react';

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string> {
  label: string;
  value?: V;
  defaultValue?: V;
  options: readonly RadioOption<V>[];
  onChange?: (value: V) => void;
  name?: string;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'compact' | 'row' | 'card';
  columns?: 1 | 2 | 3;
  description?: string;
  error?: string;
}

export function RadioGroup<V extends string>({
  label,
  value,
  defaultValue,
  options,
  onChange = () => {},
  name,
  disabled = false,
  orientation = 'vertical',
  variant = 'compact',
  columns,
  description,
  error,
}: RadioGroupProps<V>) {
  const id = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState<V | undefined>(defaultValue);
  const selectedValue = value === undefined ? uncontrolledValue : value;
  const helpId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={`varve-radio-group varve-radio-group--${orientation} varve-radio-group--${variant}${
        columns ? ` varve-radio-group--columns-${columns}` : ''
      }${error ? ' varve-radio-group--invalid' : ''}`}
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      aria-describedby={describedBy}
    >
      <legend className="varve-radio-group__legend">{label}</legend>
      {description && (
        <p id={helpId} className="varve-radio-group__description">
          {description}
        </p>
      )}
      {options.map((opt) => {
        const checked = opt.value === selectedValue;
        const optionId = `${id}-${opt.value}`;
        return (
          <label
            key={opt.value}
            htmlFor={optionId}
            className={`varve-radio${checked ? ' varve-radio--checked' : ''}${
              opt.disabled || disabled ? ' varve-radio--disabled' : ''
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={name || id}
              value={opt.value}
              checked={checked}
              disabled={opt.disabled || disabled}
              aria-invalid={error ? true : undefined}
              onChange={() => {
                setUncontrolledValue(opt.value);
                onChange(opt.value);
              }}
              className="varve-radio__input"
            />
            <span className="varve-radio__dot" aria-hidden="true" />
            <span className="varve-radio__content">
              {opt.icon && (
                <span className="varve-radio__icon" aria-hidden="true">
                  {opt.icon}
                </span>
              )}
              <span className="varve-radio__text">
                <span className="varve-radio__label">{opt.label}</span>
                {opt.description && (
                  <span className="varve-radio__option-description">{opt.description}</span>
                )}
              </span>
              {opt.meta && <span className="varve-radio__meta">{opt.meta}</span>}
            </span>
          </label>
        );
      })}
      {error && (
        <p id={errorId} className="varve-radio-group__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface RadioOptionProps<V extends string>
  extends RadioOption<V>,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'disabled'> {
  name: string;
  checked?: boolean;
  disabled?: boolean;
  variant?: 'compact' | 'row' | 'card';
}

/** A labeled radio for composing groups that need custom layout or markup. */
export function RadioOption<V extends string>({
  value,
  label,
  description,
  icon,
  meta,
  variant = 'compact',
  className = '',
  ...inputProps
}: RadioOptionProps<V>) {
  const id = useId();
  return (
    <label
      className={`varve-radio varve-radio--${variant}${className ? ` ${className}` : ''}`}
      htmlFor={id}
    >
      <input id={id} type="radio" value={value} className="varve-radio__input" {...inputProps} />
      <span className="varve-radio__dot" aria-hidden="true" />
      <span className="varve-radio__content">
        {icon && (
          <span className="varve-radio__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="varve-radio__text">
          <span className="varve-radio__label">{label}</span>
          {description && <span className="varve-radio__option-description">{description}</span>}
        </span>
        {meta && <span className="varve-radio__meta">{meta}</span>}
      </span>
    </label>
  );
}

export const RadioCard = forwardRef<HTMLDivElement, Omit<RadioOptionProps<string>, 'variant'>>(
  function RadioCard(props, ref) {
    return (
      <div ref={ref} className="varve-radio-card">
        <RadioOption {...props} variant="card" />
      </div>
    );
  },
);

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
