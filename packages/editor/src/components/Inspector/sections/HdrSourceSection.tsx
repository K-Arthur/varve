import { decodeOpenExr, type OpenExrDecodeResult } from '@varve/engine/hdr';
import {
  createEmbeddedAsset,
  type Document,
  getImageFill,
  type ImageFillData,
  isImageShape,
  type PhotoSourceBinding,
  photoSourceRevision,
  type SceneNode,
} from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { PhotoRangeControl } from '../controls/PhotoRangeControl';
import { GainMapExportSection } from './GainMapExportSection';
import { HdrMergeDialog } from './HdrMergeDialog';
import {
  bytesToDataUrl,
  dataUrlToBytes,
  MAX_PHOTO_SOURCE_BYTES,
  rangeRasterToSdrPngDataUrl,
  replaceImageFill,
} from './photoSourceWorkflow';

import './photoSource.css';

const OPENEXR_DECODER_ID = 'varve-openexr-subset/1';

interface HdrSession {
  assetId: string;
  dataUrl: string;
  decoded: OpenExrDecodeResult;
}

type HdrStatus = 'idle' | 'decoding' | 'applying' | 'error';

export function HdrSourceSection({ node }: { node: SceneNode }) {
  const { state, updateDoc, announce } = useEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [status, setStatus] = useState<HdrStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [session, setSession] = useState<HdrSession | null>(null);
  const [toneMapExposure, setToneMapExposure] = useState(0);
  const [toneMapWhitePoint, setToneMapWhitePoint] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const image = getSelectedImage(node);
  const binding = image?.photoSource;
  const masterAssetId = resolveMasterAssetId(binding);
  const masterAsset = masterAssetId ? state.document.assets?.[masterAssetId] : undefined;
  const sdrRenditionAsset = binding?.derivedAssetId
    ? state.document.assets?.[binding.derivedAssetId]
    : undefined;
  const hasHdrBinding = Boolean(
    masterAssetId && binding && binding.operation !== 'raw-development',
  );

  useEffect(() => {
    if (!hasHdrBinding || !masterAssetId || !masterAsset?.dataUrl) {
      setSession(null);
      setWarnings([]);
      setPreviewUrl(null);
      setStatus('idle');
      return;
    }
    if (session?.assetId === masterAssetId && session.dataUrl === masterAsset.dataUrl) return;
    let cancelled = false;
    setStatus('decoding');
    setErrorMessage(null);
    try {
      const decoded = decodeOpenExr(dataUrlToBytes(masterAsset.dataUrl));
      if (decoded.raster.contract.reference === 'display-referred') {
        throw new Error(
          'This EXR is display-referred; Varve needs a scene-linear or display-linear master to preserve its range',
        );
      }
      if (cancelled) return;
      setSession({ assetId: masterAssetId, dataUrl: masterAsset.dataUrl, decoded });
      setWarnings(decoded.warnings);
      setToneMapExposure(readRecipeNumber(binding?.recipe, 'toneMapExposureStops', 0));
      setToneMapWhitePoint(readRecipeNumber(binding?.recipe, 'toneMapWhitePoint', 1));
      setStatus('idle');
    } catch (error) {
      if (cancelled) return;
      setSession(null);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'HDR master could not be decoded');
    }
    return () => {
      cancelled = true;
    };
  }, [binding?.recipe, hasHdrBinding, masterAsset?.dataUrl, masterAssetId, session]);

  useEffect(() => {
    if (!session) return;
    try {
      setPreviewUrl(
        rangeRasterToSdrPngDataUrl(session.decoded.raster, {
          exposureStops: toneMapExposure,
          whitePoint: toneMapWhitePoint,
        }),
      );
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'HDR SDR preview failed');
    }
  }, [session, toneMapExposure, toneMapWhitePoint]);

  const handleOpenMaster = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !isImageShape(node)) return;
      setStatus('decoding');
      setErrorMessage(null);
      try {
        if (file.size > MAX_PHOTO_SOURCE_BYTES) {
          throw new Error(
            `EXR exceeds the ${(MAX_PHOTO_SOURCE_BYTES / (1024 * 1024)).toFixed(0)} MiB source limit`,
          );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        const decoded = decodeOpenExr(bytes);
        const stage = decoded.raster.contract.reference;
        if (stage === 'display-referred') {
          throw new Error(
            'Display-referred EXR is not accepted as a range-bearing master; export scene/display-linear OpenEXR instead',
          );
        }
        const masterDataUrl = bytesToDataUrl(bytes, 'image/x-exr');
        const masterDraft = createEmbeddedAsset({
          dataUrl: masterDataUrl,
          mimeType: 'image/x-exr',
          naturalWidth: decoded.raster.contract.width,
          naturalHeight: decoded.raster.contract.height,
        });
        const recipe = {
          toneMapExposureStops: 0,
          toneMapWhitePoint: 1,
          decoder: OPENEXR_DECODER_ID,
        };
        const sourceRevision = photoSourceRevision([masterDraft.hash], OPENEXR_DECODER_ID, recipe);
        const sdrDataUrl = rangeRasterToSdrPngDataUrl(decoded.raster, {
          exposureStops: recipe.toneMapExposureStops,
          whitePoint: recipe.toneMapWhitePoint,
        });
        const derivedDraft = createEmbeddedAsset({
          dataUrl: sdrDataUrl,
          mimeType: 'image/png',
          naturalWidth: decoded.raster.contract.width,
          naturalHeight: decoded.raster.contract.height,
        });
        const binding: PhotoSourceBinding = {
          operation: 'hdr-master-import',
          sourceAssetIds: [masterDraft.id],
          masterAssetId: masterDraft.id,
          sourceRevision,
          derivedAssetId: derivedDraft.id,
          decoderId: OPENEXR_DECODER_ID,
          recipe,
          stage,
          status: 'current',
        };
        const assets = {
          ...state.document.assets,
          [masterDraft.id]: {
            ...masterDraft,
            photoSource: {
              role: 'hdr-master' as const,
              sourceAssetIds: [],
              sourceRevision: masterDraft.hash,
              decoderId: OPENEXR_DECODER_ID,
              recipe,
            },
          },
          [derivedDraft.id]: {
            ...derivedDraft,
            photoSource: {
              role: 'sdr-rendition' as const,
              sourceAssetIds: [masterDraft.id],
              sourceRevision,
              operation: 'hdr-master-import' as const,
              decoderId: OPENEXR_DECODER_ID,
              recipe,
            },
          },
        };
        updateDoc((doc) =>
          replaceImageFill({ ...doc, assets }, node.id, (current) => ({
            ...current,
            src: sdrDataUrl,
            assetId: derivedDraft.id,
            imageWidth: decoded.raster.contract.width,
            imageHeight: decoded.raster.contract.height,
            photoSource: binding,
          })),
        );
        setWarnings(decoded.warnings);
        setStatus('idle');
        announce(`Opened range-bearing OpenEXR master from ${file.name}`);
      } catch (error) {
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'OpenEXR import failed');
      }
    },
    [announce, node, state.document.assets, updateDoc],
  );

  const applyToneMap = useCallback(() => {
    if (!session || !masterAssetId || !binding || !isImageShape(node)) return;
    setStatus('applying');
    setErrorMessage(null);
    try {
      const sdrDataUrl = rangeRasterToSdrPngDataUrl(session.decoded.raster, {
        exposureStops: toneMapExposure,
        whitePoint: toneMapWhitePoint,
      });
      updateDoc((doc) =>
        updateHdrRendition(
          doc,
          node.id,
          masterAssetId,
          binding,
          sdrDataUrl,
          toneMapExposure,
          toneMapWhitePoint,
        ),
      );
      setStatus('idle');
      announce('HDR output transform updated; the range-bearing master was not changed');
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'HDR output transform failed');
    }
  }, [
    announce,
    binding,
    masterAssetId,
    node,
    session,
    toneMapExposure,
    toneMapWhitePoint,
    updateDoc,
  ]);

  return (
    <>
      <section
        className="photo-source-section photo-source-section--hdr"
        aria-labelledby="hdr-source-title"
      >
        <div className="photo-source-section__heading">
          <div>
            <h3 id="hdr-source-title">HDR master</h3>
            <p>
              Open a supported range-bearing OpenEXR or merge reviewed exposures. The SDR image is a
              separate rendition.
            </p>
          </div>
          {hasHdrBinding && (
            <span className="photo-source-section__status" data-testid="hdr-source-status">
              {binding?.operation === 'hdr-exposure-fusion' ? 'Exposure fusion' : 'Range master'}
            </span>
          )}
        </div>
        <div className="photo-source-section__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".exr,.EXR"
            hidden
            onChange={(event) => void handleOpenMaster(event)}
          />
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            Open supported OpenEXR master
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMergeOpen(true)}>
            Merge exposure bracket
          </Button>
        </div>
        {status === 'decoding' && <p role="status">Reading range-bearing master…</p>}
        {status === 'applying' && <p role="status">Writing SDR rendition…</p>}
        {hasHdrBinding && !session && status === 'error' && errorMessage && (
          <p className="photo-source-section__error" role="alert">
            {errorMessage}
          </p>
        )}
        {session && (
          <>
            <dl className="photo-source-section__facts">
              <div>
                <dt>Master data</dt>
                <dd>
                  {session.decoded.raster.contract.width} x {session.decoded.raster.contract.height}{' '}
                  · float32 · {session.decoded.raster.contract.reference}
                </dd>
              </div>
              <div>
                <dt>Master decoder</dt>
                <dd>{binding?.decoderId ?? OPENEXR_DECODER_ID}</dd>
              </div>
              <div>
                <dt>Display route</dt>
                <dd>SDR rendition independent of monitor capability</dd>
              </div>
            </dl>
            <div className="photo-source-section__grid">
              <PhotoRangeControl
                label={
                  session.decoded.raster.contract.reference === 'scene-linear'
                    ? 'Tone-map exposure'
                    : 'Output exposure'
                }
                value={toneMapExposure}
                min={-5}
                max={5}
                step={0.01}
                onChange={setToneMapExposure}
              />
              <PhotoRangeControl
                label="Display white point"
                value={toneMapWhitePoint}
                min={0.1}
                max={4}
                step={0.01}
                onChange={setToneMapWhitePoint}
              />
            </div>
            <div className="photo-source-section__actions">
              <Button size="sm" onClick={applyToneMap} loading={status === 'applying'}>
                Apply SDR output transform
              </Button>
              {masterAsset?.dataUrl && (
                <a
                  className="photo-source-section__download"
                  href={masterAsset.dataUrl}
                  download="varve-hdr-master.exr"
                >
                  Download range-bearing OpenEXR master
                </a>
              )}
              {previewUrl && (
                <a
                  className="photo-source-section__download"
                  href={previewUrl}
                  download="varve-hdr-sdr.png"
                >
                  Download current SDR rendition
                </a>
              )}
            </div>
            {warnings.map((warning) => (
              <p className="photo-source-section__warning" key={warning}>
                {warning}
              </p>
            ))}
            <GainMapExportSection
              masterRaster={session.decoded.raster}
              sdrRenditionDataUrl={sdrRenditionAsset?.dataUrl ?? null}
              appliedExposureStops={readRecipeNumber(binding?.recipe, 'toneMapExposureStops', 0)}
              appliedWhitePoint={readRecipeNumber(binding?.recipe, 'toneMapWhitePoint', 1)}
              currentExposureStops={toneMapExposure}
              currentWhitePoint={toneMapWhitePoint}
              onAnnounce={announce}
            />
            <p className="photo-source-section__note">
              Editing the output transform creates a new SDR rendition. The OpenEXR master remains
              the authority and is not tone-mapped twice.
            </p>
          </>
        )}
        {!hasHdrBinding && status !== 'error' && (
          <p className="photo-source-section__note">
            Supported subset: Varve single-part, uncompressed scanline OpenEXR with RGB(A)
            float16/float32 channels. Deep, multipart, tiled, compressed, and unknown-channel EXR
            files are rejected.
          </p>
        )}
        {!session && status === 'error' && errorMessage && !hasHdrBinding && (
          <p className="photo-source-section__error" role="alert">
            {errorMessage}
          </p>
        )}
      </section>
      <HdrMergeDialog
        open={mergeOpen}
        node={node}
        onClose={() => setMergeOpen(false)}
        onApplied={() => undefined}
      />
    </>
  );
}

