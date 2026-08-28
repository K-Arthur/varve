import { Dialog } from '@varve/ui';
import { useEffect, useState } from 'react';
import {
  DEFAULT_RASTERIZE_SELECTION_OPTIONS,
  type RasterizeSelectionOptions,
} from '../../flatten/rasterizeOptions';

import './RasterizeDialog.css';

const COMMON_PPI = [72, 96, 150, 300, 600] as const;

export interface RasterizeDialogProps {
  open: boolean;
  selectionCount: number;
  onClose: () => void;
  onRasterize: (options: RasterizeSelectionOptions) => void;
}

function safePpi(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RASTERIZE_SELECTION_OPTIONS.dpi;
  return Math.max(1, Math.min(2400, Math.round(value)));
}

/** Explicit, non-destructive selection rasterization workflow. */
export function RasterizeDialog({
  open,
  selectionCount,
  onClose,
  onRasterize,
}: RasterizeDialogProps) {
  const [options, setOptions] = useState<RasterizeSelectionOptions>(
    DEFAULT_RASTERIZE_SELECTION_OPTIONS,
  );

  useEffect(() => {
    if (open) setOptions(DEFAULT_RASTERIZE_SELECTION_OPTIONS);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="Rasterize" dismissible focusFirstControl>
      <form
        className="rasterize-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onRasterize(options);
        }}
      >
        <p className="rasterize-dialog__summary">
          {selectionCount} selected layer{selectionCount === 1 ? '' : 's'} will become a PNG image.
        </p>

        <fieldset className="rasterize-dialog__fieldset">
          <legend>Resolution</legend>
          <div className="rasterize-dialog__presets">
            {COMMON_PPI.map((ppi) => (
              <button
                key={ppi}
                type="button"
                className="rasterize-dialog__preset"
                aria-pressed={options.dpi === ppi}
                onClick={() => setOptions((current) => ({ ...current, dpi: ppi }))}
              >
                {ppi} PPI
              </button>
            ))}
          </div>
          <label className="rasterize-dialog__input-label">
            Custom resolution
            <span className="rasterize-dialog__input-row">
              <input
                type="number"
                min={1}
                max={2400}
                step={1}
                value={options.dpi}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    dpi: safePpi(Number(event.target.value)),
                  }))
                }
                aria-label="Rasterize resolution in PPI"
              />
              <span aria-hidden="true">PPI</span>
            </span>
          </label>
          <p className="rasterize-dialog__hint">Raster output resolution, commonly called DPI.</p>
        </fieldset>

        <fieldset className="rasterize-dialog__fieldset">
          <legend>Bounds and background</legend>
          <label className="rasterize-dialog__check">
            <input
              type="checkbox"
              checked={options.includeEffectOverflow}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  includeEffectOverflow: event.target.checked,
                }))
              }
            />
            Include visible effect overflow
          </label>
          <label className="rasterize-dialog__input-label" htmlFor="rasterize-background">
            Background
            <select
              id="rasterize-background"
              value={options.background}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  background: event.target.value as RasterizeSelectionOptions['background'],
                }))
              }
            >
              <option value="transparent">Transparent</option>
              <option value="white">White</option>
            </select>
          </label>
        </fieldset>

        <label className="rasterize-dialog__check rasterize-dialog__keep">
          <input
            type="checkbox"
            checked={options.keepOriginal}
            onChange={(event) =>
              setOptions((current) => ({ ...current, keepOriginal: event.target.checked }))
            }
          />
          Keep original editable layers (hidden)
        </label>

        <div className="rasterize-dialog__actions">
          <button type="button" className="varve-btn varve-btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="varve-btn varve-btn--primary">
            Rasterize
          </button>
        </div>
      </form>
    </Dialog>
  );
}
