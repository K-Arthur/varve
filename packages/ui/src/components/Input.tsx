import { forwardRef, type InputHTMLAttributes, useId, useState } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Prefix element (icon or text) rendered inside the input field. */
  prefix?: React.ReactNode;
  /** Suffix element (icon or text) rendered inside the input field. */
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, size = 'md', prefix, suffix, id, className = '', disabled, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [focused, setFocused] = useState(false);

  const classes = [
    'strata-input',
    `strata-input--${size}`,
    focused ? 'strata-input--focused' : '',
    error ? 'strata-input--error' : '',
    disabled ? 'strata-input--disabled' : '',
    prefix ? 'strata-input--has-prefix' : '',
    suffix ? 'strata-input--has-suffix' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={classes}>
      {label && (
        <label className="strata-input__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="strata-input__wrapper">
        {prefix && <span className="strata-input__prefix">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className="strata-input__field"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          {...rest}
        />
        {suffix && <span className="strata-input__suffix">{suffix}</span>}
      </div>
      {error && (
        <span className="strata-input__error" id={errorId} role="alert">
          {error}
        </span>
      )}
      {hint && !error && (
        <span className="strata-input__hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
});
