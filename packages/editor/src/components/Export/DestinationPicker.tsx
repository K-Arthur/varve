/**
 * Destination picker — folder selection and filename template with preview.
 */

import type { ExportBatch, ExportJob } from '@strata/scene';
import { useMemo } from 'react';

import './DestinationPicker.css';

export interface DestinationPickerProps {
  template: string;
  folderRule: ExportBatch['folderRule'];
  jobs: ExportJob[];
  onTemplateChange: (template: string) => void;
  onFolderRuleChange: (rule: ExportBatch['folderRule']) => void;
  onSelectDestination: () => void;
  destinationLabel: string;
}

const RULE_OPTIONS: { value: ExportBatch['folderRule']; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'by-preset', label: 'By preset' },
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
}: DestinationPickerProps) {
  const previews = useMemo(() => {
    return jobs.slice(0, 3).map((job) => {
      const safeName = job.nodeName.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'export';
      const ext = job.format.startsWith('pdf')
        ? 'pdf'
        : job.format === 'svg'
          ? 'svg'
          : job.format === 'react-tailwind'
            ? 'tsx'
            : job.format === 'react-cssmodules'
              ? 'tsx'
              : job.format === 'flutter'
                ? 'dart'
                : job.format === 'swiftui'
                  ? 'swift'
                  : 'png';
      const folder =
        folderRule === 'by-preset'
          ? `${job.format}/`
          : folderRule === 'by-node'
            ? `${safeName}/`
            : '';
      const file = template
        .replace('{name}', safeName)
        .replace('{suffix}', job.presetId ? `-${job.presetId.slice(0, 8)}` : '')
        .replace('{ext}', ext);
      return { folder, file, full: `${folder}${file}` };
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
        >
          {destinationLabel || 'Select folder\u2026'}
        </button>
      </div>

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
          {previews.map((p, i) => (
            <div key={i} className="destination-picker__preview-file">
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
