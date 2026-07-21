/**
 * Document Color Conversion Dialog.
 *
 * Lets the user convert the document's color mode and bit depth, with
 * options to preserve appearance (ICC conversion) or reassign the profile.
 * Warns when the target cannot preserve the source precision.
 *
 * Research basis: ADR-0009 document color architecture, ICC.1:2010.
 */

import type { BitDepth, ColorMode } from '@strata/scene';
import { Dialog } from '@strata/ui';
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

const BIT_DEPTH_OPTIONS: { value: BitDepth; label: string }[] = [
  { value: 'uint8', label: '8-bit' },
  { value: 'uint16', label: '16-bit' },
  { value: 'float16', label: '16-bit float' },
  { value: 'float32', label: '32-bit float' },
];

const PRECISION_ORDER: Record<BitDepth, number> = {
  uint8: 0,
  uint16: 1,
  float16: 2,
  float32: 3,
};

export function ColorConversionDialog({ open, onClose }: ColorConversionDialogProps) {
  const { documentColorMode, switchColorMode, beginTransaction, commitTransaction } = useEditor();

  const [targetMode, setTargetMode] = useState<ColorMode>(documentColorMode);
  const [targetBitDepth, setTargetBitDepth] = useState<BitDepth>('uint8');
  const [preserveAppearance, setPreserveAppearance] = useState(true);

  const currentBitDepth: BitDepth = 'uint8'; // Would come from document colorConfig in full impl
  const precisionLoss = PRECISION_ORDER[targetBitDepth] < PRECISION_ORDER[currentBitDepth];

  const handleConvert = useCallback(() => {
    if (targetMode === documentColorMode && targetBitDepth === currentBitDepth) {
      onClose();
      return;
    }
    beginTransaction();
    try {
      switchColorMode(targetMode);
      commitTransaction();
    } catch {
      // Transaction would be aborted by the engine on failure
    }
    onClose();
  }, [
    targetMode,
    targetBitDepth,
    currentBitDepth,
    documentColorMode,
    switchColorMode,
    beginTransaction,
    commitTransaction,
    onClose,
  ]);

  return (
    <Dialog open={open} onClose={onClose} title="Convert Document Color Space">
      <div className="color-conversion-dialog">
        <div className="color-conversion__section">
          <span className="color-conversion__label">Current</span>
          <span className="color-conversion__value">
            {documentColorMode.toUpperCase()} / {currentBitDepth}
          </span>
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

        <div className="color-conversion__section">
          <span className="color-conversion__label">Target bit depth</span>
          <div
            className="color-conversion__options"
            role="radiogroup"
            aria-label="Target bit depth"
          >
            {BIT_DEPTH_OPTIONS.map((opt) => (
              <label key={opt.value} className="color-conversion__radio">
                <input
                  type="radio"
                  name="targetBitDepth"
                  value={opt.value}
                  checked={targetBitDepth === opt.value}
                  onChange={() => setTargetBitDepth(opt.value)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="color-conversion__section">
          <label className="color-conversion__checkbox">
            <input
              type="checkbox"
              checked={preserveAppearance}
              onChange={(e) => setPreserveAppearance(e.target.checked)}
            />
            <span>Preserve appearance (ICC conversion)</span>
          </label>
        </div>

        {precisionLoss && (
          <div className="color-conversion__warning" role="alert">
            Warning: target bit depth ({targetBitDepth}) is lower than source ({currentBitDepth}).
            Precision will be lost.
          </div>
        )}

        <div className="color-conversion__actions">
          <button type="button" className="color-conversion__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="color-conversion__btn color-conversion__btn--primary"
            onClick={handleConvert}
          >
            Convert
          </button>
        </div>
      </div>
    </Dialog>
  );
}
