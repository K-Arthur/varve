/**
 * Field — composable label/control foundation for Varve.
 *
 * Provides the shared vocabulary for label, description, error, hint, and
 * status across compact inspector rows and spacious dialog forms. Every
 * control surface composes these pieces instead of re-implementing label
 * typography, description spacing, or error association from scratch.
 *
 * Usage:
 *   // Compact inspector row
 *   <Field layout="row">
 *     <FieldLabel htmlFor={id}>X</FieldLabel>
 *     <FieldControl><input id={id} /></FieldControl>
 *   </Field>
 *
 *   // Standard form field
 *   <Field>
 *     <FieldLabel htmlFor={id}>Email</FieldLabel>
 *     <input id={id} />
 *     <FieldDescription>We won't share this.</FieldDescription>
 *     <FieldError>Invalid email.</FieldError>
 *   </Field>
 */
import { type ReactNode, useId } from 'react';

export interface FieldProps {
  children: ReactNode;
  /** Layout direction. 'column' (default) stacks label above control; 'row' places them side-by-side. */
  layout?: 'column' | 'row';
  /** When true, the fieldset renders with disabled styling and disables all nested controls. */
  disabled?: boolean;
  /** HTML element to render. 'div' is the default; 'fieldset' adds group semantics. */
  as?: 'div' | 'fieldset';
  className?: string;
}

export function Field({
  children,
  layout = 'column',
  disabled,
  as: Tag = 'div',
  className = '',
}: FieldProps) {
  const layoutClass = layout === 'row' ? ' varve-field--row' : '';
  const disabledClass = disabled ? ' varve-field--disabled' : '';
  return (
    <Tag
      className={`varve-field${layoutClass}${disabledClass}${className ? ` ${className}` : ''}`}
      {...(Tag === 'fieldset' ? { disabled } : {})}
    >
      {children}
    </Tag>
  );
}

export interface FieldLabelProps {
  children: ReactNode;
  /** Associates the label with a control via htmlFor. */
  htmlFor?: string;
  /** When true, the label is visually hidden but remains the accessible name. */
  visuallyHidden?: boolean;
  /** When true, shows a required indicator after the label. */
  required?: boolean;
  /** When true, shows an "Optional" marker after the label. */
  optional?: boolean;
  className?: string;
}

export function FieldLabel({
  children,
  htmlFor,
  visuallyHidden,
  required,
  optional,
  className = '',
}: FieldLabelProps) {
  const classes = [
    'varve-field__label',
    visuallyHidden ? 'varve-visually-hidden' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={classes} htmlFor={htmlFor}>
      {children}
      {required && <span className="varve-field__required" aria-hidden="true"> *</span>}
      {optional && <span className="varve-field__optional"> (Optional)</span>}
    </label>
  );
}

export interface FieldDescriptionProps {
  children: ReactNode;
  id?: string;
  className?: string;
}

export function FieldDescription({ children, id, className = '' }: FieldDescriptionProps) {
  return (
    <p className={`varve-field__description${className ? ` ${className}` : ''}`} id={id}>
      {children}
    </p>
  );
}

export interface FieldErrorProps {
  children: ReactNode;
  id?: string;
  className?: string;
}

export function FieldError({ children, id, className = '' }: FieldErrorProps) {
  return (
    <p
      className={`varve-field__error${className ? ` ${className}` : ''}`}
      id={id}
      role="alert"
    >
      {children}
    </p>
  );
}

export interface FieldControlProps {
  children: ReactNode;
  className?: string;
}

export function FieldControl({ children, className = '' }: FieldControlProps) {
  return (
    <div className={`varve-field__control${className ? ` ${className}` : ''}`}>{children}</div>
  );
}

/**
 * Internal hook for form components that render their own label/description/error.
 * Generates stable IDs and merges aria-describedby relationships.
 */
export function useFieldIds(controlId?: string) {
  const autoId = useId();
  const id = controlId || autoId;
  const errorId = `${id}-error`;
  const descriptionId = `${id}-description`;
  const hintId = `${id}-hint`;

  function mergeDescribedBy(
    callerDescribedBy?: string,
    ...ids: (string | undefined)[]
  ): string | undefined {
    return [callerDescribedBy, ...ids].filter(Boolean).join(' ') || undefined;
  }

  return { id, errorId, descriptionId, hintId, mergeDescribedBy };
}
