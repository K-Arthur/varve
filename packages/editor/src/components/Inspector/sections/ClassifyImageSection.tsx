/**
 * ClassifyImageSection — "Auto-Tag Image": classifies a photo's content
 * (subject, scene, object type) across 1000 ImageNet categories for
 * automatic tagging and organization.
 */
import {
  type ClassificationResult,
  decodeEfficientNetOutput,
  getInferenceWorkerHost,
  getModelLoader,
} from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeSrc, isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

const MODEL_ID = 'efficientnet-lite4';

interface ClassifyState {
  status: 'idle' | 'downloading' | 'classifying' | 'error';
  errorMessage: string | null;
  results: ClassificationResult[] | null;
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

export function ClassifyImageSection({ nodes }: { nodes: SceneNode[] }) {
  const { announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const [classify, setClassify] = useState<ClassifyState>({
    status: 'idle',
    errorMessage: null,
    results: null,
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
        setClassify((prev) => ({ ...prev, modelAvailable: available }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  useEffect(() => {
    setClassify((prev) => ({ ...prev, results: null }));
  }, []);

  const handleDownload = useCallback(async () => {
    setClassify((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
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
      setClassify((prev) => ({ ...prev, status: 'idle', modelAvailable: true }));
      announce('Auto-tag model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setClassify((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setClassify((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleClassify = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setClassify((prev) => ({ ...prev, status: 'classifying', errorMessage: null }));

    try {
      if (!imageSrc) throw new Error('No image selected');
      const fullData = await loadImageToImageData(imageSrc);
      if (controller.signal.aborted) throw new Error('cancelled');

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(MODEL_ID, controller.signal);
      if (!modelPath) throw new Error('Auto-tag model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'efficientnet',
          modelPath,
          modelId: MODEL_ID,
          imageData: fullData,
          reuseSession: true,
        },
        { signal: controller.signal, timeoutMs: 30_000 },
      );

      if (controller.signal.aborted) throw new Error('cancelled');

      // Verified real output tensor name (see efficientnet.ts): "Softmax:0".
      const rawOutputs = result.outputs as {
        'Softmax:0': { data: Float32Array; dims: number[] };
      };
      const output = rawOutputs['Softmax:0'];
      if (!output) throw new Error('Classification did not produce an output tensor');

      const results = decodeEfficientNetOutput(output.data, 5);
      setClassify((prev) => ({ ...prev, status: 'idle', results }));
      announce(`Top match: ${results[0]?.label ?? 'unknown'}`);
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Classification failed';
      setClassify((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [imageSrc, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setClassify((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  if (!isImage || !typedNode) return null;

  const isProcessing = classify.status === 'classifying';
  const needsDownload = !classify.modelAvailable && classify.status !== 'downloading';

  return (
    <DisclosureSection title="Auto-Tag Image" sectionId="classify-image">
      <div className="insp-field-group">
        <p className="insp-hint">
          Identifies what's in this photo across 1000 everyday categories — useful for automatic
          tagging and organization. Runs locally in a web worker.
        </p>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download auto-tag model (~50 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~50 MB download. Stored locally on this device.
            </p>
          </div>
        )}

        {classify.status === 'downloading' && (
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

        {classify.results && (
          <section className="insp-nested-panel" aria-label="Tag suggestions">
            <p className="insp-subsection__label">Suggested tags</p>
            <ul className="insp-tag-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {classify.results.map((r) => (
                <li
                  key={r.classId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 0',
                  }}
                >
                  <span>{r.label}</span>
                  <span className="insp-hint">{Math.round(r.confidence * 100)}%</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="insp-actions">
          {isProcessing ? (
            <>
              <span className="insp-hint" aria-live="polite">
                Classifying…
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
              onClick={handleClassify}
              aria-label="Classify image content"
            >
              Identify Content
            </Button>
          )}
        </div>

        {classify.status === 'error' && classify.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {classify.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
