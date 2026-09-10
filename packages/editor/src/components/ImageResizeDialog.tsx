/**
 * ImageResizeDialog — resize raster image pixel dimensions.
 *
 * Provides width/height inputs with linked aspect ratio, scale percentage,
 * and resampling method selection. Operates on the selected image node's
 * source pixels — does not change the node's geometry.
 *
 * This is a non-destructive operation that changes the image fill's
 * effective resolution. The node bounding box is preserved.
 */

import type { ImageFillData, NodeId } from '@varve/scene';
import { Select } from '@varve/ui';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import type { ImageResizeResample } from '../imageResize';

export type ResizeResample = ImageResizeResample;

export interface ImageResizeResult {
  nodeId: NodeId;
  newWidth: number;
  newHeight: number;
  resample: ResizeResample;
}

export interface ImageResizeDialogProps {
  nodeId: NodeId;
  fill: ImageFillData;
  onClose: () => void;
  onApply: (result: ImageResizeResult) => void;
}

const RESAMPLE_OPTIONS: { value: ResizeResample; label: string }[] = [
  { value: 'nearest', label: 'Nearest (pixel art)' },
  { value: 'bilinear', label: 'Bilinear' },
  { value: 'bicubic', label: 'Bicubic' },
  { value: 'lanczos3', label: 'Lanczos 3' },
];

function clampDim(v: number): number {
  return Math.max(1, Math.min(65536, Math.round(v)));
}

export function ImageResizeDialog({ nodeId, fill, onClose, onApply }: ImageResizeDialogProps) {
  const srcW = fill.imageWidth ?? 1;
  const srcH = fill.imageHeight ?? 1;
  const aspect = srcW / srcH;

  const [width, setWidth] = useState(srcW);
  const [height, setHeight] = useState(srcH);
  const [linked, setLinked] = useState(true);
  const [resample, setResample] = useState<ResizeResample>('bicubic');
  const [scalePercent, setScalePercent] = useState(100);
  const dialogRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    widthRef.current?.focus();
    widthRef.current?.select();
    return () => previousFocus?.focus();
  }, []);

  const outputBytes = width * height * 4;
  const outputMP = (width * height) / 1_000_000;
  const tooLarge = width * height > 64_000_000;

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleWidthChange = (raw: string) => {
    const w = clampDim(Number.parseFloat(raw) || 0);
    setWidth(w);
    if (linked) setHeight(clampDim(w / aspect));
    setScalePercent(Math.round((w / srcW) * 100));
  };

  const handleHeightChange = (raw: string) => {
    const h = clampDim(Number.parseFloat(raw) || 0);
    setHeight(h);
    if (linked) setWidth(clampDim(h * aspect));
    setScalePercent(Math.round((h / srcH) * 100));
  };

  const handleScaleChange = (raw: string) => {
    const pct = Math.max(1, Math.min(10000, Number.parseFloat(raw) || 100));
    setScalePercent(pct);
    setWidth(clampDim(srcW * (pct / 100)));
    setHeight(clampDim(srcH * (pct / 100)));
  };

  const handleApply = () => {
    if (tooLarge) return;
    onApply({ nodeId, newWidth: width, newHeight: height, resample });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div className="image-resize-backdrop">
      <button
        type="button"
        className="image-resize-backdrop__dismiss"
        aria-label="Close resize image dialog"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        className="image-resize-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-resize-title"
        aria-describedby="image-resize-summary"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="image-resize-dialog__header">
          <h3 id="image-resize-title">Resize Image</h3>
          <button
            type="button"
            className="image-resize-dialog__close"
            onClick={onClose}
            aria-label="Close resize image dialog"
          >
            Close
          </button>
        </div>

        <div className="image-resize-dialog__body">
          <div className="image-resize-dialog__row">
            <label className="image-resize-dialog__label" htmlFor="resize-width">
              Width
            </label>
            <input
              id="resize-width"
              ref={widthRef}
              type="number"
              value={width}
              min={1}
              max={65536}
              onChange={(e) => handleWidthChange(e.target.value)}
              className="image-resize-dialog__input"
            />
            <span className="image-resize-dialog__unit">px</span>
          </div>

          <div className="image-resize-dialog__row">
            <label className="image-resize-dialog__label" htmlFor="resize-height">
              Height
            </label>
            <input
              id="resize-height"
              type="number"
              value={height}
              min={1}
              max={65536}
              onChange={(e) => handleHeightChange(e.target.value)}
              className="image-resize-dialog__input"
            />
            <span className="image-resize-dialog__unit">px</span>
          </div>

          <div className="image-resize-dialog__row">
            <button
              type="button"
              className={`image-resize-dialog__lock ${linked ? 'image-resize-dialog__lock--active' : ''}`}
              onClick={() => setLinked(!linked)}
              aria-label={linked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              aria-pressed={linked}
            >
              {linked ? 'Linked' : 'Free'}
            </button>
          </div>

          <div className="image-resize-dialog__row">
            <label className="image-resize-dialog__label" htmlFor="resize-scale">
              Scale
            </label>
            <input
              id="resize-scale"
              type="number"
              value={scalePercent}
              min={1}
              max={10000}
              onChange={(e) => handleScaleChange(e.target.value)}
              className="image-resize-dialog__input image-resize-dialog__input--short"
            />
            <span className="image-resize-dialog__unit">%</span>
          </div>

          <div className="image-resize-dialog__row">
            <label className="image-resize-dialog__label" htmlFor="resize-resample">
              Resample
            </label>
            <Select
              label="Resample method"
              value={resample}
              options={RESAMPLE_OPTIONS}
              onChange={(value) => setResample(value as ResizeResample)}
            />
          </div>

          <div className="image-resize-dialog__info" id="image-resize-summary" role="status">
            <span>
              Output: {outputMP.toFixed(2)} MP ({(outputBytes / 1024 / 1024).toFixed(1)} MB)
            </span>
            {tooLarge && <span className="image-resize-dialog__warning">Exceeds 64 MP limit</span>}
          </div>
        </div>

        <div className="image-resize-dialog__footer">
          <button type="button" className="image-resize-dialog__btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="image-resize-dialog__btn image-resize-dialog__btn--primary"
            onClick={handleApply}
            disabled={tooLarge}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
