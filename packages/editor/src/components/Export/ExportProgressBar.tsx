/**
 * Export progress bar — aria progressbar with cancel and error display.
 */

import './ExportProgressBar.css';

export interface ExportProgressBarProps {
  total: number;
  done: number;
  errors: number;
  running: boolean;
  stage?: 'preflight' | 'rendering' | 'encoding' | 'writing' | 'completed' | 'failed';
  currentFile?: string;
  onCancel: () => void;
}

const STAGE_LABELS = {
  preflight: 'Checking export',
  rendering: 'Rendering',
  encoding: 'Encoding',
  writing: 'Writing',
  completed: 'Completed',
  failed: 'Failed',
} as const;

export function ExportProgressBar({
  total,
  done,
  errors,
  running,
  stage,
  currentFile,
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
      {running && stage && (
        <span className="export-progress__stage" aria-live="polite">
          {STAGE_LABELS[stage]}
          {currentFile ? `: ${currentFile}` : ''}
        </span>
      )}
      {running && (
        <button type="button" className="export-progress__cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
    </fieldset>
  );
}
