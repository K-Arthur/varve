/**
 * ImageCropSection — crop, trim, expand, and reset controls for image nodes.
 *
 * Appears when a single ShapeNode with an image fill is selected.
 * Provides: Edit Crop, fit mode, trim to subject, expand bounds, and reset.
 *
 * Research basis: Figma image crop inspector, Sketch image trimming,
 * Canva background removal bounds.
 */
import { decodeDetrOutput, getInferenceWorkerHost, getModelLoader } from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape } from '@varve/scene';
import { Button, Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../../context';
import type { TrimToSubjectOptions } from '../../../imageCrop';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';
import type { SectionId } from '../sectionRegistry';

const DETR_MODEL_ID = 'detr-resnet-50';
const YU_NET_MODEL_ID = 'yunet-face-detect';

const TRIM_SOURCE_OPTIONS = [
  { value: 'mask', label: 'Mask' },
  { value: 'alpha', label: 'Alpha' },
  { value: 'combined', label: 'Combined' },
] as const;

interface ImageCropSectionProps {
  nodes: SceneNode[];
  sectionId?: SectionId;
}

export function ImageCropSection({ nodes, sectionId }: ImageCropSectionProps) {
  const {
    trimToSubject,
    expandImageBounds,
    convertToCropAndExpand,
    resetImageBounds,
    applyFaceAwareCrop,
  } = useEditor();
  const node = nodes[0];

  if (!node || nodes.length !== 1 || !isImageShape(node)) return null;
  const shapeNode = node as ShapeNode;
  const imageFill = getImageFill(shapeNode);
  if (!imageFill?.image) return null;
  const img = imageFill.image;

  const hasMask = Boolean(shapeNode.mask?.rasterMask);
  const isCropMode = img.fit === 'crop';

  return (
    <DisclosureSection title="Crop & Bounds" sectionId={sectionId} defaultExpanded>
      <div className="insp-field-group">
        {/* Trim to Subject */}
        <TrimControls
          hasMask={hasMask}
          trimToSubject={trimToSubject}
          imageSrc={img.src}
          fillX={img.x}
          fillY={img.y}
          fillScale={img.scale ?? 1}
        />

        {/* Protect Faces */}
        <FaceCropControls applyFaceAwareCrop={applyFaceAwareCrop} />

        {/* Expand Bounds */}
        <ExpandControls
          isCropMode={isCropMode}
          expandImageBounds={expandImageBounds}
          convertToCropAndExpand={convertToCropAndExpand}
        />

        {/* Reset */}
        <div className="insp-crop-section__reset-group">
          <Tooltip label="Reset to source image dimensions">
            <button type="button" className="insp-btn-sm" onClick={() => resetImageBounds()}>
              <Icon name="RotateCcw" size="0.85em" />
              <span>Reset Bounds</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </DisclosureSection>
  );
}

// ---------------------------------------------------------------------------
// Trim sub-component
// ---------------------------------------------------------------------------

function TrimControls({
  hasMask,
  trimToSubject,
  imageSrc,
  fillX,
  fillY,
  fillScale,
}: {
  hasMask: boolean;
  trimToSubject: (padding?: number, options?: TrimToSubjectOptions) => Promise<void>;
  imageSrc: string;
  fillX: number;
  fillY: number;
  fillScale: number;
}) {
  const [padding, setPadding] = useState(0);
  const [source, setSource] = useState<'mask' | 'alpha' | 'combined'>('mask');
  const [trimming, setTrimming] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await getModelLoader().isModelAvailable(DETR_MODEL_ID);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTrim = useCallback(async () => {
    setTrimming(true);
    try {
      await trimToSubject(padding, { source });
    } finally {
      setTrimming(false);
    }
  }, [padding, source, trimToSubject]);

  const handleDetectSubject = useCallback(async () => {
    setDetecting(true);
    setDetectError(null);
    try {
      const loader = getModelLoader();
      if (!(await loader.isModelAvailable(DETR_MODEL_ID))) {
        setDownloadProgress(0);
        await loader.downloadModel(DETR_MODEL_ID, (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        });
        setModelAvailable(true);
        setDownloadProgress(null);
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageSrc;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const modelPath = await loader.getModelPath(DETR_MODEL_ID);
      if (!modelPath) throw new Error('Detect Objects model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'detr',
          modelPath,
          modelId: DETR_MODEL_ID,
          imageData,
          reuseSession: true,
        },
        { timeoutMs: 30_000 },
      );

      const rawOutputs = result.outputs as {
        logits: { data: Float32Array; dims: number[] };
        pred_boxes: { data: Float32Array; dims: number[] };
        letterbox?: { offsetX: number; offsetY: number };
      };
      if (!rawOutputs.logits || !rawOutputs.pred_boxes) {
        throw new Error('Detection did not produce output tensors');
      }

      const detections = decodeDetrOutput(
        rawOutputs.logits.data,
        rawOutputs.pred_boxes.data,
        imageData.width,
        imageData.height,
        rawOutputs.letterbox,
      );
      const best = detections[0];
      if (!best) {
        setDetectError('No subject detected in this image.');
        return;
      }

      // DETR's box is in source-image pixel space; convert to node-local
      // space through the same fill offset/scale used for raster mask
      // bounds (see computeVisibleContentBounds's raster-alpha branch).
      await trimToSubject(padding, {
        explicitBounds: {
          x: fillX + best.box.x * fillScale,
          y: fillY + best.box.y * fillScale,
          w: best.box.width * fillScale,
          h: best.box.height * fillScale,
        },
      });
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setDetecting(false);
      setDownloadProgress(null);
    }
  }, [imageSrc, fillX, fillY, fillScale, padding, trimToSubject]);

  return (
    <DisclosureSection title="Trim to Subject" defaultExpanded={false}>
      <div className="insp-field-group">
        {hasMask && (
          <FieldRow label="Source">
            <SegmentedControl
              label="Trim source"
              options={[...TRIM_SOURCE_OPTIONS]}
              value={source}
              onChange={(v) => setSource(v as typeof source)}
            />
          </FieldRow>
        )}
        <FieldRow label="Padding">
          <NumberField
            label="Trim padding"
            value={padding}
            min={0}
            max={1000}
            step={1}
            onChange={setPadding}
            unit="px"
          />
        </FieldRow>
        {!hasMask && (
          <div className="insp-field-group">
            <p className="insp-hint">
              No selection mask yet — detect the main subject automatically instead
              {modelAvailable ? '' : ' (downloads a small ~41 MB AI model on first use)'}.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDetectSubject}
                loading={detecting}
                disabled={detecting}
                aria-label="Detect subject automatically and trim to it"
              >
                Detect Subject Automatically
              </Button>
            </div>
            {downloadProgress !== null && (
              <p className="insp-hint" aria-live="polite">
                Downloading model… {downloadProgress}%
              </p>
            )}
            {detectError && (
              <p className="insp-hint insp-hint--error" role="alert">
                {detectError}
              </p>
            )}
          </div>
        )}
        <div className="insp-crop-section__trim-actions">
          <Tooltip label="Trim to subject">
            <button
              type="button"
              className="insp-btn-sm"
              onClick={handleTrim}
              disabled={trimming || !hasMask}
            >
              <Icon name="Scissors" size="0.85em" />
              <span>{trimming ? 'Trimming...' : 'Trim to Subject'}</span>
            </button>
          </Tooltip>
        </div>
      </div>
    </DisclosureSection>
  );
}

