import type { RawDevelopDiagnostics, RawMosaic, RawRecipe } from '@varve/engine/raw';
import { defaultRawRecipe, isDngSignature } from '@varve/engine/raw';
import {
  createEmbeddedAsset,
  type Document,
  type DocumentAsset,
  getImageFill,
  isImageShape,
  type PhotoSourceBinding,
  photoSourceRevision,
  type RasterLayerNode,
  type SceneNode,
} from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { decodeImageData } from '../../../imageBounds';
import { HdrSourceSection } from './HdrSourceSection';
import {
  addPhotoAssetSet,
  addRetouchLayerSet,
  bytesToDataUrl,
  dataUrlToBytes,
  MAX_PHOTO_SOURCE_BYTES,
  parseRawRecipe,
  rangeRasterToSdrPngDataUrl,
  replaceImageFill,
} from './photoSourceWorkflow';
import { decodeAndDevelopRaw, developRawSession } from './rawDevelopmentWorkerHost';

import './photoSource.css';

type RawStatus = 'idle' | 'decoding' | 'developing' | 'error';

interface RawSession {
  sourceAssetId: string;
  sourceDataUrl: string;
  mosaic: RawMosaic;
  workerSessionId?: string;
}

const PROFILE_OPTIONS = [
  {
    value: 'camera-matrix',
    label: 'Camera matrix',
    description: 'Use the DNG ColorMatrix when present.',
  },
  {
    value: 'srgb-d65',
    label: 'sRGB D65 fallback',
    description: 'Explicit fallback; sensor channels are not sRGB by themselves.',
  },
];

const WHITE_BALANCE_OPTIONS = [
  { value: 'as-shot', label: 'As shot' },
  { value: 'custom', label: 'Custom sensor multipliers' },
];

const CAMERA_MATRIX_OPTIONS = [
  { value: 'auto', label: 'Automatic (as-shot)' },
  { value: 'color-matrix-1', label: 'ColorMatrix1' },
  { value: 'color-matrix-2', label: 'ColorMatrix2' },
];

