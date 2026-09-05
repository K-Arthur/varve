import type { HTMLAttributes, ReactNode } from 'react';

export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Connected groups are horizontal by default; vertical is useful in dialogs. */
  orientation?: 'horizontal' | 'vertical';
  /** Adds a group name for assistive technology when the group needs context. */
  label?: string;
}

/**
 * Connected action geometry for genuinely grouped actions.
 *
 * Persistent mutually-exclusive choices belong to ToggleButton/SegmentedControl;
 * this component only owns the shared border and member seams.
 */
export function ButtonGroup({
  children,
  orientation = 'horizontal',
  label,
  className = '',
  ...rest
}: ButtonGroupProps) {
  return (
    <div
      {...rest}
      className={`varve-btn-group varve-btn-group--${orientation} ${className}`.trim()}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
