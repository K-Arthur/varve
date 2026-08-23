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
import { useState } from 'react';
import type { ImageFillData, NodeId } from '@varve/scene';

export type ResizeResample = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3';

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

  const outputBytes = width * height * 4;
  const outputMP = (width * height) / 1_000_000;
  const tooLarge = width * height > 64_000_000;

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

  return (
    <div className="image-resize-dialog" role="dialog" aria-label="Resize image">
      <div className="image-resize-dialog__header">
        <h3>Resize Image</h3>
        <button
          type="button"
          className="image-resize-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="image-resize-dialog__body">
        <div className="image-resize-dialog__row">
          <label className="image-resize-dialog__label" htmlFor="resize-width">
            Width
          </label>
          <input
            id="resize-width"
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
            {linked ? '🔗' : '🔓'}
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
          <select
            id="resize-resample"
            value={resample}
            onChange={(e) => setResample(e.target.value as ResizeResample)}
            className="image-resize-dialog__select"
          >
            {RESAMPLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="image-resize-dialog__info">
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
  );
}
