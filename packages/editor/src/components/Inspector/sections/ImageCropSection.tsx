/**
 * ImageCropSection — trim, expand, and bounds-reset controls for image nodes.
 *
 * Appears when a single ShapeNode with an image fill is selected.
 * Crop entry and fit mode belong to ImagePlacementSection; this companion
 * section owns crop-bound operations that alter the image or its frame.
 *
 * Research basis: Figma image crop inspector, Sketch image trimming,
 * Canva background removal bounds.
 */
import {
  type DetrDetection,
  decodeDetrOutput,
  getInferenceWorkerHost,
  getModelLoader,
  rankDetrDetections,
} from '@varve/engine';
import type { Document, SceneNode, ShapeNode } from '@varve/scene';
import { getImageFill, isImageShape } from '@varve/scene';
import { Button, Icon, Switch, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { sourceBoundsToViewportCrop, type TrimToSubjectOptions } from '../../../imageCrop';
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
    state,
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
          editorDocument={state.document}
          nodeId={shapeNode.id}
          imageSrc={img.src}
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
  editorDocument,
  nodeId,
  imageSrc,
}: {
  hasMask: boolean;
  trimToSubject: (padding?: number, options?: TrimToSubjectOptions) => Promise<void>;
  editorDocument: Document;
  nodeId: string;
  imageSrc: string;
}) {
  const [padding, setPadding] = useState(0);
  const [source, setSource] = useState<'mask' | 'alpha' | 'combined'>('mask');
  const [trimming, setTrimming] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [detections, setDetections] = useState<DetrDetection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState(0);
  const [detectingSlow, setDetectingSlow] = useState(false);
  const detectAbortRef = useRef<AbortController | null>(null);
  const detectSlowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      detectAbortRef.current?.abort();
      if (detectSlowTimerRef.current !== null) clearTimeout(detectSlowTimerRef.current);
    };
  }, [imageSrc]);

  useEffect(() => {
    // A detection belongs to the exact source that was loaded. Do not leave
    // stale candidate boxes actionable after the image fill changes.
    setDetectError(null);
    setDetections([]);
    setSelectedDetection(0);
  }, [imageSrc]);

  const handleTrim = useCallback(async () => {
    setTrimming(true);
    try {
      await trimToSubject(padding, { source });
    } finally {
      setTrimming(false);
    }
  }, [padding, source, trimToSubject]);

  const handleDetectSubject = useCallback(async () => {
    detectAbortRef.current?.abort();
    const controller = new AbortController();
    detectAbortRef.current = controller;
    setDetecting(true);
    setDetectingSlow(false);
    setDetectError(null);
    setDetections([]);
    setSelectedDetection(0);
    detectSlowTimerRef.current = setTimeout(() => setDetectingSlow(true), 15_000);
    try {
      const loader = getModelLoader();
      if (!(await loader.isModelAvailable(DETR_MODEL_ID))) {
        setDownloadProgress(0);
        await loader.downloadModel(
          DETR_MODEL_ID,
          (loaded, total) => {
            setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
          },
          controller.signal,
        );
        setModelAvailable(true);
        setDownloadProgress(null);
      }
      if (controller.signal.aborted) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => controller.signal.removeEventListener('abort', onAbort);
        const onAbort = () => {
          img.onload = null;
          img.onerror = null;
          cleanup();
          reject(new Error('cancelled'));
        };
        if (controller.signal.aborted) {
          reject(new Error('cancelled'));
          return;
        }
        img.onload = () => {
          cleanup();
          resolve();
        };
        img.onerror = () => {
          cleanup();
          reject(new Error('Failed to load image'));
        };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        img.src = imageSrc;
      });
      if (controller.signal.aborted) return;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const modelPath = await loader.getModelPath(DETR_MODEL_ID, controller.signal);
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
        { signal: controller.signal },
      );

      const rawOutputs = result.outputs as {
        logits: { data: Float32Array; dims: number[] };
        pred_boxes: { data: Float32Array; dims: number[] };
        letterbox?: { offsetX: number; offsetY: number };
      };
      if (!rawOutputs.logits || !rawOutputs.pred_boxes) {
        throw new Error('Detection did not produce output tensors');
      }

      const decodedDetections = decodeDetrOutput(
        rawOutputs.logits.data,
        rawOutputs.pred_boxes.data,
        imageData.width,
        imageData.height,
        rawOutputs.letterbox,
      );
      const rankedDetections = rankDetrDetections(
        decodedDetections,
        imageData.width,
        imageData.height,
      );
      if (rankedDetections.length === 0) {
        setDetectError('No subject detected in this image.');
        return;
      }
      setDetections(rankedDetections);
    } catch (err) {
      if (!/cancelled|canceled|abort/i.test(err instanceof Error ? err.message : String(err))) {
        setDetectError(mapDetectionFailure(err));
      }
    } finally {
      setDetecting(false);
      setDetectingSlow(false);
      setDownloadProgress(null);
      if (detectSlowTimerRef.current !== null) {
        clearTimeout(detectSlowTimerRef.current);
        detectSlowTimerRef.current = null;
      }
      if (detectAbortRef.current === controller) detectAbortRef.current = null;
    }
  }, [imageSrc]);

  const handleCancelDetection = useCallback(() => {
    detectAbortRef.current?.abort();
    detectAbortRef.current = null;
    setDetecting(false);
    setDetectingSlow(false);
    setDownloadProgress(null);
    if (detectSlowTimerRef.current !== null) {
      clearTimeout(detectSlowTimerRef.current);
      detectSlowTimerRef.current = null;
    }
  }, []);

  const handleApplyDetection = useCallback(async () => {
    const detection = detections[selectedDetection];
    if (!detection) return;
    const explicitBounds = sourceBoundsToViewportCrop(editorDocument, nodeId, detection.box);
    if (!explicitBounds) {
      setDetectError('The detected object is outside the visible image placement. Try again.');
      return;
    }
    setTrimming(true);
    setDetectError(null);
    try {
      await trimToSubject(padding, { explicitBounds });
      setDetections([]);
    } catch (err) {
      setDetectError(mapDetectionFailure(err));
    } finally {
      setTrimming(false);
    }
  }, [detections, editorDocument, nodeId, padding, trimToSubject, selectedDetection]);

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
              No selection mask yet — detect object bounds automatically instead
              {modelAvailable ? '' : ' (downloads a small ~41 MB AI model on first use)'}.
            </p>
            <p className="insp-hint">
              DETR supplies a box, not a pixel mask. Review the detected bounds before applying the
              non-destructive crop.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDetectSubject}
                loading={detecting}
                disabled={detecting}
                aria-label="Detect object bounds automatically"
              >
                Detect Object Bounds
              </Button>
              {detecting && (
                <button type="button" className="insp-btn-sm" onClick={handleCancelDetection}>
                  Cancel
                </button>
              )}
            </div>
            {detectingSlow && (
              <p className="insp-hint" role="status" aria-live="polite">
                Taking longer than expected on this device. You can cancel safely; nothing has been
                changed.
              </p>
            )}
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
            {detections.length > 0 && (
              <fieldset className="insp-field-group">
                <legend className="sr-only">Detected object bounds</legend>
                <p className="insp-hint" aria-live="polite">
                  {detections.length === 1
                    ? `Detected ${detections[0]!.label} (${Math.round(detections[0]!.confidence * 100)}% confidence).`
                    : `${detections.length} objects detected — choose the bounds to use.`}
                </p>
                {detections.length > 1 && (
                  <fieldset className="insp-actions">
                    <legend className="sr-only">Detected objects</legend>
                    {detections.map((detection, index) => (
                      <button
                        type="button"
                        className="insp-btn-sm"
                        key={`${detection.label}-${detection.box.x}-${detection.box.y}-${detection.box.width}-${detection.box.height}-${detection.confidence}`}
                        aria-pressed={selectedDetection === index}
                        onClick={() => setSelectedDetection(index)}
                      >
                        {index + 1}. {detection.label} · {Math.round(detection.confidence * 100)}%
                      </button>
                    ))}
                  </fieldset>
                )}
                <div className="insp-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleApplyDetection}
                    loading={trimming}
                    disabled={trimming}
                  >
                    Apply Detected Bounds
                  </Button>
                  <button
                    type="button"
                    className="insp-btn-sm"
                    onClick={() => setDetections([])}
                    disabled={trimming}
                  >
                    Clear
                  </button>
                </div>
              </fieldset>
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

function mapDetectionFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/memory|allocation|quota/i.test(raw)) {
    return 'Object detection needs more memory than this device can provide. Try a smaller image or the desktop app.';
  }
  if (/timed out|timeout/i.test(raw)) {
    return 'Object detection took too long to respond. Try again; the model can reuse its loaded session.';
  }
  if (/worker|runtime|onnx/i.test(raw)) {
    return 'The object-detection engine could not start. Check AI Models in Settings and try again.';
  }
  if (/not downloaded|missing model/i.test(raw)) {
    return 'The object-detection model is not installed. Download it from Settings > AI Models, then try again.';
  }
  return 'Object detection could not complete. Try again or use a selection mask instead.';
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
          <Switch
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