function getSelectedImage(node: SceneNode): ImageFillData | undefined {
  if (node.kind !== 'shape' || !isImageShape(node)) return undefined;
  const fill = getImageFill(node);
  return fill?.type === 'image' ? fill.image : undefined;
}

function resolveMasterAssetId(binding: PhotoSourceBinding | undefined): string | undefined {
  if (!binding || binding.operation === 'raw-development') return undefined;
  return (
    binding.masterAssetId ??
    (binding.operation === 'hdr-master-import' ? binding.sourceAssetIds[0] : undefined)
  );
}

function readRecipeNumber(
  recipe: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
) {
  const value = recipe?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function updateHdrRendition(
  doc: Document,
  nodeId: string,
  masterAssetId: string,
  binding: PhotoSourceBinding,
  sdrDataUrl: string,
  exposureStops: number,
  whitePoint: number,
): Document {
  const masterAsset = doc.assets?.[masterAssetId];
  if (!masterAsset) return doc;
  const recipe = {
    ...binding.recipe,
    toneMapExposureStops: exposureStops,
    toneMapWhitePoint: whitePoint,
  };
  const decoderId = binding.decoderId ?? OPENEXR_DECODER_ID;
  const sourceRevision = photoSourceRevision(
    binding.sourceAssetIds.map((id) => doc.assets?.[id]?.hash ?? id),
    decoderId,
    recipe,
  );
  const derived = createEmbeddedAsset({
    dataUrl: sdrDataUrl,
    mimeType: 'image/png',
    naturalWidth: masterAsset.naturalWidth,
    naturalHeight: masterAsset.naturalHeight,
  });
  const assets = {
    ...doc.assets,
    [derived.id]: {
      ...derived,
      photoSource: {
        role: 'sdr-rendition' as const,
        sourceAssetIds: [masterAssetId],
        sourceRevision,
        operation: binding.operation,
        decoderId,
        recipe,
      },
    },
  };
  return replaceImageFill({ ...doc, assets }, nodeId, (current) => ({
    ...current,
    src: sdrDataUrl,
    assetId: derived.id,
    photoSource: {
      ...binding,
      derivedAssetId: derived.id,
      sourceRevision,
      recipe,
      status: 'current',
      masterAssetId,
    },
  }));
}
