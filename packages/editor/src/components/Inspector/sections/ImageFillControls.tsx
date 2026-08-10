/**
 * ImageFillControls — image fill source + fit controls.
 *
 * Supports URL entry and local file pick (FileReader → data URL). Preview when
 * src is set. Fit mode uses the themed Select, not a native OS menu.
 *
 * Research basis: Figma image fill controls; APG file input patterns.
 */
import type { DocumentAsset, EmbeddedAssetInput, ImageFillData, ImageFit } from '@varve/scene';
import { rasterEncodingLabel, rasterProvenanceLabel } from '@varve/shared';
import { Icon, Select, Tooltip, TooltipProvider } from '@varve/ui';
import { useCallback, useId, useRef, useState } from 'react';
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
  onResetUpscale,
  onReUpscale,
  asset,
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
  /** Callback to reset non-destructive upscale to original. */
  onResetUpscale?: () => void;
  /** Callback to re-upscale with new settings. */
  onReUpscale?: () => void;
  /** The document asset behind this fill, when embedded (colour metadata). */
  asset?: DocumentAsset;
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
        <button
          type="button"
          className="insp-image-fill__preview"
          aria-label="Replace image"
          onClick={() => fileRef.current?.click()}
        >
          <img src={image.src} alt="" className="insp-image-fill__preview-img" />
        </button>
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
        <Tooltip label={image.src} truncationOnly>
          <input
            type="text"
            value={image.src}
            onChange={handleSrcChange}
            aria-label="Image source URL"
            placeholder="URL or choose a file"
            className="insp-num__input insp-image-fill__src"
          />
        </Tooltip>
        <Tooltip label="Copy source URL">
          <button
            type="button"
            className="insp-inline-btn"
            aria-label="Copy source URL"
            onClick={() => {
              if (navigator.clipboard) {
                void navigator.clipboard.writeText(image.src);
              }
            }}
          >
            <Icon name="Copy" label={undefined} size="0.85em" />
          </button>
        </Tooltip>
      </FieldRow>
      <FieldRow label="Fit">
        <Select
          label="Image fit mode"
          value={image.fit}
          options={FIT_OPTIONS}
          onChange={handleFitChange}
        />
      </FieldRow>
      <FieldRow label="Rotation">
        <div className="insp-image-fill__transform-row">
          <input
            type="number"
            value={image.rotation ?? 0}
            onChange={(e) => onChange({ ...image, rotation: parseFloat(e.target.value) || 0 })}
            aria-label="Image rotation degrees"
            className="insp-num__input insp-image-fill__rot-input"
            step={15}
            min={-360}
            max={360}
          />
          <span className="insp-image-fill__deg">°</span>
        </div>
      </FieldRow>
      <FieldRow label="Flip">
        <div className="insp-image-fill__flip-row">
          <TooltipProvider>
            <Tooltip label="Flip horizontal">
              <button
                type="button"
                className={`insp-image-fill__flip-btn${image.flipH ? ' insp-image-fill__flip-btn--active' : ''}`}
                aria-pressed={!!image.flipH}
                aria-label="Flip horizontal"
                onClick={() => onChange({ ...image, flipH: !image.flipH })}
              >
                <Icon name="FlipHorizontal2" label={undefined} size="0.85em" />
              </button>
            </Tooltip>
            <Tooltip label="Flip vertical">
              <button
                type="button"
                className={`insp-image-fill__flip-btn${image.flipV ? ' insp-image-fill__flip-btn--active' : ''}`}
                aria-pressed={!!image.flipV}
                aria-label="Flip vertical"
                onClick={() => onChange({ ...image, flipV: !image.flipV })}
              >
                <Icon name="FlipVertical2" label={undefined} size="0.85em" />
              </button>
            </Tooltip>
          </TooltipProvider>
        </div>
      </FieldRow>
      {image.crop && (
        <FieldRow label="Crop">
          <div className="insp-image-fill__crop-info">
            <span className="insp-image-fill__crop-dims">
              {Math.round(image.crop.w)}x{Math.round(image.crop.h)} px
            </span>
            <Tooltip label="Reset crop to full image">
              <button
                type="button"
                className="insp-inline-btn insp-image-fill__crop-reset"
                aria-label="Reset crop"
                onClick={() => {
                  const next = { ...image };
                  delete next.crop;
                  next.x = 0;
                  next.y = 0;
                  next.scale = 1;
                  onChange(next);
                }}
              >
                <Icon name="RotateCcw" label={undefined} size="0.85em" />
                <span>Reset</span>
              </button>
            </Tooltip>
          </div>
        </FieldRow>
      )}
      {image.upscale && (
        <FieldRow label="Upscale">
          <div className="insp-image-fill__upscale-info">
            <span className="insp-hint">
              {image.upscale.mode} {image.upscale.scale}x
            </span>
            <div className="insp-image-fill__upscale-actions">
              {onResetUpscale && (
                <Tooltip label="Reset to original image">
                  <button
                    type="button"
                    className="insp-inline-btn"
                    aria-label="Reset upscale"
                    onClick={onResetUpscale}
                  >
                    <Icon name="RotateCcw" label={undefined} size="0.85em" />
                    <span>Reset</span>
                  </button>
                </Tooltip>
              )}
              {onReUpscale && (
                <Tooltip label="Re-upscale with new settings">
                  <button
                    type="button"
                    className="insp-inline-btn"
                    aria-label="Re-upscale"
                    onClick={onReUpscale}
                  >
                    <Icon name="Settings" label={undefined} size="0.85em" />
                    <span>Re-upscale</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </FieldRow>
      )}
      {asset?.metadata && <ImageColorInfo asset={asset} />}
    </div>
  );
}

