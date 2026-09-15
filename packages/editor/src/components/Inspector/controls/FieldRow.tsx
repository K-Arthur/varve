/**
 * FieldRow — generic label + control wrapper for non-numeric Inspector fields
 * (selects, checkboxes, custom controls). Numeric fields use NumberField,
 * which renders its own label as a scrub handle.
 *
 * Research basis: WCAG 2.2 — every control has a programmatically-associated
 * label (1.3.1, 3.3.2) via a real <label> element.
 */
import type { ReactNode } from 'react';

export type InspectorFieldGroupColumns = 1 | 2 | 3;

export interface FieldRowProps {
  label: string;
  /** When provided, the <label> is associated to the control via htmlFor. */
  htmlFor?: string;
  /** Allow the label to wrap to multiple lines instead of overflowing. */
  wrapLabel?: boolean;
  children: ReactNode;
}

export interface InspectorFieldGroupProps {
  children: ReactNode;
  columns?: InspectorFieldGroupColumns;
  className?: string;
  as?: 'div' | 'fieldset';
}

export function FieldRow({ label, htmlFor, wrapLabel, children }: FieldRowProps) {
  return (
    <div className="insp-field">
      <label
        className={`insp-field__label${wrapLabel ? ' insp-field__label--wrap' : ''}`}
        htmlFor={htmlFor}
      >
        {label}
      </label>
      <div className="insp-field__control">{children}</div>
    </div>
  );
}

/**
 * Responsive layout primitive for related inspector fields.
 *
 * Keep the group separate from FieldRow: a group owns the grid, while each
 * NumberField/FieldRow remains responsible for its own accessible label.
 */
export function InspectorFieldGroup({
  children,
  columns = 1,
  className,
  as: Element = 'div',
}: InspectorFieldGroupProps) {
  const classes = [
    'insp-field-group',
    columns > 1 ? `insp-field-group--columns-${columns}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return <Element className={classes}>{children}</Element>;
}
