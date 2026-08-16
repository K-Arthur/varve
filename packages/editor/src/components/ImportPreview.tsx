import type { ImportValidation } from '@varve/import';
import { FocusTrap } from '@varve/ui';
import { useCallback } from 'react';

import './ImportPreview.css';

export interface ImportPreviewProps {
  validation: ImportValidation;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportPreview({ validation, onConfirm, onCancel }: ImportPreviewProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  const sizeLabel = formatSize(validation.sizeBytes);

  return (
    <div
      className="import-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Import preview"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Focus containment + restoration for a surface that declares
          aria-modal but previously left Tab free to reach the editor. */}
      <FocusTrap active onClose={onCancel}>
        <div className="import-preview">
          <div className="import-preview__header">
            <h2 className="import-preview__title">Import Preview</h2>
            <button
              type="button"
              className="import-preview__close"
              aria-label="Close"
              onClick={onCancel}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          <div className="import-preview__body">
            <div className="import-preview__info">
              <div className="import-preview__info-row">
                <span className="import-preview__label">Format</span>
                <span className="import-preview__value">{validation.format.toUpperCase()}</span>
              </div>
              <div className="import-preview__info-row">
                <span className="import-preview__label">Size</span>
                <span className="import-preview__value">{sizeLabel}</span>
              </div>
              <div className="import-preview__info-row">
                <span className="import-preview__label">Estimated nodes</span>
                <span className="import-preview__value">{validation.estimatedNodeCount}</span>
              </div>
              {validation.pageCount > 1 && (
                <div className="import-preview__info-row">
                  <span className="import-preview__label">Pages</span>
                  <span className="import-preview__value">{validation.pageCount}</span>
                </div>
              )}
            </div>

            {validation.unsupportedFeatures.length > 0 && (
              <div className="import-preview__warnings">
                <h3 className="import-preview__warnings-title">
                  {validation.unsupportedFeatures.length} unsupported feature
                  {validation.unsupportedFeatures.length !== 1 ? 's' : ''}
                </h3>
                <ul className="import-preview__warnings-list">
                  {validation.unsupportedFeatures.map((feature, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stateless feature strings; content keys would collide on duplicates
                    <li key={i}>{feature}</li>
                  ))}
                </ul>
              </div>
            )}

            {validation.warnings.length > 0 && (
              <div className="import-preview__warnings">
                <ul className="import-preview__warnings-list">
                  {validation.warnings.map((w, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stateless warning strings; content keys would collide on duplicates
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="import-preview__options">
              <h3 className="import-preview__options-title">Import options</h3>
              <label className="import-preview__option">
                <input
                  type="radio"
                  name="importMode"
                  value="editable"
                  defaultChecked
                  aria-label="Import as editable"
                />
                <span>Import as editable</span>
              </label>
              <label className="import-preview__option">
                <input
                  type="radio"
                  name="importMode"
                  value="flattened"
                  aria-label="Import as flattened"
                />
                <span>Import as flattened</span>
              </label>
            </div>
          </div>

          <div className="import-preview__footer">
            <button
              type="button"
              className="import-preview__btn import-preview__btn--secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="import-preview__btn import-preview__btn--primary"
              onClick={onConfirm}
              disabled={!validation.valid}
            >
              Import
            </button>
          </div>

          <div role="status" aria-live="polite" className="varve-visually-hidden">
            {validation.valid
              ? `Ready to import ${validation.format} with ${validation.estimatedNodeCount} nodes`
              : 'This file cannot be imported'}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
