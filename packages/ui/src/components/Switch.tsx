import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import './Switch.css';

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role' | 'size'> {
  /** Optional inline label. Use SwitchField when supporting copy is needed. */
  label?: ReactNode;
  /** When true, renders the label to the right of the track (default). */
  labelPosition?: 'start' | 'end';
  /** Compact is the default editor density; default is useful in settings rows. */
  size?: 'compact' | 'default';
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  {
    label,
    labelPosition = 'end',
    size = 'compact',
    className = '',
    id,
    checked,
    defaultChecked,
    disabled,
    onChange,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const switchId = id || generatedId;
  const isControlled = checked !== undefined;
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renderedChecked = isControlled ? checked : uncontrolledChecked;

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

  // Native inputs reset themselves, but the component also owns the
  // aria-checked value for uncontrolled switches. Keep the two in sync when
  // the switch participates in a form reset without mirroring controlled
  // props into local state.
  useEffect(() => {
    if (isControlled) return;
    const form = inputRef.current?.form;
    if (!form) return;
    const handleReset = () => {
      setUncontrolledChecked(inputRef.current?.defaultChecked ?? false);
    };
    form.addEventListener('reset', handleReset);
    return () => form.removeEventListener('reset', handleReset);
  }, [isControlled]);

  const handleChange: NonNullable<SwitchProps['onChange']> = (event) => {
    if (!isControlled) setUncontrolledChecked(event.currentTarget.checked);
    onChange?.(event);
  };

  return (
    <label
      className={`varve-switch varve-switch--${size}${
        disabled ? ' varve-switch--disabled' : ''
      }${className ? ` ${className}` : ''}`}
      data-state={renderedChecked ? 'checked' : 'unchecked'}
      data-disabled={disabled || undefined}
      htmlFor={switchId}
    >
      {labelPosition === 'start' && label && <span className="varve-switch__label">{label}</span>}
      <input
        ref={inputRef}
        id={switchId}
        type="checkbox"
        role="switch"
        className="varve-switch__input"
        checked={isControlled ? checked : undefined}
        defaultChecked={isControlled ? undefined : defaultChecked}
        disabled={disabled}
        aria-checked={renderedChecked}
        onChange={handleChange}
        {...rest}
      />
      <span className="varve-switch__track" aria-hidden="true">
        <span className="varve-switch__thumb" />
      </span>
      {labelPosition === 'end' && label && <span className="varve-switch__label">{label}</span>}
    </label>
  );
});

export interface SwitchFieldProps
  extends Omit<
    SwitchProps,
    | 'label'
    | 'labelPosition'
    | 'size'
    | 'id'
    | 'aria-label'
    | 'aria-labelledby'
    | 'aria-describedby'
    | 'className'
  > {
  label: ReactNode;
  description?: ReactNode;
  /** Supporting copy for a disabled dependent setting. */
  disabledReason?: ReactNode;
  className?: string;
  id?: string;
  'aria-describedby'?: string;
}

/**
 * A compact setting row with a stable label/description relationship.
 * The switch stays a separate primitive so toolbars and dense inspector rows
 * do not inherit settings-row layout.
 */
export function SwitchField({
  label,
  description,
  disabledReason,
  className = '',
  id,
  ...switchProps
}: SwitchFieldProps) {
  const generatedId = useId();
  const switchId = id ?? `${generatedId}-switch`;
  const descriptionId = description ? `${switchId}-description` : undefined;
  const disabledReasonId = disabledReason ? `${switchId}-disabled-reason` : undefined;
  const callerDescribedBy = switchProps['aria-describedby'];
  const describedBy =
    [callerDescribedBy, descriptionId, disabledReasonId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`varve-switch-field${className ? ` ${className}` : ''}`}>
      <div className="varve-switch-field__content">
        <label className="varve-switch-field__label" htmlFor={switchId}>
          {label}
        </label>
        {description && (
          <div className="varve-switch-field__description" id={descriptionId}>
            {description}
          </div>
        )}
        {disabledReason && (
          <div className="varve-switch-field__disabled-reason" id={disabledReasonId}>
            {disabledReason}
          </div>
        )}
      </div>
      <Switch
        {...switchProps}
        id={switchId}
        aria-describedby={describedBy}
        aria-label={undefined}
        className="varve-switch-field__control"
      />
    </div>
  );
}
