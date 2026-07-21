/**
 * ImageFillControls — image fill source + fit controls.
 *
 * Supports URL entry and local file pick (FileReader → data URL). Preview when
 * src is set. Fit mode uses the themed Select, not a native OS menu.
 *
 * Research basis: Figma image fill controls; APG file input patterns.
 */
import type { EmbeddedAssetInput, ImageFillData, ImageFit } from '@strata/scene';
import { Icon, Select } from '@strata/ui';
import { useCallback, useId, useRef } from 'react';
import { FieldRow } from '../controls/FieldRow';

/**
 * Decode a data URL's natural pixel dimensions. Used so a replaced image
 * gets its own correct imageWidth/imageHeight instead of inheriting the
 * previous image's — previously never recomputed, which silently corrupted
 * crop/fit framing whenever the replacement had a different aspect ratio.
 * Resolves { width: 0, height: 0 } on decode failure (never throws/hangs) so
 * a replace action always completes.
 */
function decodeNaturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve({ width: 0, height: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

const FIT_OPTIONS: { value: ImageFit; label: string }[] = [
  { value: 'fill', label: 'Fill' },
  { value: 'fit', label: 'Fit' },
  { value: 'crop', label: 'Crop' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

export function ImageFillControls({
  image,
  onChange,
  registerAsset,
}: {
  image: ImageFillData;
  onChange: (img: ImageFillData) => void;
  /**
   * Registers file bytes as a document-level embedded asset (dedup'd by
   * content hash) and returns its id. Optional so existing callers/tests
   * that don't need asset-table dedup keep working — file picks fall back
   * to the previous inline-src behavior when omitted.
   */
  registerAsset?: (input: EmbeddedAssetInput) => string;
}) {
  const fileInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSrc = Boolean(image.src);

  const handleFitChange = useCallback(
    (value: string) => {
      onChange({ ...image, fit: value as ImageFit });
    },
    [image, onChange],
  );

  const handleSrcChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // A manually typed src leaves the embedded-asset path entirely (it's
      // no longer the asset table's bytes) — drop the stale assetId rather
      // than let it keep pointing at unrelated content.
      onChange({ ...image, src: e.target.value, assetId: undefined });
    },
    [image, onChange],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') return;
        if (!registerAsset) {
          onChange({ ...image, src: result });
          return;
        }
        void decodeNaturalSize(result).then(({ width, height }) => {
          const assetId = registerAsset({
            dataUrl: result,
            mimeType: file.type || 'application/octet-stream',
            naturalWidth: width,
            naturalHeight: height,
          });
          onChange({
            ...image,
            assetId,
            src: result,
            ...(width > 0 ? { imageWidth: width } : {}),
            ...(height > 0 ? { imageHeight: height } : {}),
          });
        });
      };
      reader.readAsDataURL(file);
    },
    [image, onChange, registerAsset],
  );

  const clearImage = useCallback(() => {
    onChange({ ...image, src: '', assetId: undefined });
  }, [image, onChange]);

  return (
    <div className="insp-image-fill">
      {hasSrc && (
        <div
          className="insp-image-fill__preview"
          aria-hidden
          title="Click to replace image"
          onClick={() => fileRef.current?.click()}
        >
          <img src={image.src} alt="" className="insp-image-fill__preview-img" />
        </div>
      )}

      <div className="insp-image-fill__actions">
        <input
          ref={fileRef}
          id={fileInputId}
          type="file"
          accept="image/*"
          className="insp-image-fill__file"
          onChange={handleFileChange}
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          className="insp-btn-sm insp-image-fill__choose"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="Image" label={undefined} size="0.85em" />
          <span>{hasSrc ? 'Replace image' : 'Choose image'}</span>
        </button>
        {hasSrc && (
          <button
            type="button"
            className="insp-inline-btn"
            onClick={clearImage}
            aria-label="Clear image"
          >
            <Icon name="X" label={undefined} size="0.85em" />
          </button>
        )}
      </div>

      <FieldRow label="Source">
        <input
          type="text"
          value={image.src}
          onChange={handleSrcChange}
          aria-label="Image source URL"
          placeholder="URL or choose a file"
          className="insp-num__input insp-image-fill__src"
          title={image.src}
        />
        <button
          type="button"
          className="insp-inline-btn"
          aria-label="Copy source URL"
          title="Copy source URL"
          onClick={() => {
            if (navigator.clipboard) {
              void navigator.clipboard.writeText(image.src);
            }
          }}
        >
          <Icon name="Copy" label={undefined} size="0.85em" />
        </button>
      </FieldRow>
      <FieldRow label="Fit">
        <Select
          label="Image fit mode"
          value={image.fit}
          options={FIT_OPTIONS}
          onChange={handleFitChange}
        />
      </FieldRow>
    </div>
  );
}
