/**
 * LineArtSection — converts a photo into a clean line drawing, a starting
 * point for tracing in Draw mode.
 *
 * Uses the generic inference worker to run line-art extraction. Model is
 * ~17MB and NOT bundled — first use triggers a download flow. The model's
 * fixed 256x256 input means fine detail from very large source photos is
 * lost; output is upscaled back to the source resolution afterward.
 */
import { decodeLineArtOutput, getInferenceWorkerHost, getModelLoader } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const MODEL_ID = 'lineart';

interface LineArtState {
  status: 'idle' | 'downloading' | 'generating' | 'applying' | 'error';
  errorMessage: string | null;
  previewDataUrl: string | null;
  modelAvailable: boolean;
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

export function LineArtSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [lineArt, setLineArt] = useState<LineArtState>({
    status: 'idle',
    errorMessage: null,
    previewDataUrl: null,
    modelAvailable: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@strata/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const available = await loader.isModelAvailable(MODEL_ID);
      if (!cancelled) {
        setLineArt((prev) => ({ ...prev, modelAvailable: available }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const handleDownload = useCallback(async () => {
    setLineArt((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
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
      setLineArt((prev) => ({ ...prev, status: 'idle', modelAvailable: true }));
      announce('Line art model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setLineArt((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setLineArt((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const runLineArt = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{ imageData: ImageData; width: number; height: number }> => {
      if (!imageSrc) throw new Error('No image selected');
      const fullData = await loadImageToImageData(imageSrc);
      if (signal.aborted) throw new Error('cancelled');

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(MODEL_ID, signal);
      if (!modelPath) throw new Error('Line art model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'lineart',
          modelPath,
          modelId: MODEL_ID,
          imageData: fullData,
          reuseSession: true,
        },
        { signal, timeoutMs: 60_000 },
      );

      if (signal.aborted) throw new Error('cancelled');

      const outputs = result.outputs as { data: Float32Array; dims: number[] };
      const outputH = outputs.dims[2] as number;
      const outputW = outputs.dims[3] as number;

      const decoded = decodeLineArtOutput(
        outputs.data,
        outputW,
        outputH,
        fullData.width,
        fullData.height,
      );
      return { imageData: decoded, width: fullData.width, height: fullData.height };
    },
    [imageSrc],
  );

  const handleGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLineArt((prev) => ({ ...prev, status: 'generating', errorMessage: null }));

    try {
      const { imageData } = await runLineArt(controller.signal);
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      setLineArt((prev) => ({ ...prev, status: 'idle', previewDataUrl: dataUrl }));
      announce('Line art preview ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Line art generation failed';
      setLineArt((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runLineArt, announce]);

  const handleApply = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLineArt((prev) => ({ ...prev, status: 'applying', errorMessage: null }));

    try {
      const { imageData, width, height } = await runLineArt(controller.signal);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      const { insertDerivedImageShape } = await import('../../../imageOperations');
      const currentDoc = state.document;
      const sourceId = state.selection[0];
      if (!sourceId) throw new Error('No selection');
      const sourceNode = currentDoc.nodes[sourceId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, sourceId, {
        dataUrl,
        width,
        height,
        suffix: 'line-art',
      });
      updateDoc(() => inserted.doc);
      announce(`Line art created (${width} x ${height})`);
      setLineArt((prev) => ({ ...prev, status: 'idle', previewDataUrl: null }));
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Apply failed';
      setLineArt((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runLineArt, state.document, state.selection, updateDoc, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setLineArt((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  const handleDismissPreview = useCallback(() => {
    setLineArt((prev) => ({ ...prev, previewDataUrl: null }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = lineArt.status === 'generating' || lineArt.status === 'applying';
  const showPreview = lineArt.previewDataUrl != null;
  const needsDownload = !lineArt.modelAvailable && lineArt.status !== 'downloading';

  return (
    <DisclosureSection title="Line Art" sectionId="line-art">
      <div className="insp-field-group">
        <p className="insp-hint">
          Converts the photo into a clean line drawing — a good starting point for tracing in Draw
          mode. Runs locally in a web worker.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download line art model (~17 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~17 MB download. Stored locally on this device.
            </p>
          </div>
        )}

        {lineArt.status === 'downloading' && (
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

        {showPreview && (
          <section className="insp-nested-panel" aria-label="Line art preview">
            <p className="insp-subsection__label">Preview</p>
            <div
              className="insp-mask-review"
              style={{
                backgroundImage:
                  'linear-gradient(45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-sunken) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-sunken) 75%)',
                backgroundSize: '16px 16px',
              }}
            >
              <img
                src={lineArt.previewDataUrl ?? undefined}
                alt="Line art preview"
                style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain' }}
              />
            </div>
            <p className="insp-hint" role="status">
              Preview generated. Apply to create a full-resolution line art layer.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing}
                loading={lineArt.status === 'applying'}
                aria-label="Apply line art at full resolution"
              >
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDismissPreview}
                disabled={isProcessing}
              >
                Remove Preview
              </Button>
            </div>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                {lineArt.status === 'generating' ? 'Generating line art…' : 'Applying…'}
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
              onClick={handleGenerate}
              aria-label="Generate line art preview"
            >
              Generate Line Art
            </Button>
          )}
        </div>

        {lineArt.status === 'error' && lineArt.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {lineArt.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
