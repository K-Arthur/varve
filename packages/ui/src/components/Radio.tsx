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

export interface RadioGroupItemProps<V extends string> extends RadioOption<V> {
  id: string;
  name: string;
  checked: boolean;
  required?: boolean;
  onChange: () => void;
  variant?: 'compact' | 'row' | 'card';
}

/** A native radio item used by RadioGroup and composable choice surfaces. */
export function RadioGroupItem<V extends string>({
  id,
  name,
  value,
  label,
  description,
  icon,
  meta,
  checked,
  required = false,
  disabled = false,
  variant = 'compact',
  onChange,
}: RadioGroupItemProps<V>) {
  const optionLabelId = `${id}-label`;
  const optionDescriptionId = description ? `${id}-description` : undefined;
  return (
    <label
      htmlFor={id}
      className={`varve-radio varve-radio--${variant}${checked ? ' varve-radio--checked' : ''}${
        disabled ? ' varve-radio--disabled' : ''
      }`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        required={required}
        aria-labelledby={optionLabelId}
        aria-describedby={optionDescriptionId}
        onChange={onChange}
        className="varve-radio__input"
      />
      <span className="varve-radio__dot" aria-hidden="true" />
      <span className="varve-radio__content">
        {icon && (
          <span className="varve-radio__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <span className="varve-radio__text">
          <span id={optionLabelId} className="varve-radio__label">
            {label}
          </span>
          {description && (
            <span id={optionDescriptionId} className="varve-radio__option-description">
              {description}
            </span>
          )}
        </span>
        {meta && <span className="varve-radio__meta">{meta}</span>}
      </span>
    </label>
  );
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
      {options.map((opt, index) => (
        <RadioGroupItem
          key={opt.value}
          id={`${generatedId}-option-${index}`}
          name={groupName}
          {...opt}
          checked={opt.value === selectedValue}
          disabled={disabled || opt.disabled}
          required={required && index === firstEnabledIndex}
          variant={variant}
          onChange={() => handleChange(opt.value)}
        />
      ))}
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