export function PhotoSourceSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce, setSelection } = useEditor();
  const node = nodes.length === 1 ? state.document.nodes[nodes[0]!.id] : undefined;
  const imageFill = node?.kind === 'shape' && isImageShape(node) ? getImageFill(node) : undefined;
  const image = imageFill?.type === 'image' ? imageFill.image : undefined;
  const binding = image?.photoSource;
  const sourceAsset = binding?.sourceAssetIds[0]
    ? state.document.assets?.[binding.sourceAssetIds[0]]
    : undefined;
  const [rawStatus, setRawStatus] = useState<RawStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<RawRecipe | null>(() =>
    binding?.operation === 'raw-development' ? parseRawRecipe(binding.recipe) : null,
  );
  const [diagnostics, setDiagnostics] = useState<RawDevelopDiagnostics | null>(null);
  const [comparisonUrl, setComparisonUrl] = useState<string | null>(null);
  const [repairStatus, setRepairStatus] = useState<'idle' | 'preparing' | 'error'>('idle');
  const [repairError, setRepairError] = useState<string | null>(null);
  const rawSessionRef = useRef<RawSession | null>(null);
  const rawOperationRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (binding?.operation !== 'raw-development') {
      setRecipe(null);
      setDiagnostics(null);
      setComparisonUrl(null);
      return;
    }
    const persistedRecipe = parseRawRecipe(binding.recipe);
    if (persistedRecipe) setRecipe(persistedRecipe);
  }, [binding?.operation, binding?.recipe]);

  useEffect(() => {
    if (binding?.operation !== 'raw-development' || !sourceAsset?.dataUrl) {
      rawSessionRef.current = null;
      setDiagnostics(null);
      setComparisonUrl(null);
      return;
    }
    if (rawSessionRef.current?.sourceDataUrl === sourceAsset.dataUrl) return;
    let cancelled = false;
    const controller = new AbortController();
    setRawStatus('decoding');
    setErrorMessage(null);
    void decodeAndDevelopRaw(
      dataUrlToBytes(sourceAsset.dataUrl),
      parseRawRecipe(binding.recipe) ?? undefined,
      controller.signal,
    )
      .then((decoded) => {
        if (cancelled) return;
        rawSessionRef.current = {
          sourceAssetId: sourceAsset.id,
          sourceDataUrl: sourceAsset.dataUrl,
          mosaic: decoded.mosaic,
          workerSessionId: decoded.workerSessionId,
        };
        setRecipe(decoded.recipe);
        setDiagnostics(decoded.result.diagnostics);
        setRawStatus('idle');
      })
      .catch((error) => {
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return;
        rawSessionRef.current = null;
        setRawStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'RAW source could not be decoded');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [binding?.operation, binding?.recipe, sourceAsset?.dataUrl, sourceAsset?.id]);

  const applyRawRecipe = useCallback(
    async (nextRecipe: RawRecipe) => {
      if (!node || !image || !isImageShape(node)) return;
      const session = rawSessionRef.current;
      if (!session) {
        announce('RAW source is not decoded; choose the original DNG again');
        return;
      }
      const operation = ++rawOperationRef.current;
      setRawStatus('developing');
      setErrorMessage(null);
      try {
        const result = await developRawSession(session, nextRecipe);
        if (operation !== rawOperationRef.current || rawSessionRef.current !== session) return;
        const sdrDataUrl = rangeRasterToSdrPngDataUrl(result.raster);
        updateDoc((doc) =>
          buildRawDevelopmentDocument(
            doc,
            node.id,
            session,
            nextRecipe,
            sdrDataUrl,
            result.raster.contract.width,
            result.raster.contract.height,
          ),
        );
        setRecipe(nextRecipe);
        setDiagnostics(result.diagnostics);
        setComparisonUrl(null);
        setRawStatus('idle');
        announce('RAW development updated; source mosaic remains embedded');
      } catch (error) {
        setRawStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'RAW development failed');
      }
    },
    [announce, image, node, updateDoc],
  );

  const handleRawPick = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !node || !isImageShape(node)) return;
      setRawStatus('decoding');
      setErrorMessage(null);
      setComparisonUrl(null);
      const operation = ++rawOperationRef.current;
      try {
        if (file.size > MAX_PHOTO_SOURCE_BYTES) {
          throw new Error(
            `Source file exceeds the ${(MAX_PHOTO_SOURCE_BYTES / (1024 * 1024)).toFixed(0)} MiB limit`,
          );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!isDngSignature(bytes)) {
          throw new Error('This RAW slice accepts classic uncompressed Bayer/monochrome DNG only');
        }
        const sourceDataUrl = bytesToDataUrl(bytes, 'image/x-adobe-dng');
        const decoded = await decodeAndDevelopRaw(bytes);
        if (operation !== rawOperationRef.current) return;
        const { mosaic, recipe: nextRecipe, result } = decoded;
        const session = {
          sourceAssetId: '',
          sourceDataUrl,
          mosaic,
          workerSessionId: decoded.workerSessionId,
        };
        const sdrDataUrl = rangeRasterToSdrPngDataUrl(result.raster);
        updateDoc((doc) =>
          buildRawDevelopmentDocument(
            doc,
            node.id,
            session,
            nextRecipe,
            sdrDataUrl,
            result.raster.contract.width,
            result.raster.contract.height,
          ),
        );
        rawSessionRef.current = {
          ...session,
          sourceAssetId: createEmbeddedAsset({
            dataUrl: sourceDataUrl,
            mimeType: 'image/x-adobe-dng',
            naturalWidth: mosaic.width,
            naturalHeight: mosaic.height,
          }).id,
        };
        setRecipe(nextRecipe);
        setDiagnostics(result.diagnostics);
        setRawStatus('idle');
        announce(`Developed ${file.name} from sensor data`);
      } catch (error) {
        setRawStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'RAW import failed');
      }
    },
    [announce, node, updateDoc],
  );

  const prepareRetouchLayers = useCallback(async () => {
    if (!node || !image || !isImageShape(node)) return;
    setRepairStatus('preparing');
    setRepairError(null);
    try {
      const imageData = await decodeImageData(image.src);
      if (!imageData) throw new Error('This image could not be decoded into editable pixels');
      const prepared = addRetouchLayerSet(state.document, node.id, {
        width: imageData.width,
        height: imageData.height,
        pixels: imageData.data,
      });
      if (!prepared)
        throw new Error('Select one uncropped rectangular image to prepare for retouching');
      updateDoc(() => prepared.document);
      setSelection(prepared.repairNodeId, 'command');
      setRepairStatus('idle');
      announce('Created a locked photo pixel source and a separate repair layer');
    } catch (error) {
      setRepairStatus('error');
      setRepairError(error instanceof Error ? error.message : 'Retouch preparation failed');
    }
  }, [announce, image, node, setSelection, state.document, updateDoc]);

  const updateRecipe = useCallback((patch: Partial<RawRecipe>) => {
    setRecipe((current) => (current ? { ...current, ...patch } : current));
    setComparisonUrl(null);
  }, []);

  const isRaw = binding?.operation === 'raw-development' && Boolean(sourceAsset);
  const session = rawSessionRef.current;
  const asShotAvailable = Boolean(session?.mosaic.asShotNeutral);
  const cameraMatrixAvailable = Boolean(
    session?.mosaic.colorMatrix1 || session?.mosaic.colorMatrix2,
  );
  const workingRecipe = recipe ?? (session ? defaultRawRecipe(session.mosaic) : null);
  const bakedRepairLayers = Object.values(state.document.nodes).filter(
    (candidate): candidate is RasterLayerNode =>
      candidate.kind === 'rasterLayer' && candidate.retouchProvenance?.sourceNodeId === node?.id,
  );
  const staleBakedRepair =
    binding &&
    bakedRepairLayers.some(
      (candidate) => candidate.retouchProvenance?.sourceRevision !== binding.sourceRevision,
    );
  const defaultCrop = session?.mosaic.defaultCrop
    ? {
        top: session.mosaic.defaultCrop.y,
        left: session.mosaic.defaultCrop.x,
        bottom: session.mosaic.defaultCrop.y + session.mosaic.defaultCrop.height,
        right: session.mosaic.defaultCrop.x + session.mosaic.defaultCrop.width,
      }
    : undefined;
  const cropMode =
    workingRecipe && defaultCrop && sameCrop(workingRecipe.crop, defaultCrop)
      ? 'default'
      : 'active';

  const comparePendingRecipe = useCallback(() => {
    const currentSession = rawSessionRef.current;
    if (!currentSession || !workingRecipe) return;
    const operation = ++rawOperationRef.current;
    setRawStatus('developing');
    setErrorMessage(null);
    void developRawSession(currentSession, workingRecipe)
      .then((result) => {
        if (operation !== rawOperationRef.current || rawSessionRef.current !== currentSession)
          return;
        setComparisonUrl(rangeRasterToSdrPngDataUrl(result.raster));
        setRawStatus('idle');
        announce('Generated an SDR before-and-after comparison; apply to commit it');
      })
      .catch((error) => {
        if (operation !== rawOperationRef.current) return;
        setRawStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Comparison preview failed');
      });
  }, [announce, workingRecipe]);

  if (!node || !image || !isImageShape(node)) return null;

  return (
    <>
      <section className="photo-source-section" aria-labelledby="photo-source-title">
        <div className="photo-source-section__heading">
          <div>
            <h3 id="photo-source-title">Photo source</h3>
            <p>
              Develop sensor data or review an exposure bracket without replacing the originals.
            </p>
          </div>
          <span className="photo-source-section__status" data-testid="photo-source-status">
            {isRaw ? 'RAW recipe' : 'Rendered image'}
          </span>
        </div>

        {!isRaw && (
          <div className="photo-source-section__actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".dng,.DNG"
              hidden
              onChange={handleRawPick}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              Open supported DNG
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={repairStatus === 'preparing'}
              onClick={() => void prepareRetouchLayers()}
            >
              Prepare retouch layers
            </Button>
            {repairStatus === 'error' && repairError && (
              <p className="photo-source-section__error" role="alert">
                {repairError}
              </p>
            )}
          </div>
        )}

        {isRaw && workingRecipe && (
          <>
            <dl className="photo-source-section__facts">
              <div>
                <dt>Camera</dt>
                <dd>
                  {formatCameraName(session?.mosaic.camera.make, session?.mosaic.camera.model) ??
                    'Supported DNG; model not recorded'}
                </dd>
              </div>
              <div>
                <dt>Sensor data</dt>
                <dd>
                  {session?.mosaic.width} x {session?.mosaic.height} · {session?.mosaic.bitDepth}
                  -bit {session?.mosaic.kind}
                </dd>
              </div>
              <div>
                <dt>Decoder</dt>
                <dd>{workingRecipe.decoderId}</dd>
              </div>
            </dl>

            <div className="photo-source-section__grid">
              <Select
                label="Development profile"
                value={workingRecipe.profile}
                options={PROFILE_OPTIONS.map((option) => ({
                  ...option,
                  disabled: option.value === 'camera-matrix' && !cameraMatrixAvailable,
                  disabledReason:
                    option.value === 'camera-matrix' && !cameraMatrixAvailable
                      ? 'This DNG has no usable ColorMatrix.'
                      : undefined,
                }))}
                onChange={(value) => updateRecipe({ profile: value as RawRecipe['profile'] })}
              />
              <Select
                label="White balance"
                value={workingRecipe.whiteBalance}
                options={WHITE_BALANCE_OPTIONS.map((option) => ({
                  ...option,
                  disabled: option.value === 'as-shot' && !asShotAvailable,
                  disabledReason:
                    option.value === 'as-shot' && !asShotAvailable
                      ? 'The source has no calibrated as-shot neutral.'
                      : undefined,
                }))}
                onChange={(value) =>
                  updateRecipe({ whiteBalance: value as RawRecipe['whiteBalance'] })
                }
              />
              <Select
                label="Camera matrix"
                value={workingRecipe.cameraMatrix ?? 'auto'}
                options={CAMERA_MATRIX_OPTIONS.map((option) => ({
                  ...option,
                  disabled:
                    (option.value === 'color-matrix-1' && !session?.mosaic.colorMatrix1) ||
                    (option.value === 'color-matrix-2' && !session?.mosaic.colorMatrix2),
                  disabledReason:
                    option.value === 'color-matrix-1' && !session?.mosaic.colorMatrix1
                      ? 'This DNG has no ColorMatrix1.'
                      : option.value === 'color-matrix-2' && !session?.mosaic.colorMatrix2
                        ? 'This DNG has no ColorMatrix2.'
                        : undefined,
                }))}
                onChange={(value) =>
                  updateRecipe({ cameraMatrix: value as RawRecipe['cameraMatrix'] })
                }
              />
            </div>
            <div className="photo-source-section__grid">
              <Select
                label="Crop"
                value={cropMode}
                options={[
                  {
                    value: 'default',
                    label: 'Camera default crop',
                    disabled: !defaultCrop,
                    disabledReason: !defaultCrop
                      ? 'This DNG has no DefaultCrop metadata.'
                      : undefined,
                  },
                  { value: 'active', label: 'Active sensor area' },
                ]}
                onChange={(value) =>
                  updateRecipe({
                    crop:
                      value === 'default' && defaultCrop ? defaultCrop : session?.mosaic.activeArea,
                  })
                }
              />
              <Select
                label="Orientation"
                value={String(workingRecipe.orientation)}
                options={[
                  { value: '1', label: 'Normal' },
                  { value: '2', label: 'Flip horizontal' },
                  { value: '3', label: 'Rotate 180°' },
                  { value: '4', label: 'Flip vertical' },
                  { value: '5', label: 'Transpose' },
                  { value: '6', label: 'Rotate 90° CW' },
                  { value: '7', label: 'Transverse' },
                  { value: '8', label: 'Rotate 270° CW' },
                ]}
                onChange={(value) =>
                  updateRecipe({ orientation: Number(value) as RawRecipe['orientation'] })
                }
              />
            </div>
            <Select
              label="Lens correction"
              value={workingRecipe.lensCorrection}
              options={[
                { value: 'none', label: 'None' },
                {
                  value: 'lensfun-if-available',
                  label: 'Lensfun profile when available',
                  disabled: true,
                  disabledReason: 'No matching Lensfun profile is bundled for this source.',
                },
              ]}
              onChange={(value) =>
                updateRecipe({ lensCorrection: value as RawRecipe['lensCorrection'] })
              }
            />

            <PhotoRangeControl
              label="Exposure"
              min={-5}
              max={5}
              step={0.01}
              value={workingRecipe.exposureStops}
              unit=" stops"
              onChange={(value) => updateRecipe({ exposureStops: value })}
            />
            <div className="photo-source-section__grid">
              <PhotoRangeControl
                label="Black point"
                min={0}
                max={0.5}
                step={0.001}
                value={workingRecipe.blackPoint}
                onChange={(value) => updateRecipe({ blackPoint: value })}
              />
              <PhotoRangeControl
                label="White point"
                min={0.5}
                max={2}
                step={0.001}
                value={workingRecipe.whitePoint}
                onChange={(value) => updateRecipe({ whitePoint: value })}
              />
              <PhotoRangeControl
                label="Highlights"
                min={0}
                max={1}
                step={0.01}
                value={workingRecipe.highlights}
                onChange={(value) => updateRecipe({ highlights: value })}
              />
              <PhotoRangeControl
                label="Shadows"
                min={0}
                max={1}
                step={0.01}
                value={workingRecipe.shadows}
                onChange={(value) => updateRecipe({ shadows: value })}
              />
              <PhotoRangeControl
                label="Noise reduction"
                min={0}
                max={1}
                step={0.01}
                value={workingRecipe.noiseReduction}
                onChange={(value) => updateRecipe({ noiseReduction: value })}
              />
              <PhotoRangeControl
                label="Capture sharpening"
                min={0}
                max={1}
                step={0.01}
                value={workingRecipe.captureSharpening}
                onChange={(value) => updateRecipe({ captureSharpening: value })}
              />
              <PhotoRangeControl
                label="Output sharpening"
                min={0}
                max={1}
                step={0.01}
                value={workingRecipe.outputSharpening}
                onChange={(value) => updateRecipe({ outputSharpening: value })}
              />
            </div>
            {workingRecipe.whiteBalance === 'custom' && (
              <div className="photo-source-section__multipliers">
                <span className="photo-source-section__label">Custom sensor multipliers</span>
                {(['red', 'green', 'blue'] as const).map((channel, index) => (
                  <label key={channel}>
                    {channel}
                    <input
                      type="number"
                      min="0.01"
                      max="8"
                      step="0.01"
                      value={workingRecipe.customMultipliers?.[index] ?? 1}
                      onChange={(event) => {
                        const next = [...(workingRecipe.customMultipliers ?? [1, 1, 1])] as [
                          number,
                          number,
                          number,
                        ];
                        next[index] = Number(event.target.value);
                        updateRecipe({ customMultipliers: next });
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="photo-source-section__actions">
              <Button
                size="sm"
                loading={rawStatus === 'developing'}
                onClick={() => void applyRawRecipe(workingRecipe)}
              >
                Apply development
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (session) {
                    const reset = defaultRawRecipe(session.mosaic);
                    setRecipe(reset);
                    void applyRawRecipe(reset);
                  }
                }}
              >
                Reset recipe
              </Button>
              <Button size="sm" variant="secondary" onClick={comparePendingRecipe}>
                Compare pending
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={repairStatus === 'preparing'}
                onClick={() => void prepareRetouchLayers()}
              >
                Prepare retouch layers
              </Button>
              <a
                className="photo-source-section__download"
                href={image.src}
                download="varve-developed-sdr.png"
              >
                Download full-resolution developed SDR
              </a>
            </div>
            {diagnostics && (
              <p className="photo-source-section__diagnostics" role="status">
                Sensor-clipped pixels: {diagnostics.sensorClippedPixels.toLocaleString()} · output
                clipping at reference white: {diagnostics.outputClippedPixels.toLocaleString()}
              </p>
            )}
            {bakedRepairLayers.length > 0 && (
              <p className="photo-source-section__warning" role="status">
                {staleBakedRepair
                  ? 'A downstream repair layer is baked to an older RAW revision; rebase or reapply it intentionally after reviewing this development.'
                  : 'Downstream repair is baked to this RAW source revision; changing the recipe will require an intentional rebase or reapply.'}
              </p>
            )}
            {comparisonUrl && (
              <fieldset className="photo-source-section__comparison">
                <legend>RAW before and after comparison</legend>
                <figure>
                  <img src={image.src} alt="Applied RAW development rendition" />
                  <figcaption>Applied</figcaption>
                </figure>
                <figure>
                  <img src={comparisonUrl} alt="Pending RAW development rendition" />
                  <figcaption>Pending recipe</figcaption>
                </figure>
              </fieldset>
            )}
            {session?.mosaic.warnings.map((warning) => (
              <p className="photo-source-section__warning" key={warning}>
                {warning}
              </p>
            ))}
          </>
        )}
        {rawStatus === 'decoding' && <p role="status">Reading sensor data…</p>}
        {rawStatus === 'error' && errorMessage && (
          <p className="photo-source-section__error" role="alert">
            {errorMessage}
          </p>
        )}
        {isRaw && (
          <p className="photo-source-section__note">
            The preview is an SDR rendition. The DNG bytes and versioned recipe remain the
            authority; missing lens profiles and unsupported DNG opcodes are reported, not guessed.
            Pixel repairs made downstream are baked to this source revision; changing the recipe
            preserves the repair layer but requires an intentional reapply or rebase.
          </p>
        )}
      </section>
      <HdrSourceSection node={node} />
    </>
  );
}

function PhotoRangeControl({
  label,
  min,
  max,
  step,
  value,
  unit = '',
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="photo-source-section__range">
      <span>
        {label}{' '}
        <output>
          {value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}
          {unit}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function buildRawDevelopmentDocument(
  doc: Document,
  nodeId: string,
  session: RawSession,
  recipe: RawRecipe,
  sdrDataUrl: string,
  outputWidth: number,
  outputHeight: number,
): Document {
  const sourceInput = {
    dataUrl: session.sourceDataUrl,
    mimeType: 'image/x-adobe-dng',
    naturalWidth: session.mosaic.width,
    naturalHeight: session.mosaic.height,
  };
  const sourceDraft = createEmbeddedAsset(sourceInput);
  const sourceRevision = photoSourceRevision([sourceDraft.hash], recipe.decoderId, recipe);
  const binding: PhotoSourceBinding = {
    operation: 'raw-development',
    sourceAssetIds: [sourceDraft.id],
    sourceRevision,
    derivedAssetId: '',
    decoderId: recipe.decoderId,
    recipe: recipe as unknown as Record<string, unknown>,
    stage: 'display-linear',
    status: 'current',
  };
  const derivedDraft = createEmbeddedAsset({
    dataUrl: sdrDataUrl,
    mimeType: 'image/png',
    naturalWidth: outputWidth,
    naturalHeight: outputHeight,
  });
  binding.derivedAssetId = derivedDraft.id;
  const sourceProvenance: NonNullable<DocumentAsset['photoSource']> = {
    role: 'raw-source',
    sourceAssetIds: [],
    sourceRevision: sourceDraft.hash,
    decoderId: recipe.decoderId,
  };
  const derivedProvenance: NonNullable<DocumentAsset['photoSource']> = {
    role: 'developed-raster',
    sourceAssetIds: [sourceDraft.id],
    sourceRevision,
    operation: 'raw-development',
    decoderId: recipe.decoderId,
    recipe: recipe as unknown as Record<string, unknown>,
  };
  const assets = addPhotoAssetSet(
    doc,
    sourceInput,
    sourceProvenance,
    {
      dataUrl: sdrDataUrl,
      mimeType: 'image/png',
      naturalWidth: outputWidth,
      naturalHeight: outputHeight,
    },
    derivedProvenance,
  );
  return replaceImageFill(assets.document, nodeId, (current) => ({
    ...current,
    src: sdrDataUrl,
    assetId: assets.derivedAsset.id,
    imageWidth: outputWidth,
    imageHeight: outputHeight,
    photoSource: binding,
  }));
}

function sameCrop(
  first: RawRecipe['crop'] | undefined,
  second: RawRecipe['crop'] | undefined,
): boolean {
  return (
    first?.top === second?.top &&
    first?.left === second?.left &&
    first?.bottom === second?.bottom &&
    first?.right === second?.right
  );
}

function formatCameraName(make: string | undefined, model: string | undefined): string | undefined {
  const parts = [make, model].filter((value): value is string => Boolean(value?.trim()));
  return parts.length > 0 ? parts.join(' ') : undefined;
}
