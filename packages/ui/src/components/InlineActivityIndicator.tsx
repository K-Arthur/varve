import './InlineActivityIndicator.css';

export interface InlineActivityIndicatorProps {
  /** Accessible label. */
  label?: string;
  /** Size in pixels (defaults to 16). */
  size?: number;
  /** Optional extra class name. */
  className?: string;
}

/**
 * Compact, non-dominant activity indicator for local/short operations.
 * Replaces or appends to content in buttons, rows, or small panels.
 */
export function InlineActivityIndicator({ 
  label = 'Loading...', 
  size = 16,
  className = '' 
}: InlineActivityIndicatorProps) {
  return (
    <svg
      className={`inline-activity ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden={!label}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <title>{label}</title>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
