import {
  alignBracketFrames,
  buildDeghostMasks,
  encodeOpenExr,
  fuseDisplayBracket,
  type HdrFrame,
  mergeRadianceBracket,
} from '@varve/engine/hdr';
import type { RawMosaic } from '@varve/engine/raw';
import { decodeDng, defaultRawRecipe, developRaw, isDngSignature } from '@varve/engine/raw';
import type { Document, SceneNode } from '@varve/scene';
import {
  createEmbeddedAsset,
  isImageShape,
  type PhotoSourceBinding,
  photoSourceRevision,
} from '@varve/scene';
import { createRangeRaster, type RangeRaster } from '@varve/shared';
import { Button, Dialog, Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { PhotoRangeControl } from '../controls/PhotoRangeControl';
import { type HdrDisplayCapabilities, renderExtendedCanvasPreview } from './hdrDisplay';
import {
  bytesToDataUrl,
  MAX_PHOTO_SOURCE_BYTES,
  rangeRasterToSdrPngDataUrl,
  replaceImageFill,
} from './photoSourceWorkflow';

import './photoSource.css';

interface BracketItem {
  name: string;
  dataUrl: string;
  mimeType: string;
  raster: RangeRaster;
  raw: RawMosaic | null;
  exposureTimeSeconds?: number;
}

interface HdrMergeDialogProps {
  open: boolean;
  node: SceneNode;
  onClose: () => void;
  onApplied: () => void;
}

type MergeMethod = 'radiance' | 'exposure-fusion';

const MAX_HDR_WORKING_BYTES = 3 * 1024 * 1024 * 1024;

export function HdrMergeDialog({ open, node, onClose, onApplied }: HdrMergeDialogProps) {
  const { updateDoc, announce } = useEditor();
  const [items, setItems] = useState<BracketItem[]>([]);
  const [referenceIndex, setReferenceIndex] = useState('0');
  const [method, setMethod] = useState<MergeMethod>('radiance');
  const [threshold, setThreshold] = useState(0.2);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [masterUrl, setMasterUrl] = useState<string | null>(null);
  const [masterRaster, setMasterRaster] = useState<RangeRaster | null>(null);
  const [movingPixels, setMovingPixels] = useState(0);
  const [reviewWarnings, setReviewWarnings] = useState<string[]>([]);
  const [reviewBlocking, setReviewBlocking] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
    onClose();
  }, [onClose]);

  const handleFiles = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []).slice(0, 12);
      event.target.value = '';
      if (files.length < 2) {
        setErrorMessage('Choose at least two reviewed exposures');
        return;
      }
      setBusy(true);
      setErrorMessage(null);
      setPreviewUrl(null);
      setMasterUrl(null);
      setMasterRaster(null);
      setReviewWarnings([]);
      setReviewBlocking([]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const loaded: BracketItem[] = [];
        for (const file of files) {
          if (controller.signal.aborted) return;
          if (file.size > MAX_PHOTO_SOURCE_BYTES) {
            throw new Error(
              `${file.name} exceeds the ${(MAX_PHOTO_SOURCE_BYTES / (1024 * 1024)).toFixed(0)} MiB source limit`,
            );
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const dataUrl = bytesToDataUrl(
            bytes,
            isDngSignature(bytes) ? 'image/x-adobe-dng' : file.type || 'application/octet-stream',
          );
          if (isDngSignature(bytes)) {
            const raw = decodeDng(bytes);
            const result = developRaw(raw, defaultRawRecipe(raw));
            loaded.push({
              name: file.name,
              dataUrl,
              mimeType: 'image/x-adobe-dng',
              raster: result.raster,
              raw,
              exposureTimeSeconds: raw.camera.exposureTimeSeconds,
            });
          } else {
            loaded.push({
              name: file.name,
              dataUrl,
              mimeType: file.type || 'application/octet-stream',
              raster: await decodeRenderedFile(dataUrl),
              raw: null,
            });
          }
        }
        const dimensions = loaded[0]!.raster.contract;
        if (
          loaded.some(
            (item) =>
              item.raster.contract.width !== dimensions.width ||
              item.raster.contract.height !== dimensions.height,
          )
        ) {
          throw new Error('All bracket inputs must have identical decoded dimensions');
        }
        const pixels = dimensions.width * dimensions.height;
        const estimatedWorkingBytes = pixels * 16 * (loaded.length * 2 + 1);
        if (estimatedWorkingBytes > MAX_HDR_WORKING_BYTES) {
          throw new Error(
            `This bracket needs about ${(estimatedWorkingBytes / (1024 * 1024 * 1024)).toFixed(1)} GiB while merging; use fewer or smaller frames on this runtime`,
          );
        }
        const allRaw = loaded.every((item) => item.raw !== null);
        const allRendered = loaded.every((item) => item.raw === null);
        if (!allRaw && !allRendered)
          throw new Error('Do not mix DNG sensor inputs with rendered images');
        const metadataReview = reviewBracketMetadata(loaded);
        setMethod(allRaw ? 'radiance' : 'exposure-fusion');
        setReferenceIndex('0');
        setItems(loaded);
        setReviewWarnings(metadataReview.warnings);
        setReviewBlocking(metadataReview.blocking);
        announce(`${loaded.length} bracket inputs reviewed; choose a reference before merging`);
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorMessage(error instanceof Error ? error.message : 'Bracket review failed');
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
        abortRef.current = null;
      }
    },
    [announce],
  );

  const updateExposure = useCallback((index: number, value: number) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, exposureTimeSeconds: value } : item,
      ),
    );
  }, []);

  const runMerge = useCallback(async () => {
    if (!isImageShape(node) || items.length < 2) return;
    const reference = Number(referenceIndex);
    if (!Number.isInteger(reference) || reference < 0 || reference >= items.length) {
      setErrorMessage('Select one bracket frame as the reference');
      return;
    }
    if (method === 'radiance' && reviewBlocking.length > 0) {
      setErrorMessage(
        `Radiance merge is blocked until the bracket is consistent: ${reviewBlocking.join(' ')}`,
      );
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setErrorMessage(null);
    try {
      const frames: HdrFrame[] = items.map((item) => ({
        raster: item.raster,
        ...(item.exposureTimeSeconds !== undefined
          ? { exposureTimeSeconds: item.exposureTimeSeconds }
          : {}),
        sourceLabel: item.name,
      }));
      const aligned = alignBracketFrames(frames, {
        referenceIndex: reference,
        maxTranslationPx: 32,
      });
      await cancellationCheckpoint(controller.signal);
      const deghost = buildDeghostMasks(aligned.frames, {
        referenceIndex: reference,
        differenceThreshold: threshold,
        normalization: method === 'radiance' ? 'metadata' : 'rendered-local-contrast',
      });
      await cancellationCheckpoint(controller.signal);
      setMovingPixels(deghost.movingPixels);
      const merged =
        method === 'radiance'
          ? mergeRadianceBracket(aligned.frames, {
              referenceIndex: reference,
              validMasks: deghost.validMasks,
            })
          : fuseDisplayBracket(aligned.frames, {
              referenceIndex: reference,
              validMasks: deghost.validMasks,
            });
      await cancellationCheckpoint(controller.signal);
      if (controller.signal.aborted) return;
      const exr = encodeOpenExr(merged.raster, { precision: 'float32' });
      const nextMasterUrl = bytesToDataUrl(exr, 'image/x-exr');
      const nextPreviewUrl = rangeRasterToSdrPngDataUrl(merged.raster);
      setMasterUrl(nextMasterUrl);
      setMasterRaster(merged.raster);
      setPreviewUrl(nextPreviewUrl);
      updateDoc((doc) =>
        buildHdrDocument(
          doc,
          node.id,
          items,
          merged.raster,
          nextMasterUrl,
          nextPreviewUrl,
          method,
          reference,
          threshold,
          aligned.transforms.map(({ dx, dy, score }) => ({ dx, dy, score })),
        ),
      );
      announce(
        method === 'radiance'
          ? 'HDR radiance master saved with an SDR rendition'
          : 'Exposure-fusion rendition saved; it is not calibrated scene radiance',
      );
      onApplied();
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : 'HDR merge failed');
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      abortRef.current = null;
    }
  }, [
    announce,
    items,
    method,
    node,
    onApplied,
    referenceIndex,
    reviewBlocking,
    threshold,
    updateDoc,
  ]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Merge exposure bracket"
      size="lg"
      dismissible={!busy}
      focusFirstControl
      footer={
        <div className="photo-source-section__actions">
          <Button variant="secondary" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void runMerge()} loading={busy} disabled={items.length < 2}>
            {method === 'radiance' ? 'Build radiance master' : 'Build exposure-fusion master'}
          </Button>
        </div>
      }
    >
      <div className="hdr-merge-dialog">
        <p>
          Radiance merge requires genuine linear sensor developments and positive exposure times.
          Rendered images use a separate exposure-fusion path and retain different semantics.
        </p>
        <label className="hdr-merge-dialog__file">
          <span>Reviewed bracket inputs</span>
          <input
            type="file"
            multiple
            accept=".dng,.DNG,.jpg,.jpeg,.png,.tif,.tiff,.webp"
            onChange={(event) => void handleFiles(event)}
          />
        </label>
        {items.length > 0 && (
          <>
            <Select
              label="Reference frame"
              value={referenceIndex}
              options={items.map((item, index) => ({
                value: String(index),
                label: `${index + 1}. ${item.name}`,
              }))}
              onChange={setReferenceIndex}
            />
            <div className="hdr-merge-dialog__method" role="status">
              Method:{' '}
              <strong>
                {method === 'radiance' ? 'Radiance reconstruction' : 'Exposure fusion'}
              </strong>
            </div>
            <PhotoRangeControl
              label="Deghost threshold"
              min={0.05}
              max={1}
              step={0.01}
              value={threshold}
              onChange={setThreshold}
            />
            <div className="hdr-merge-dialog__list">
              {items.map((item, index) => (
                <div className="hdr-merge-dialog__row" key={item.dataUrl}>
                  <span title={item.name}>{item.name}</span>
                  <label>
                    exposure (s)
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={item.exposureTimeSeconds ?? ''}
                      placeholder={method === 'radiance' ? 'required' : 'not used'}
                      disabled={method !== 'radiance'}
                      onChange={(event) => updateExposure(index, Number(event.target.value))}
                    />
                  </label>
                </div>
              ))}
            </div>
            {reviewWarnings.length > 0 && (
              <div className="photo-source-section__warning" role="status">
                <strong>Review before merge</strong>
                <ul>
                  {reviewWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <p>
              Translation alignment is bounded to ±32 px. Rotation, parallax, rolling shutter, and
              focus breathing remain review warnings; uncovered borders stay invalid coverage.
            </p>
          </>
        )}
        {busy && <p role="status">Reviewing, aligning, deghosting, and encoding…</p>}
        {movingPixels > 0 && (
          <p role="status">
            Deghost preview excludes {movingPixels.toLocaleString()} potential motion/low-confidence
            samples.
          </p>
        )}
        {previewUrl && (
          <figure className="hdr-merge-dialog__preview">
            <img src={previewUrl} alt="SDR preview of the merged HDR result" />
            <figcaption>
              SDR review rendition; extended master data is stored separately.
            </figcaption>
          </figure>
        )}
        {masterUrl && (
          <a
            href={masterUrl}
            download={
              method === 'radiance' ? 'varve-radiance-master.exr' : 'varve-exposure-fusion.exr'
            }
            className="hdr-merge-dialog__download"
          >
            Download verified OpenEXR {method === 'radiance' ? 'radiance' : 'exposure-fusion'}{' '}
            master
          </a>
        )}
        {masterRaster && (
          <p className="photo-source-section__note" role="status">
            {method === 'radiance'
              ? 'Scene-linear radiance master with an independent SDR rendition.'
              : 'Display-linear exposure-fusion master; it does not reconstruct calibrated scene radiance.'}
          </p>
        )}
        {masterRaster && <HdrDisplayPreview source={masterRaster} />}
        {errorMessage && (
          <p className="photo-source-section__error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function HdrDisplayPreview({ source }: { source: RangeRaster }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capabilities, setCapabilities] = useState<HdrDisplayCapabilities | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      setCapabilities(renderExtendedCanvasPreview(canvas, source));
    } catch (error) {
      setCapabilities({
        availability: 'unknown',
        float16Canvas: false,
        highDynamicRangeMedia: false,
        wideGamutMedia: false,
        webGpuAvailable: false,
        explanation: error instanceof Error ? error.message : 'HDR canvas preview failed',
      });
    }
  }, [source]);

  if (!capabilities || capabilities.availability === 'unsupported') {
    return (
      <p className="photo-source-section__note" role="status">
        HDR display route unavailable here; the OpenEXR master remains valid and the SDR rendition
        is independent of this monitor.
      </p>
    );
  }
  return (
    <figure className="hdr-merge-dialog__preview hdr-merge-dialog__preview--hdr">
      <canvas ref={canvasRef} aria-label="Extended-range HDR canvas preview" />
      <figcaption>
        {capabilities.availability === 'candidate'
          ? 'HDR canvas candidate'
          : 'HDR canvas capability uncertain'}
        : {capabilities.explanation}
      </figcaption>
    </figure>
  );
}

async function decodeRenderedFile(dataUrl: string): Promise<RangeRaster> {
  if (typeof Image === 'undefined') throw new Error('Rendered bracket decoding requires a browser');
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('Rendered bracket frame could not be decoded'));
    element.src = dataUrl;
  });
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0)
    throw new Error('Rendered bracket dimensions are invalid');
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Rendered bracket canvas is unavailable');
  context.drawImage(image, 0, 0);
  const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const raster = createRangeRaster({
    width: canvas.width,
    height: canvas.height,
    stride: canvas.width * 4,
    channelLayout: 'rgba',
    sampleType: 'float32',
    encoding: {
      model: 'rgb',
      primaries: 'srgb',
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
      provenance: 'assumed',
    },
    reference: 'display-linear',
    referenceWhite: 1,
    alphaMode: 'straight',
    provenance: 'rendered-image',
  });
  for (let index = 0; index < canvas.width * canvas.height; index++) {
    const input = index * 4;
    const output = index * 4;
    raster.pixels[output] = srgbToLinear(bytes[input]! / 255);
    raster.pixels[output + 1] = srgbToLinear(bytes[input + 1]! / 255);
    raster.pixels[output + 2] = srgbToLinear(bytes[input + 2]! / 255);
    raster.pixels[output + 3] = bytes[input + 3]! / 255;
  }
  return raster;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

