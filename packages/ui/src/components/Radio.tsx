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
  id?: string;
  value?: V;
  defaultValue?: V;
  options: readonly RadioOption<V>[];
  onChange?: (value: V) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  variant?: 'compact' | 'row' | 'card';
  columns?: 1 | 2 | 3;
  description?: string;
  error?: string;
}

export function RadioGroup<V extends string>({
  label,
  id: providedId,
  value,
  defaultValue,
  options,
  onChange = () => {},
  name,
  required = false,
  disabled = false,
  orientation = 'vertical',
  variant = 'compact',
  columns,
  description,
  error,
}: RadioGroupProps<V>) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const labelId = `${generatedId}-label`;
  const [uncontrolledValue, setUncontrolledValue] = useState<V | undefined>(defaultValue);
  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : uncontrolledValue;
  const helpId = description ? `${generatedId}-description` : undefined;
  const errorId = error ? `${generatedId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const groupName = name ?? `${generatedId}-options`;
  const firstEnabledIndex = options.findIndex((opt) => !disabled && !opt.disabled);

  const handleChange = (nextValue: V) => {
    if (!isControlled) setUncontrolledValue(nextValue);
    onChange(nextValue);
  };

  return (
    <fieldset
      id={id}
      className={`varve-radio-group varve-radio-group--${orientation} varve-radio-group--${variant}${
        columns ? ` varve-radio-group--columns-${columns}` : ''
      }${error ? ' varve-radio-group--invalid' : ''}`}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: native fieldset grouping is retained while the explicit role preserves the radio-group contract
      role="radiogroup"
      aria-labelledby={labelId}
      aria-orientation={orientation === 'horizontal' ? 'horizontal' : 'vertical'}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
    >
      <legend id={labelId} className="varve-radio-group__legend">
        {label}
      </legend>
      {description && (
        <p id={helpId} className="varve-radio-group__description">
          {description}
        </p>
      )}
      {options.map((opt, index) => {
        const checked = opt.value === selectedValue;
        const optionId = `${generatedId}-option-${index}`;
        const optionLabelId = `${optionId}-label`;
        const optionDescriptionId = opt.description ? `${optionId}-description` : undefined;
        const optionDisabled = opt.disabled || disabled;
        return (
          <label
            key={opt.value}
            htmlFor={optionId}
            className={`varve-radio${checked ? ' varve-radio--checked' : ''}${
              optionDisabled ? ' varve-radio--disabled' : ''
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={groupName}
              value={opt.value}
              checked={checked}
              disabled={optionDisabled}
              required={required && index === firstEnabledIndex}
              aria-labelledby={optionLabelId}
              aria-describedby={optionDescriptionId}
              onChange={() => handleChange(opt.value)}
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
                <span id={optionLabelId} className="varve-radio__label">
                  {opt.label}
                </span>
                {opt.description && (
                  <span id={optionDescriptionId} className="varve-radio__option-description">
                    {opt.description}
                  </span>
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
    </fieldset>
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
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...inputProps
}: RadioOptionProps<V>) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <label
      className={`varve-radio varve-radio--${variant}${className ? ` ${className}` : ''}`}
      htmlFor={id}
    >
      <input
        id={id}
        type="radio"
        value={value}
        className="varve-radio__input"
        aria-labelledby={ariaLabelledBy ?? labelId}
        aria-describedby={[ariaDescribedBy, descriptionId].filter(Boolean).join(' ') || undefined}
        {...inputProps}
      />
      <span className="varve-radio__dot" aria-hidden="true" />
      <span className="varve-radio__content">
        {icon && (
          <span className="varve-radio__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="varve-radio__text">
          <span id={labelId} className="varve-radio__label">
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="varve-radio__option-description">
              {description}
            </span>
          )}
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
