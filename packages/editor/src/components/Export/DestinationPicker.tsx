/**
 * Destination picker — folder selection and filename template with preview.
 */

import type { ExportBatch, ExportJob } from '@varve/scene';
import { useMemo } from 'react';
import { applyExportBatchPaths } from '../../exportBatchPaths';

import './DestinationPicker.css';

export interface DestinationPickerProps {
  template: string;
  folderRule: ExportBatch['folderRule'];
  jobs: ExportJob[];
  onTemplateChange: (template: string) => void;
  onFolderRuleChange: (rule: ExportBatch['folderRule']) => void;
  onSelectDestination: () => void;
  destinationLabel: string;
  folderSelectionAvailable?: boolean;
  /** Inline validation message (shown as role=alert); empty hides it. */
  templateError?: string;
}

const RULE_OPTIONS: { value: ExportBatch['folderRule']; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'by-preset', label: 'By format' },
  { value: 'by-node', label: 'By node' },
];

export function DestinationPicker({
  template,
  folderRule,
  jobs,
  onTemplateChange,
  onFolderRuleChange,
  onSelectDestination,
  destinationLabel,
  folderSelectionAvailable = true,
  templateError = '',
}: DestinationPickerProps) {
  const previews = useMemo(() => {
    return applyExportBatchPaths(jobs, template, folderRule)
      .slice(0, 3)
      .map((job) => {
        const slash = job.fileName.lastIndexOf('/');
        const folder = slash >= 0 ? job.fileName.slice(0, slash + 1) : '';
        const file = slash >= 0 ? job.fileName.slice(slash + 1) : job.fileName;
        return {
          key: `${job.nodeId}-${job.presetId}-${job.fileName}`,
          folder,
          file,
        };
      });
  }, [jobs, template, folderRule]);

  return (
    <fieldset className="destination-picker" aria-label="Destination settings">
      <div className="destination-picker__row">
        <span className="destination-picker__label">Destination</span>
        <button
          type="button"
          className="destination-picker__folder-btn"
          onClick={onSelectDestination}
          disabled={!folderSelectionAvailable}
          aria-describedby={
            !folderSelectionAvailable ? 'export-destination-browser-hint' : undefined
          }
        >
          {destinationLabel ||
            (folderSelectionAvailable ? 'Select folder\u2026' : 'Browser download')}
        </button>
      </div>
      {!folderSelectionAvailable && (
        <span id="export-destination-browser-hint" className="destination-picker__hints">
          Multi-file exports download as one ZIP archive.
        </span>
      )}

      <div className="destination-picker__row">
        <span className="destination-picker__label">Filename</span>
        <input
          type="text"
          className="destination-picker__input"
          value={template}
          onChange={(e) => onTemplateChange(e.target.value)}
          aria-label="Filename template"
        />
      </div>

      <div className="destination-picker__hints">
        <code>{'{name}'}</code> node name &middot; <code>{'{suffix}'}</code> suffix &middot;{' '}
        <code>{'{ext}'}</code> extension
      </div>

      {templateError && (
        <p className="destination-picker__error" role="alert">
          {templateError}
        </p>
      )}

      <div className="destination-picker__row">
        <span className="destination-picker__label">Organize</span>
        <div className="destination-picker__rules">
          {RULE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`destination-picker__rule${folderRule === opt.value ? ' destination-picker__rule--active' : ''}`}
              aria-pressed={folderRule === opt.value}
              onClick={() => onFolderRuleChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {previews.length > 0 && (
        <div className="destination-picker__preview">
          <span className="destination-picker__preview-label">Preview:</span>
          {previews.map((p) => (
            <div key={p.key} className="destination-picker__preview-file">
              {p.folder && <span className="destination-picker__preview-folder">{p.folder}</span>}
              {p.file}
            </div>
          ))}
          {jobs.length > 3 && (
            <div className="destination-picker__more">+{jobs.length - 3} more</div>
          )}
        </div>
      )}
    </fieldset>
  );
}