async function cancellationCheckpoint(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('HDR operation cancelled', 'AbortError');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (signal.aborted) throw new DOMException('HDR operation cancelled', 'AbortError');
}

function buildHdrDocument(
  doc: Document,
  nodeId: string,
  items: readonly BracketItem[],
  raster: RangeRaster,
  masterDataUrl: string,
  sdrDataUrl: string,
  method: MergeMethod,
  referenceIndex: number,
  threshold: number,
  transforms: readonly { dx: number; dy: number; score: number }[],
): Document {
  const sourceDrafts = items.map((item) =>
    createEmbeddedAsset({
      dataUrl: item.dataUrl,
      mimeType: item.mimeType,
      naturalWidth: item.raster.contract.width,
      naturalHeight: item.raster.contract.height,
    }),
  );
  const sourceAssetIds = sourceDrafts.map((asset) => asset.id);
  const decoderId =
    method === 'radiance' ? 'varve-dng-bayer-uncompressed/1' : 'browser-srgb-decode/1';
  const recipe = {
    method,
    referenceIndex,
    deghostThreshold: threshold,
    toneMapExposureStops: 0,
    toneMapWhitePoint: 1,
    transforms,
    exposures: items.map((item) => item.exposureTimeSeconds ?? null),
  };
  const sourceRevision = photoSourceRevision(
    sourceDrafts.map((asset) => asset.hash),
    decoderId,
    recipe,
  );
  const masterDraft = createEmbeddedAsset({
    dataUrl: masterDataUrl,
    mimeType: 'image/x-exr',
    naturalWidth: raster.contract.width,
    naturalHeight: raster.contract.height,
  });
  const sdrDraft = createEmbeddedAsset({
    dataUrl: sdrDataUrl,
    mimeType: 'image/png',
    naturalWidth: raster.contract.width,
    naturalHeight: raster.contract.height,
  });
  const operation: PhotoSourceBinding['operation'] =
    method === 'radiance' ? 'hdr-radiance' : 'hdr-exposure-fusion';
  const binding: PhotoSourceBinding = {
    operation,
    sourceAssetIds,
    sourceRevision,
    derivedAssetId: sdrDraft.id,
    masterAssetId: masterDraft.id,
    decoderId,
    recipe,
    stage: method === 'radiance' ? 'scene-linear' : 'display-linear',
    status: 'current',
  };
  const sourceAssets = Object.fromEntries(
    sourceDrafts.map((asset, index) => {
      const item = items[index]!;
      return [
        asset.id,
        item.raw
          ? {
              ...asset,
              photoSource: {
                role: 'raw-source' as const,
                sourceAssetIds: [],
                sourceRevision: asset.hash,
                decoderId: 'varve-dng-bayer-uncompressed/1',
              },
            }
          : asset,
      ];
    }),
  );
  const masterAsset = {
    ...masterDraft,
    photoSource: {
      role: 'hdr-master' as const,
      sourceAssetIds,
      sourceRevision,
      operation,
      decoderId,
      recipe,
    },
  };
  const assets = {
    ...doc.assets,
    ...sourceAssets,
    [masterDraft.id]: masterAsset,
    [sdrDraft.id]: {
      ...sdrDraft,
      photoSource: {
        role: 'sdr-rendition' as const,
        sourceAssetIds: [masterDraft.id],
        sourceRevision,
        operation,
        decoderId,
        recipe,
      },
    },
  };
  const withFill = replaceImageFill({ ...doc, assets }, nodeId, (current) => ({
    ...current,
    src: sdrDataUrl,
    assetId: sdrDraft.id,
    imageWidth: raster.contract.width,
    imageHeight: raster.contract.height,
    photoSource: binding,
  }));
  return withFill;
}

