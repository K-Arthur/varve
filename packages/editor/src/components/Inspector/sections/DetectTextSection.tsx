/**
 * DetectTextSection — "Detect Text Regions": highlights where text appears
 * in an image, useful for redaction workflows, accessibility review, and
 * as a first stage toward full OCR. Detection only — no text recognition.
 */
import {
  decodeTextRegions,
  getInferenceWorkerHost,
  getModelLoader,
  padToStride,
} from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { pickSoleOutputTensor } from '../../../inferenceOutputs';
import { DisclosureSection } from '../controls/DisclosureSection';

const MODEL_ID = 'paddleocr-det-v4';

interface DetectState {
  status: 'idle' | 'downloading' | 'detecting' | 'error';
  errorMessage: string | null;
  regionCount: number | null;
  previewDataUrl: string | null;
}

function loadImageToImageData(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

export function DetectTextSection({ nodes }: { nodes: SceneNode[] }) {
  const { announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [modelAvailable, setModelAvailable] = useState(false);

  const [detect, setDetect] = useState<DetectState>({
    status: 'idle',
    errorMessage: null,
    regionCount: null,
    previewDataUrl: null,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@strata/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      const available = await getModelLoader().isModelAvailable(MODEL_ID);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const handleDownload = useCallback(async () => {
    setDetect((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setDetect((prev) => ({ ...prev, status: 'idle' }));
      setModelAvailable(true);
      announce('Text detection model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setDetect((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setDetect((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleDetect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDetect((prev) => ({ ...prev, status: 'detecting', errorMessage: null }));

    try {
      if (!imageSrc) throw new Error('No image selected');
      const fullData = await loadImageToImageData(imageSrc);
      if (controller.signal.aborted) throw new Error('cancelled');

      // The detector is fully convolutional (dynamic H/W) but its stride-32
      // downsampling needs input dimensions padded to a multiple of 32 for
      // correct upsampling back to full resolution (see paddleocr.ts).
      const paddedW = padToStride(fullData.width);
      const paddedH = padToStride(fullData.height);
      const padCanvas = new OffscreenCanvas(paddedW, paddedH);
      const padCtx = padCanvas.getContext('2d');
      if (!padCtx) throw new Error('Canvas unavailable');
      padCtx.putImageData(fullData, 0, 0);
      const paddedData = padCtx.getImageData(0, 0, paddedW, paddedH);

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(MODEL_ID, controller.signal);
      if (!modelPath) throw new Error('Text detection model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'paddleocr-det',
          modelPath,
          modelId: MODEL_ID,
          imageData: paddedData,
          reuseSession: true,
        },
        { signal: controller.signal, timeoutMs: 45_000 },
      );

      if (controller.signal.aborted) throw new Error('cancelled');

      const output = pickSoleOutputTensor(result.outputs as Record<string, unknown>);
      if (!output) throw new Error('Detection did not produce an output tensor');
      const mapH = output.dims[2] as number;
      const mapW = output.dims[3] as number;

      const regions = decodeTextRegions(output.data, mapW, mapH, fullData.width, fullData.height);

      const canvas = document.createElement('canvas');
      canvas.width = fullData.width;
      canvas.height = fullData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(fullData, 0, 0);
      ctx.strokeStyle = '#ffd60a';
      ctx.lineWidth = Math.max(2, Math.round(fullData.width / 400));
      ctx.fillStyle = 'rgba(255, 214, 10, 0.18)';
      for (const region of regions) {
        ctx.fillRect(region.x, region.y, region.width, region.height);
        ctx.strokeRect(region.x, region.y, region.width, region.height);
      }

      setDetect({
        status: 'idle',
        errorMessage: null,
        regionCount: regions.length,
        previewDataUrl: canvas.toDataURL('image/png'),
      });
      announce(
        regions.length === 1 ? 'Found 1 text region' : `Found ${regions.length} text regions`,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Text detection failed';
      setDetect((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [imageSrc, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setDetect((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  const handleDismissPreview = useCallback(() => {
    setDetect((prev) => ({ ...prev, previewDataUrl: null, regionCount: null }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = detect.status === 'detecting';
  const needsDownload = !modelAvailable && detect.status !== 'downloading';

  return (
    <DisclosureSection title="Detect Text Regions" sectionId="detect-text">
      <div className="insp-field-group">
        <p className="insp-hint">
          Highlights where text appears in this image — useful for redaction and accessibility
          review. Detection only (no text recognition yet). Runs locally in a web worker.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download text detection model (~4.5 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~4.5 MB download. Stored locally on this device.
            </p>
          </div>
        )}

        {detect.status === 'downloading' && (
          <div className="insp-actions">
            <div
              className="insp-progress-bar"
              role="progressbar"
              aria-valuenow={downloadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="insp-progress-bar__fill" style={{ width: `${downloadProgress}%` }} />
            </div>
            <p className="insp-hint" aria-live="polite">
              Downloading… {downloadProgress}%
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
              Cancel
            </Button>
          </div>
        )}

        {detect.previewDataUrl && (
          <section className="insp-nested-panel" aria-label="Detected text regions">
            <p className="insp-subsection__label">
              {detect.regionCount === 1
                ? '1 text region found'
                : `${detect.regionCount ?? 0} text regions found`}
            </p>
            <img
              src={detect.previewDataUrl}
              alt="Detected text regions highlighted"
              style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'contain' }}
            />
            <div className="insp-actions">
              <Button type="button" variant="ghost" size="sm" onClick={handleDismissPreview}>
                Dismiss
              </Button>
            </div>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                Detecting text…
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={needsDownload}
              onClick={handleDetect}
              aria-label="Detect text regions in image"
            >
              Detect Text
            </Button>
          )}
        </div>

        {detect.status === 'error' && detect.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {detect.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
