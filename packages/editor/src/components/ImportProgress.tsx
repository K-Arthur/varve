import './ImportProgress.css';

export interface ImportProgressProps {
  current: number;
  total: number;
  fileName: string;
  onCancel?: () => void;
}

import './ImportProgress.css';

export function ImportProgress({ current, total, fileName, onCancel }: ImportProgressProps) {
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <fieldset className="import-progress" aria-label="Import progress">
      <div className="import-progress__info">
        <span className="import-progress__label">
          Importing file {current} of {total}
        </span>
        <span className="import-progress__filename">{fileName}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${current} of ${total} files imported`}
        className="import-progress__bar"
      >
        <div className="import-progress__fill" style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      {onCancel && (
        <button type="button" className="import-progress__cancel" onClick={onCancel}>
          Cancel
        </button>
      )}
      <div role="status" aria-live="polite" className="varve-visually-hidden">
        Importing {fileName} — {current} of {total}
      </div>
    </fieldset>
  );
}