interface BracketMetadataReview {
  warnings: string[];
  blocking: string[];
}

function reviewBracketMetadata(items: readonly BracketItem[]): BracketMetadataReview {
  const warnings: string[] = [];
  const blocking: string[] = [];
  const payloads = items.map((item) => item.dataUrl.slice(item.dataUrl.indexOf(',') + 1));
  if (new Set(payloads).size !== payloads.length) {
    throw new Error('The reviewed bracket contains duplicate source bytes');
  }
  const rawItems = items.filter(
    (item): item is BracketItem & { raw: RawMosaic } => item.raw !== null,
  );
  if (rawItems.length !== items.length) {
    warnings.push(
      'Rendered inputs are decoded as assumed sRGB display data; they are exposure-fused, not calibrated sensor radiance.',
    );
    return { warnings, blocking };
  }
  const first = rawItems[0]!.raw;
  compareKnown(
    warnings,
    blocking,
    rawItems,
    'camera model',
    (raw) => raw.camera.uniqueModel ?? raw.camera.model,
    true,
  );
  compareKnown(warnings, blocking, rawItems, 'sensor encoding', (raw) => raw.sourceFormat, true);
  compareKnown(warnings, blocking, rawItems, 'bit depth', (raw) => raw.bitDepth, true);
  compareKnown(
    warnings,
    blocking,
    rawItems,
    'CFA pattern',
    (raw) => JSON.stringify(raw.cfaPattern),
    true,
  );
  compareKnown(warnings, blocking, rawItems, 'orientation', (raw) => raw.camera.orientation, true);
  compareKnown(
    warnings,
    blocking,
    rawItems,
    'active area',
    (raw) => JSON.stringify(raw.activeArea),
    true,
  );
  compareKnown(
    warnings,
    blocking,
    rawItems,
    'default crop',
    (raw) => JSON.stringify(raw.defaultCrop),
    true,
  );
  compareKnown(
    warnings,
    blocking,
    rawItems,
    'focal length',
    (raw) => raw.camera.focalLengthMm,
    true,
  );
  compareKnown(warnings, blocking, rawItems, 'ISO', (raw) => raw.camera.iso, true);
  compareKnown(warnings, blocking, rawItems, 'aperture', (raw) => raw.camera.fNumber, true);
  if (
    rawItems.some(
      (item) =>
        item.raw.camera.iso === undefined ||
        item.raw.camera.fNumber === undefined ||
        item.raw.camera.focalLengthMm === undefined,
    )
  ) {
    warnings.push(
      'One or more RAW frames lack ISO, aperture, or focal-length metadata; confirm the bracket was captured without gain/aperture changes.',
    );
  }
  if (rawItems.some((item) => item.raw.camera.exposureTimeSeconds === undefined)) {
    warnings.push('One or more exposure times are missing; enter them before radiance merge.');
  }
  if (first.camera.model === undefined && first.camera.uniqueModel === undefined) {
    warnings.push(
      'Camera model metadata is unavailable; source identity was not inferred from filenames.',
    );
  }
  return { warnings, blocking };
}

function compareKnown(
  warnings: string[],
  blocking: string[],
  items: readonly (BracketItem & { raw: RawMosaic })[],
  label: string,
  read: (raw: RawMosaic) => unknown,
  isBlocking: boolean,
): void {
  const values = items.map((item) => read(item.raw));
  const known = values.filter((value) => value !== undefined);
  if (known.length > 0 && new Set(known.map((value) => JSON.stringify(value))).size > 1) {
    const message = `${label} differs across frames; radiance normalization is not valid.`;
    (isBlocking ? blocking : warnings).push(message);
  } else if (known.length !== values.length) {
    warnings.push(`${label} is missing from one or more frames.`);
  }
}
