import type { ChangeEvent, SelectHTMLAttributes } from 'react';
import type { SelectOption, SelectOptionGroup } from './Select';

export interface NativeSelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'defaultValue' | 'onChange' | 'value'> {
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  description?: string;
  error?: string;
}

export function NativeSelect({
  options = [],
  groups = [],
  label,
  value,
  defaultValue,
  onValueChange,
  onChange,
  placeholder,
  description,
  error,
  id,
  className,
  disabled,
  ...selectProps
}: NativeSelectProps) {
  const controlId =
    id ?? `varve-native-select-${label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [
      selectProps['aria-describedby'],
      description ? descriptionId : undefined,
      error ? errorId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    (onValueChange ?? onChange)?.(event.target.value);
  };

  return (
    <div className={['varve-native-select', className].filter(Boolean).join(' ')}>
      <label className="varve-native-select__label" htmlFor={controlId}>
        {label}
      </label>
      <select
        {...selectProps}
        id={controlId}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`varve-native-select__control${error ? ' varve-native-select__control--error' : ''}`}
        onChange={handleChange}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {description && (
        <div id={descriptionId} className="varve-native-select__description">
          {description}
        </div>
      )}
      {error && (
        <div id={errorId} className="varve-native-select__error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
