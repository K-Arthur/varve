/**
 * Export progress bar — aria progressbar with cancel and error display.
 */

import './ExportProgressBar.css';

export interface ExportProgressBarProps {
  total: number;
  done: number;
  errors: number;
  running: boolean;
  onCancel: () => void;
}

export function ExportProgressBar({
  total,
  done,
  errors,
  running,
  onCancel,
}: ExportProgressBarProps) {
  const completed = done + errors;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <fieldset className="export-progress" aria-label="Export progress">
      <div
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${completed} of ${total} exports complete`}
        className="export-progress__bar"
      >
        <div className="export-progress__fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <span className="export-progress__text">
        {completed}/{total}
        {errors > 0 && <span className="export-progress__errors"> ({errors} errors)</span>}
      </span>
      {running && (
        <button type="button" className="export-progress__cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </fieldset>
  );
}
