import { Spinner, type SpinnerSize } from './Spinner';
import './LoadingLabel.css';

export interface LoadingLabelProps {
  /** Concise description of the active operation. */
  label: string;
  /** Spinner size appropriate to the surrounding surface. */
  size?: SpinnerSize;
  className?: string;
}

/**
 * Announces a meaningful loading state once while keeping the spinner
 * decorative. Use this for inline, panel, and dialog activity text.
 */
export function LoadingLabel({ label, size = 'sm', className = '' }: LoadingLabelProps) {
  return (
    <div
      className={`varve-loading-label ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Spinner size={size} />
      <span>{label}</span>
    </div>
  );
}
