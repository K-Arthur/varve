import type { ReactNode } from 'react';
import { Icon } from '../icons';

export interface FileErrorProps {
  message: string;
  title?: string;
  action?: ReactNode;
  compact?: boolean;
}

/** Shared, actionable validation/processing error surface. */
export function FileError({
  message,
  title = 'File could not be processed',
  action,
  compact = false,
}: FileErrorProps) {
  return (
    <div className={`file-error${compact ? ' file-error--compact' : ''}`} role="alert">
      <Icon name="CircleAlert" label={undefined} className="file-error__icon" />
      <div className="file-error__copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {action && <div className="file-error__action">{action}</div>}
    </div>
  );
}
