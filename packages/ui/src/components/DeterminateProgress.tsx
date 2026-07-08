import './DeterminateProgress.css';

export interface DeterminateProgressProps {
  /** Current progress value. */
  value: number;
  /** Maximum progress value (defaults to 100). */
  max?: number;
  /** Label for the operation. */
  label?: string;
  /** Secondary status text (e.g. "5 of 10 complete"). */
  statusText?: string;
  /** Number of errors encountered. */
  errors?: number;
  /** Whether the operation is currently running (shows cancel if onCancel provided). */
  running?: boolean;
  /** Optional callback to cancel the operation. */
  onCancel?: () => void;
  /** Optional extra class name. */
  className?: string;
  /** Size variant. */
  size?: 'sm' | 'md';
}

/**
 * Universal determinate progress indicator for measurable tasks.
 * Replaces specialized progress bars in Export, Import, and Model Downloads.
 */
export function DeterminateProgress({
  value,
  max = 100,
  label,
  statusText,
  errors = 0,
  running = false,
  onCancel,
  className = '',
  size = 'md',
}: DeterminateProgressProps) {
  const percentage = max > 0 ? Math.round((value / max) * 100) : 0;
  const progressLabel = statusText ?? `${percentage}%`;

  return (
    <div className={`det-progress det-progress--${size} ${className}`} role="group" aria-label={label ?? 'Progress'}>
      {label && <div className="det-progress__label">{label}</div>}
      
      <div className="det-progress__track-row">
        <div
          className="det-progress__track"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={label}
        >
          <div 
            className="det-progress__fill" 
            style={{ width: `${Math.min(percentage, 100)}%` }} 
          />
        </div>
        
        {onCancel && running && (
          <button 
            type="button" 
            className="det-progress__cancel" 
            onClick={onCancel}
            aria-label="Cancel operation"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="det-progress__meta">
        <span className="det-progress__status">{progressLabel}</span>
        {errors > 0 && (
          <span className="det-progress__errors" role="alert">
            {errors} {errors === 1 ? 'error' : 'errors'}
          </span>
        )}
      </div>
    </div>
  );
}