// ---------------------------------------------------------------------------
// Protect Faces sub-component
// ---------------------------------------------------------------------------

function FaceCropControls({
  applyFaceAwareCrop,
}: {
  applyFaceAwareCrop: (options?: {
    safetyMargin?: number;
    minimumConfidence?: number;
  }) => Promise<boolean>;
}) {
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const available = await getModelLoader().isModelAvailable(YU_NET_MODEL_ID);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleProtectFaces = useCallback(async () => {
    setDetecting(true);
    setDetectError(null);
    try {
      const loader = getModelLoader();
      if (!(await loader.isModelAvailable(YU_NET_MODEL_ID))) {
        setDownloadProgress(0);
        await loader.downloadModel(YU_NET_MODEL_ID, (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        });
        setModelAvailable(true);
        setDownloadProgress(null);
      }
      const applied = await applyFaceAwareCrop({ safetyMargin: 0.35 });
      if (!applied) {
        setDetectError('No faces detected in this image.');
      }
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'Face detection failed');
    } finally {
      setDetecting(false);
      setDownloadProgress(null);
    }
  }, [applyFaceAwareCrop]);

  return (
    <DisclosureSection title="Protect Faces" defaultExpanded={false}>
      <div className="insp-field-group">
        <p className="insp-hint">
          Reposition the crop window to keep faces in frame
          {modelAvailable ? '' : ' (downloads a small ~233 KB AI model on first use)'}.
        </p>
        <div className="insp-actions">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleProtectFaces}
            loading={detecting}
            disabled={detecting}
            aria-label="Detect faces and reposition the crop to keep them in frame"
          >
            Protect Faces
          </Button>
        </div>
        {downloadProgress !== null && (
          <p className="insp-hint" aria-live="polite">
            Downloading model… {downloadProgress}%
          </p>
        )}
        {detectError && (
          <p className="insp-hint insp-hint--error" role="alert">
            {detectError}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}

// ---------------------------------------------------------------------------
// Expand sub-component
// ---------------------------------------------------------------------------

function ExpandControls({
  isCropMode,
  expandImageBounds,
  convertToCropAndExpand,
}: {
  isCropMode: boolean;
  expandImageBounds: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
  convertToCropAndExpand?: (
    padding: number,
    sides?: { top?: number; right?: number; bottom?: number; left?: number },
  ) => void;
}) {
  const [padding, setPadding] = useState(20);
  const [fromCenter, setFromCenter] = useState(false);

  const sides = fromCenter
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : undefined;

  const handleExpand = useCallback(() => {
    expandImageBounds(padding, sides);
  }, [padding, sides, expandImageBounds]);

  const handleConvertAndExpand = useCallback(() => {
    convertToCropAndExpand?.(padding, sides);
  }, [padding, sides, convertToCropAndExpand]);

  return (
    <DisclosureSection title="Expand Bounds" defaultExpanded={false}>
      <div className="insp-field-group">
        <FieldRow label="Padding">
          <NumberField
            label="Expand padding"
            value={padding}
            min={0}
            max={1000}
            step={1}
            onChange={setPadding}
            unit="px"
          />
        </FieldRow>
        <FieldRow label="From Center">
          <input
            type="checkbox"
            checked={fromCenter}
            onChange={(e) => setFromCenter(e.target.checked)}
            aria-label="Expand from center"
          />
        </FieldRow>
        <div className="insp-crop-section__expand-actions">
          {isCropMode ? (
            <Tooltip label="Expand bounds with transparent padding">
              <button type="button" className="insp-btn-sm" onClick={handleExpand}>
                <Icon name="Maximize2" size="0.85em" />
                <span>Expand Bounds</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="Convert to Crop mode and expand bounds">
              <button type="button" className="insp-btn-sm" onClick={handleConvertAndExpand}>
                <Icon name="Maximize2" size="0.85em" />
                <span>Convert to Crop &amp; Expand</span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </DisclosureSection>
  );
}
