/**
 * ImageResizeDialog — resize raster image pixel dimensions.
 *
 * Provides width/height inputs with linked aspect ratio, scale percentage,
 * and resampling method selection. Operates on the selected image node's
 * source pixels — does not change the node's geometry.
 *
 * The operation never mutates the selected node's existing asset bytes: the
 * editor creates a new embedded asset with the resized pixels. It is a baked
 * source-pixel rendition rather than a live placement transform, and the node
 * bounding box is preserved.
 *
 * Built on @varve/ui's Dialog: native showModal() gives focus containment,
 * an inert background, Escape, focus restoration, and viewport clamping
 * without the hand-rolled trap and window Escape listener this used to carry.
 */

import type { ImageFillData, NodeId } from '@varve/scene';
import { Button, Dialog, Select } from '@varve/ui';
import { useEffect, useRef, useState } from 'react';
import type { ImageResizeResample, ImageResizeWorkingSpace } from '../imageResize';

export type ResizeResample = ImageResizeResample;

export interface ImageResizeResult {
  nodeId: NodeId;
  newWidth: number;
  newHeight: number;
  resample: ResizeResample;
  workingSpace: ImageResizeWorkingSpace;
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

const WORKING_SPACE_OPTIONS: { value: ImageResizeWorkingSpace; label: string }[] = [
  { value: 'srgb', label: 'Encoded sRGB (compatibility)' },
  { value: 'linear-srgb', label: 'Linear light (photo edges)' },
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
  const [workingSpace, setWorkingSpace] = useState<ImageResizeWorkingSpace>('srgb');
  const [scalePercent, setScalePercent] = useState(100);
  const widthRef = useRef<HTMLInputElement>(null);

  // Dialog.focusFirstControl lands on the width field; select the current
  // value so typing replaces it instead of appending.
  useEffect(() => {
    widthRef.current?.select();
  }, []);

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
    onApply({ nodeId, newWidth: width, newHeight: height, resample, workingSpace });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Resize Image"
      focusFirstControl
      aria-describedby="image-resize-summary"
      footer={
        <div className="image-resize-dialog__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleApply} disabled={tooLarge}>
            Apply
          </Button>
        </div>
      }
    >
      <div className="image-resize-dialog__body">
        <div className="image-resize-dialog__row">
          <label className="image-resize-dialog__label" htmlFor="resize-width">
            Width
          </label>
          <input
            id="resize-width"
            ref={widthRef}
            data-autofocus
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
            id="resize-resample"
            className="image-resize-dialog__select"
            label="Resample method"
            value={resample}
            options={RESAMPLE_OPTIONS}
            onChange={(value) => setResample(value as ResizeResample)}
          />
        </div>

        <div className="image-resize-dialog__row">
          <label className="image-resize-dialog__label" htmlFor="resize-working-space">
            Working space
          </label>
          <Select
            id="resize-working-space"
            className="image-resize-dialog__select"
            label="Resize working space"
            value={workingSpace}
            options={WORKING_SPACE_OPTIONS}
            onChange={(value) => setWorkingSpace(value as ImageResizeWorkingSpace)}
          />
        </div>
        <p className="image-resize-dialog__hint">
          Linear light keeps translucent and antialiased edges from darkening during photo resizing.
          Encoded sRGB preserves the compatibility default. This changes source pixels only; the
          placed image bounds stay unchanged.
        </p>

        <div className="image-resize-dialog__info" id="image-resize-summary" role="status">
          <span>
            Output: {outputMP.toFixed(2)} MP ({(outputBytes / 1024 / 1024).toFixed(1)} MB)
          </span>
          {tooLarge && <span className="image-resize-dialog__warning">Exceeds 64 MP limit</span>}
        </div>
      </div>
    </Dialog>
  );
}
