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
    'varve-textarea',
    `varve-textarea--${size}`,
    focused ? 'varve-textarea--focused' : '',
    error ? 'varve-textarea--error' : '',
    disabled ? 'varve-textarea--disabled' : '',
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
        <label className="varve-textarea__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        className="varve-textarea__field"
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
      <div className="varve-textarea__footer">
        {error ? (
          <span className="varve-textarea__error" id={errorId} role="alert">
            {error}
          </span>
        ) : hint ? (
          <span className="varve-textarea__hint" id={hintId}>
            {hint}
          </span>
        ) : (
          <span />
        )}
        {maxLength && (
          <span className="varve-textarea__counter">
            {currentLength}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
});
