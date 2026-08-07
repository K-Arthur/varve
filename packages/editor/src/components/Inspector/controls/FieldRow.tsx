/**
 * FieldRow — generic label + control wrapper for non-numeric Inspector fields
 * (selects, checkboxes, custom controls). Numeric fields use NumberField,
 * which renders its own label as a scrub handle.
 *
 * Research basis: WCAG 2.2 — every control has a programmatically-associated
 * label (1.3.1, 3.3.2) via a real <label> element.
 */
import type { ReactNode } from 'react';

export interface FieldRowProps {
  label: string;
  /** When provided, the <label> is associated to the control via htmlFor. */
  htmlFor?: string;
  /** Allow the label to wrap to multiple lines instead of overflowing. */
  wrapLabel?: boolean;
  children: ReactNode;
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
