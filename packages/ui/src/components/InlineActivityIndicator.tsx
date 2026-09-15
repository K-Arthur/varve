import { Spinner, type SpinnerSize } from './Spinner';

export interface InlineActivityIndicatorProps {
  /** Accessible label. */
  label?: string;
  /** Size in pixels (defaults to 16). */
  size?: number;
  /** Optional extra class name. */
  className?: string;
}

function spinnerSize(size: number): SpinnerSize {
  if (size <= 12) return 'xs';
  if (size <= 18) return 'sm';
  if (size <= 26) return 'md';
  return 'lg';
}

/**
 * Compact, non-dominant activity indicator for local/short operations.
 * Replaces or appends to content in buttons, rows, or small panels.
 */
export function InlineActivityIndicator({
  label = 'Loading…',
  size = 16,
  className = '',
}: InlineActivityIndicatorProps) {
  return (
    <Spinner size={spinnerSize(size)} label={label} className={`inline-activity ${className}`} />
  );
}
