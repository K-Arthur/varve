import { Button, Dialog, Icon } from '@strata/ui';
import { useState } from 'react';

export interface FormatMigrationResult {
  name: string;
  success: boolean;
  warnings: string[];
  details?: string[];
}

export interface FormatMigrationProps {
  open: boolean;
  onClose: () => void;
  results: FormatMigrationResult[];
  onViewReport?: (result: FormatMigrationResult) => void;
}

export function FormatMigration({ open, onClose, results, onViewReport }: FormatMigrationProps) {
  const [expanded, setExpanded] = useState(false);

  const successCount = results.filter((r) => r.success).length;
  const warnCount = results.filter((r) => r.warnings.length > 0).length;
  const allWarnings = results.flatMap((r) => r.warnings);

  return (
    <Dialog open={open} onClose={onClose} title="Import & Migration Summary">
      <div className="format-migration">
        <div className="format-migration__summary">
          <div className="format-migration__stat-row">
            <span className="format-migration__stat format-migration__stat--success">
              <Icon name="CircleCheck" label="Success" size="1em" />
              {successCount} file{successCount !== 1 ? 's' : ''} imported
            </span>
          </div>

          {warnCount > 0 && (
            <div className="format-migration__warnings">
              <p className="format-migration__warn-heading">
                <Icon name="TriangleAlert" label="Warning" size="1em" />
                {warnCount} file{warnCount !== 1 ? 's' : ''} with unsupported features
              </p>
              <ul className="format-migration__warn-list">
                {[...new Set(allWarnings)].slice(0, 8).map((w, i) => (
                  <li key={i} className="format-migration__warn-item">
                    {w}
                  </li>
                ))}
                {allWarnings.length > 8 && (
                  <li className="format-migration__warn-item format-migration__warn-item--more">
                    +{allWarnings.length - 8} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {results.length === 0 && (
            <p className="format-migration__empty">No files were processed.</p>
          )}
        </div>

        {results.length > 0 && (
          <div className="format-migration__details">
            <button
              type="button"
              className="format-migration__toggle"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'Show'} per-file report ({results.length} files)
            </button>

            {expanded && (
              <ul className="format-migration__list">
                {results.map((r, i) => (
                  <li
                    key={i}
                    className={`format-migration__file${!r.success ? ' format-migration__file--fail' : ''}${r.warnings.length > 0 ? ' format-migration__file--warn' : ''}`}
                  >
                    <span className="format-migration__file-icon">
                      {r.success ? (
                        <Icon name="Check" label="Success" size="0.85em" />
                      ) : (
                        <Icon name="X" label="Failed" size="0.85em" />
                      )}
                    </span>
                    <span className="format-migration__file-name">{r.name}</span>
                    {r.warnings.length > 0 && (
                      <span className="format-migration__file-badge">
                        {r.warnings.length} issue{r.warnings.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {r.success && onViewReport && (
                      <button
                        type="button"
                        className="format-migration__file-report"
                        onClick={() => onViewReport(r)}
                      >
                        Report
                      </button>
                    )}
                    {r.details && r.details.length > 0 && (
                      <ul className="format-migration__file-details">
                        {r.details.map((d, j) => (
                          <li key={j}>{d}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="format-migration__actions">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
