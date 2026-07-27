import { forwardRef, type TextareaHTMLAttributes, useId, useState } from 'react';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Maximum character count; when provided shows a counter. */
  maxLength?: number;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, size = 'md', maxLength, id, className = '', disabled, value, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  const [focused, setFocused] = useState(false);

  const classes = [
    'strata-textarea',
    `strata-textarea--${size}`,
    focused ? 'strata-textarea--focused' : '',
    error ? 'strata-textarea--error' : '',
    disabled ? 'strata-textarea--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const currentLength = typeof value === 'string' ? value.length : 0;

  return (
    <div className={classes}>
      {label && (
        <label className="strata-textarea__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        className="strata-textarea__field"
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        value={value}
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
      <div className="strata-textarea__footer">
        {error ? (
          <span className="strata-textarea__error" id={errorId} role="alert">
            {error}
          </span>
        ) : hint ? (
          <span className="strata-textarea__hint" id={hintId}>
            {hint}
          </span>
        ) : (
          <span />
        )}
        {maxLength && (
          <span className="strata-textarea__counter">
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});