/**
 * Compact colour-metadata readout for a placed raster (expandable details).
 * Text + icon only — never colour alone (WCAG).
 */
function ImageColorInfo({ asset }: { asset: DocumentAsset }) {
  const [expanded, setExpanded] = useState(false);
  const metadata = asset.metadata;
  if (!metadata) return null;
  const encoding = metadata.colorEncoding;
  const untagged =
    encoding === undefined ||
    encoding.provenance === 'format-default' ||
    encoding.provenance === 'assumed' ||
    encoding.provenance === 'legacy-assumed-srgb';

  const summary = encoding ? rasterEncodingLabel(encoding) : 'Untagged — interpreted as sRGB';
  const provenanceLabel = encoding
    ? rasterProvenanceLabel(encoding.provenance)
    : rasterProvenanceLabel('legacy-assumed-srgb');

  const details: Array<{ label: string; value: string }> = [];
  if (encoding) {
    details.push({ label: 'Profile source', value: provenanceLabel });
    details.push({ label: 'Primaries', value: encoding.primaries ?? 'unknown' });
    details.push({ label: 'Transfer', value: encoding.transfer ?? 'unknown' });
    if (encoding.bitDepth !== undefined) {
      details.push({ label: 'Bit depth', value: String(encoding.bitDepth) });
    }
    if (encoding.matrixCoefficients !== undefined) {
      details.push({ label: 'Matrix coefficients', value: encoding.matrixCoefficients });
    }
    if (encoding.videoRange !== undefined) {
      details.push({ label: 'Video range', value: encoding.videoRange });
    }
    if (encoding.profileId) details.push({ label: 'Profile', value: encoding.profileId });
  } else {
    details.push({ label: 'Profile source', value: provenanceLabel });
  }
  if (metadata.iccDescription) {
    details.push({ label: 'Embedded profile name', value: metadata.iccDescription });
  }
  if (metadata.iccStatus === 'invalid') {
    details.push({ label: 'ICC status', value: 'invalid (cannot be colour-managed)' });
  }
  if (metadata.orientation !== undefined && metadata.orientation !== 1) {
    details.push({ label: 'EXIF orientation', value: String(metadata.orientation) });
  }

  return (
    <FieldRow label="Colour">
      <div className="insp-image-fill__color">
        <div className="insp-image-fill__color-summary">
          <Icon name="Info" label={undefined} size="0.85em" />
          <span className={untagged ? 'insp-hint' : undefined}>{summary}</span>
        </div>
        {details.length > 0 && (
          <button
            type="button"
            className="insp-inline-btn"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide colour details' : 'Show colour details'}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} label={undefined} size="0.85em" />
            <span>{expanded ? 'Hide details' : 'Details'}</span>
          </button>
        )}
        {expanded && (
          <dl className="insp-image-fill__color-details">
            {details.map((d) => (
              <div key={d.label} className="insp-image-fill__color-detail">
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
            {encoding?.diagnostics?.map((diagnostic) => (
              <div key={diagnostic} className="insp-image-fill__color-detail">
                <dt>Note</dt>
                <dd>{diagnostic}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </FieldRow>
  );
}
