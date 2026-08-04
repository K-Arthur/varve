/**
 * Document Color Conversion Dialog.
 *
 * Two explicit, non-conflated operations:
 *
 * 1. **Assign mode** — changes the document's working mode/intent. Stored
 *    color values keep their space and are reinterpreted under the new mode
 *    at read boundaries (render/export). Non-destructive to values.
 *
 * 2. **Convert colors** — rewrites stored process colors into the target
 *    mode. In the browser this uses analytical formulas and is reported as
 *    approximate; ICC-accurate conversion is provided by the desktop engine
 *    and is never claimed here.
 *
 * Research basis: ADR-0009 document color architecture, ICC.1:2010.
 */

import type { ColorMode } from '@varve/scene';
import { Dialog } from '@varve/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../../context';
import './color-conversion.css';

interface ColorConversionDialogProps {
  open: boolean;
  onClose: () => void;
}

const MODE_OPTIONS: { value: ColorMode; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'cmyk', label: 'CMYK' },
  { value: 'grayscale', label: 'Grayscale' },
];

export function ColorConversionDialog({ open, onClose }: ColorConversionDialogProps) {
  const {
    documentColorMode,
    assignDocumentColorMode,
    convertDocumentColors,
    beginTransaction,
    commitTransaction,
  } = useEditor();

  const [targetMode, setTargetMode] = useState<ColorMode>(documentColorMode);

  const run = useCallback(
    (action: () => void) => {
      beginTransaction();
      try {
        action();
      } finally {
        commitTransaction();
      }
      onClose();
    },
    [beginTransaction, commitTransaction, onClose],
  );

  const handleAssign = useCallback(() => {
    if (targetMode === documentColorMode) {
      onClose();
      return;
    }
    run(() => assignDocumentColorMode(targetMode));
  }, [targetMode, documentColorMode, assignDocumentColorMode, run, onClose]);

  const handleConvert = useCallback(() => {
    if (targetMode === documentColorMode) {
      onClose();
      return;
    }
    run(() => convertDocumentColors(targetMode));
  }, [targetMode, documentColorMode, convertDocumentColors, run, onClose]);

  return (
    <Dialog open={open} onClose={onClose} title="Document Color Mode">
      <div className="color-conversion-dialog">
        <div className="color-conversion__section">
          <span className="color-conversion__label">Current</span>
          <span className="color-conversion__value">{documentColorMode.toUpperCase()}</span>
        </div>

        <div className="color-conversion__section">
          <span className="color-conversion__label">Target mode</span>
          <div
            className="color-conversion__options"
            role="radiogroup"
            aria-label="Target color mode"
          >
            {MODE_OPTIONS.map((opt) => (
              <label key={opt.value} className="color-conversion__radio">
                <input
                  type="radio"
                  name="targetMode"
                  value={opt.value}
                  checked={targetMode === opt.value}
                  onChange={() => setTargetMode(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="color-conversion__section" role="note">
          <p className="color-conversion__explain">
            <strong>Assign mode</strong> changes document intent only. Existing colors keep their
            values and are converted at render and export time. Appearance may change.
          </p>
          <p className="color-conversion__explain">
            <strong>Convert colors</strong> rewrites every process color into the target mode as a
            single undoable operation. The browser uses approximate analytical conversion;
            profile-accurate ICC conversion is provided by the desktop app.
          </p>
        </div>

        <div className="color-conversion__actions">
          <button type="button" className="color-conversion__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="color-conversion__btn"
            onClick={handleAssign}
            disabled={targetMode === documentColorMode}
          >
            Assign mode
          </button>
          <button
            type="button"
            className="color-conversion__btn color-conversion__btn--primary"
            onClick={handleConvert}
            disabled={targetMode === documentColorMode}
          >
            Convert colors
          </button>
        </div>
      </div>
    </Dialog>
  );
}
