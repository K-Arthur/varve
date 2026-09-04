import type { HTMLAttributes } from 'react';

export interface ResizableHandleProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  withGrip?: boolean;
  active?: boolean;
}

/** Shared semantic hit target for docked pane resizers. */
export function ResizableHandle({
  orientation = 'vertical',
  withGrip = false,
  active = false,
  className,
  ...props
}: ResizableHandleProps) {
  const classes = [
    'varve-resizable-handle',
    `varve-resizable-handle--${orientation}`,
    withGrip ? 'varve-resizable-handle--grip' : '',
    active ? 'varve-resizable-handle--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} data-orientation={orientation} data-resizable-handle {...props} />
  );
}
