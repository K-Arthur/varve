/**
 * AIDenoiseSection — SCUNet-based image denoising in the Properties panel.
 *
 * Uses the generic inference worker to run SCUNet ONNX inference.
 * Model is ~18MB and NOT bundled — first use triggers a download flow.
 *
 * Flow:
 *   Select image node → adjust strength slider → Preview (at 512×512)
 *   → review denoised preview → adjust → Apply (full-resolution result)
 */
import type { SceneNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

const MODEL_ID = 'scunet';

interface DenoiseState {
  status: 'idle' | 'downloading' | 'previewing' | 'applying' | 'error';
  errorMessage: string | null;
  previewDataUrl: string | null;
  elapsedMs: number;
  modelAvailable: boolean;
  modelDownloading: boolean;
}

export function AIDenoiseSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const strengthId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const elapsedRef = useRef<number | null>(null);

  const [strength, setStrength] = useState(0.7);
  const [denoise, setDenoise] = useState<DenoiseState>({
    status: 'idle',
    errorMessage: null,
    previewDataUrl: null,
    elapsedMs: 0,
    modelAvailable: false,
    modelDownloading: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  // Check model availability on mount
  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      try {
        const { getModelLoader } = await import('@varve/engine');
        const loader = getModelLoader();
        const available = await loader.isModelAvailable(MODEL_ID);
        if (!cancelled) {
          setDenoise((prev) => ({ ...prev, modelAvailable: available }));
        }
      } catch {
        if (!cancelled) {
          setDenoise((prev) => ({ ...prev, modelAvailable: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  // Elapsed timer during processing
  useEffect(() => {
    if (
      denoise.status === 'previewing' ||
      denoise.status === 'applying' ||
      denoise.status === 'downloading'
    ) {
      setDenoise((prev) => ({ ...prev, elapsedMs: 0 }));
      const start = Date.now();
      elapsedRef.current = window.setInterval(() => {
        setDenoise((prev) => ({ ...prev, elapsedMs: Date.now() - start }));
      }, 250);
    } else if (elapsedRef.current !== null) {
      clearInterval(elapsedRef.current);
      elapsedRef.current = null;
    }
    return () => {
      if (elapsedRef.current !== null) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [denoise.status]);

  const resetState = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDenoise((prev) => ({
      status: 'idle',
      errorMessage: null,
      previewDataUrl: null,
      elapsedMs: 0,
      modelAvailable: prev.modelAvailable,
      modelDownloading: false,
    }));
  }, []);

  /**
   * Load image from cache as full-size ImageData.
   */
  const loadImageData = useCallback(async (src: string): Promise<ImageData> => {
    const { cachedImageDims, getImageCache } = await import('@varve/engine');
    const img = await getImageCache().load(src);
    const { width: w, height: h } = cachedImageDims(img);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h);
  }, []);

  /**
   * Run SCUNet inference via dispatchDenoise.
   * Handles preprocessing, inference, and postprocessing (including
   * alpha preservation and strength blending).
   */
  const runDenoise = useCallback(
    async (fullData: ImageData): Promise<ImageData> => {
      const { dispatchDenoise } = await import('@varve/engine');
      const result = await dispatchDenoise(fullData, {
        strength,
        modelId: MODEL_ID,
        signal: abortRef.current?.signal,
      });
      return result.denoised;
    },
    [strength],
  );

  const handleDownload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDenoise((prev) => ({
      ...prev,
      status: 'downloading',
      errorMessage: null,
      modelDownloading: true,
      elapsedMs: 0,
    }));

    try {
      const { getModelLoader } = await import('@varve/engine');
      const loader = getModelLoader();
      await loader.downloadModel(MODEL_ID, () => {}, controller.signal);

      setDenoise((prev) => ({
        ...prev,
        status: 'idle',
        modelAvailable: true,
        modelDownloading: false,
        elapsedMs: 0,
      }));
      announce('SCUNet denoise model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setDenoise((prev) => ({
          ...prev,
          status: 'idle',
          modelDownloading: false,
          errorMessage: null,
        }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setDenoise((prev) => ({
        ...prev,
        status: 'error',
        errorMessage: message,
        modelDownloading: false,
      }));
    }
  }, [announce]);

  const handlePreview = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDenoise((prev) => ({
      ...prev,
      status: 'previewing',
      errorMessage: null,
      previewDataUrl: null,
      elapsedMs: 0,
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted) return;
      const denoised = await runDenoise(fullData);
      if (controller.signal.aborted) return;

      // Render preview at a reasonable size (max 512px on longest edge)
      const maxPreviewDim = 512;
      let previewW = denoised.width;
      let previewH = denoised.height;
      if (Math.max(previewW, previewH) > maxPreviewDim) {
        const s = maxPreviewDim / Math.max(previewW, previewH);
        previewW = Math.round(previewW * s);
        previewH = Math.round(previewH * s);
      }

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = previewW;
      previewCanvas.height = previewH;
      const ctx = previewCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');

      // Draw denoised at preview size
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = denoised.width;
      tmpCanvas.height = denoised.height;
      const tmpCtx = tmpCanvas.getContext('2d');
      if (!tmpCtx) throw new Error('Canvas unavailable');
      tmpCtx.putImageData(denoised, 0, 0);
      ctx.drawImage(tmpCanvas, 0, 0, previewW, previewH);

      const dataUrl = previewCanvas.toDataURL('image/png');
      setDenoise((prev) => ({
        ...prev,
        status: 'idle',
        previewDataUrl: dataUrl,
        elapsedMs: 0,
      }));
      announce('Denoise preview ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Preview failed';
      setDenoise((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [imageSrc, loadImageData, runDenoise, announce]);

  const handleApply = useCallback(async () => {
    if (!imageSrc) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDenoise((prev) => ({
      ...prev,
      status: 'applying',
      errorMessage: null,
      elapsedMs: 0,
    }));

    try {
      const fullData = await loadImageData(imageSrc);
      if (controller.signal.aborted) return;
      const denoised = await runDenoise(fullData);
      if (controller.signal.aborted) return;

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = denoised.width;
      outputCanvas.height = denoised.height;
      const outputCtx = outputCanvas.getContext('2d');
      if (!outputCtx) throw new Error('Canvas 2D context unavailable');
      outputCtx.putImageData(denoised, 0, 0);
      const dataUrl = outputCanvas.toDataURL('image/png');

      const { insertDerivedImageShape } = await import('../../../imageOperations');
      const currentDoc = state.document;
      const sourceId = state.selection[0];
      if (!sourceId) throw new Error('No selection');
      const sourceNode = currentDoc.nodes[sourceId];
      if (!sourceNode) throw new Error('Source node no longer exists');

      const inserted = insertDerivedImageShape(currentDoc, sourceId, {
        dataUrl,
        width: denoised.width,
        height: denoised.height,
        suffix: `denoised-${Math.round(strength * 100)}`,
      });
      updateDoc(() => inserted.doc);
      announce(
        `Denoised image created (${denoised.width} x ${denoised.height}, strength ${Math.round(strength * 100)}%)`,
      );
      resetState();
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Apply failed';
      setDenoise((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [
    imageSrc,
    loadImageData,
    runDenoise,
    strength,
    state.document,
    state.selection,
    updateDoc,
    announce,
    resetState,
  ]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDenoise((prev) => ({ ...prev, status: 'idle', elapsedMs: 0 }));
  }, []);

  const handleDismissPreview = useCallback(() => {
    setDenoise((prev) => ({ ...prev, previewDataUrl: null, status: 'idle' }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = denoise.status === 'previewing' || denoise.status === 'applying';
  const showPreview = denoise.previewDataUrl != null;
  const needsDownload = !denoise.modelAvailable && !denoise.modelDownloading;

  return (
    <DisclosureSection title="AI Denoise" sectionId="ai-denoise">
      <div className="insp-field-group">
        <p className="insp-hint">
          SCUNet neural denoising removes real-world noise, JPEG artifacts, and sensor grain while
          preserving detail. Runs locally in a web worker.
        </p>

        <FieldRow label="Strength" htmlFor={strengthId}>
          <input
            id={strengthId}
            type="range"
            className="insp-range"
            min={0}
            max={1}
            step={0.05}
            value={strength}
            disabled={isProcessing}
            aria-label="Denoise strength"
            onChange={(e) => setStrength(Number(e.target.value))}
          />
          <output htmlFor={strengthId}>{Math.round(strength * 100)}%</output>
        </FieldRow>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={denoise.status === 'downloading'}
              loading={denoise.status === 'downloading'}
              onClick={handleDownload}
              aria-label="Download SCUNet denoise model (~18 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~18 MB download. Model is stored locally on this device.
            </p>
          </div>
        )}

        {denoise.status === 'downloading' && (
          <p className="insp-hint" role="status" aria-live="polite">
            Downloading SCUNet model… {Math.round(denoise.elapsedMs / 1000)}s
          </p>
        )}

        {showPreview && (
          <section className="insp-nested-panel" aria-label="Denoise preview">
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
                src={denoise.previewDataUrl ?? undefined}
                alt="Denoised preview"
                style={{
                  display: 'block',
                  width: '100%',
                  maxHeight: 180,
                  objectFit: 'contain',
                }}
              />
            </div>
            <p className="insp-hint" role="status">
              Preview generated. Adjust strength and Preview again, or Apply for the full-resolution
              result.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing}
                loading={denoise.status === 'applying'}
                aria-label="Apply denoised result at full resolution"
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
                {denoise.status === 'previewing' ? 'Generating preview…' : 'Applying denoise…'}{' '}
                {Math.round(denoise.elapsedMs / 1000)}s
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                aria-label="Cancel denoising"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={needsDownload || denoise.modelDownloading}
                onClick={handlePreview}
                aria-label="Generate denoise preview"
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={needsDownload || denoise.modelDownloading || !showPreview}
                onClick={handleApply}
                aria-label="Apply denoising at full resolution"
              >
                Apply Full
              </Button>
            </>
          )}
        </div>

        {denoise.status === 'error' && denoise.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {denoise.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
