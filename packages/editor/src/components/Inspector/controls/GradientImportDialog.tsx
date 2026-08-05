/**
 * Gradient import review dialog — shows discovered presets with thumbnails,
 * per-preset selection, structured warnings, and duplicate counts before any
 * state is mutated. Parsing happens before the dialog opens; nothing here
 * touches the document or the library.
 */
import type { GradientPreset } from '@varve/scene';
import { displayName } from '@varve/scene';
import { Checkbox, Dialog, Select } from '@varve/ui';
import { useMemo, useState } from 'react';

import { gradientPresetToCss } from '../../../gradientPresets/thumbnail';

export type GradientImportScope = 'library' | 'document' | 'both';

export interface GradientImportDialogProps {
  open: boolean;
  fileName?: string;
  presets: GradientPreset[];
  warnings: string[];
  duplicateCount: number;
  onClose: () => void;
  onImport: (selected: GradientPreset[], scope: GradientImportScope) => void;
}

export function GradientImportDialog({
  open,
  fileName,
  presets,
  warnings,
  duplicateCount,
  onClose,
  onImport,
}: GradientImportDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<GradientImportScope>('library');

  const selectedList = useMemo(
    () => presets.filter((p) => selected.has(p.id)),
    [presets, selected],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === presets.length ? new Set() : new Set(presets.map((p) => p.id)),
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Import gradients${fileName ? ` — ${fileName}` : ''}`}
    >
      <div className="gmp-import">
        <p className="gmp-import__intro">
          {presets.length} gradient{presets.length === 1 ? '' : 's'} found.
          {selectedList.length > 0 && ` ${selectedList.length} selected.`}
        </p>
        {warnings.length > 0 && (
          <div className="gmp-import__warnings" role="status">
            <ul>
              {warnings.map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: stateless warning strings; content keys would collide on duplicates
                <li key={`gmp-warn-${i}-${w.slice(0, 12)}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {duplicateCount > 0 && (
          <p className="gmp-import__dupes">
            {duplicateCount} preset{duplicateCount === 1 ? '' : 's'} already in your library and
            will be merged (identical content), not duplicated.
          </p>
        )}
        <div className="gmp-import__scope">
          <Select
            label="Import to"
            value={scope}
            onChange={(v) => setScope(v as GradientImportScope)}
            options={[
              { value: 'library', label: 'My presets (all documents)' },
              { value: 'document', label: 'This document only' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </div>
        <div className="gmp-import__list-header">
          <Checkbox
            label="Select all"
            checked={selected.size === presets.length && presets.length > 0}
            onChange={toggleAll}
          />
        </div>
        <ul className="gmp-import__list" aria-label="Discovered gradients">
          {presets.map((preset) => {
            const checked = selected.has(preset.id);
            return (
              <li
                key={preset.id}
                className={`gmp-import__item${checked ? ' gmp-import__item--selected' : ''}`}
              >
                <Checkbox
                  label={`Select ${displayName(preset)}`}
                  checked={checked}
                  onChange={() => toggle(preset.id)}
                />
                <span
                  className="gmp-import__swatch"
                  style={{ background: gradientPresetToCss(preset) }}
                  aria-hidden="true"
                />
                <span className="gmp-import__name">{displayName(preset)}</span>
                {preset.compatibility?.status !== 'ok' && (
                  <span
                    className="gmp-import__badge gmp-import__badge--warn"
                    title={preset.compatibility?.message}
                  >
                    {preset.compatibility?.status === 'unsupported' ? 'Read-only' : 'Approximated'}
                  </span>
                )}
                <span className="gmp-import__stops">
                  {preset.colorStops.length} stop{preset.colorStops.length === 1 ? '' : 's'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="varve-dialog__actions">
        <button type="button" className="varve-btn varve-btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="varve-btn varve-btn--primary"
          disabled={selectedList.length === 0}
          onClick={() => {
            onImport(selectedList, scope);
            onClose();
          }}
        >
          Import {selectedList.length || ''} preset{selectedList.length === 1 ? '' : 's'}
        </button>
      </div>
    </Dialog>
  );
}
