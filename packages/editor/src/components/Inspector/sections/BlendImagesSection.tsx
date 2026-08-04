/**
 * BlendImagesSection — "Blend Images": generates a new in-between image
 * from the selected image and a second image you pick, using RIFE frame
 * interpolation.
 *
 * Scoped as a standalone two-image blend tool rather than a Motion-mode
 * "keyframe" feature: Strata's Motion mode keyframes are numeric property
 * tweens (opacity, rotation, position), not raster frames — there is no
 * "sequence of bitmap frames" concept anywhere in the scene model for RIFE
 * to plug into. This is an honest scoping of what RIFE actually does
 * (blend two real bitmaps) rather than a forced Motion-mode tie-in.
 */
import { decodeRifeOutput, getInferenceWorkerHost, getModelLoader } from '@varve/engine';
import type { NodeId, SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { pickSoleOutputTensor } from '../../../inferenceOutputs';
import { DisclosureSection } from '../controls/DisclosureSection';

const MODEL_ID = 'rife-frame-interpolation';

interface BlendState {
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

export function BlendImagesSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, updateDoc, announce } = useEditor();
  const node = nodes[0];
  const abortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [secondNodeId, setSecondNodeId] = useState<NodeId | ''>('');

  const [blend, setBlend] = useState<BlendState>({
    status: 'idle',
    errorMessage: null,
    previewDataUrl: null,
    modelAvailable: false,
  });

  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  const otherImages = useMemo(() => {
    if (!node) return [];
    const results: Array<{ nodeId: NodeId; name: string }> = [];
    for (const [id, candidate] of Object.entries(state.document.nodes)) {
      if (id === node.id) continue;
      if (candidate.kind !== 'shape' || !isImageShape(candidate)) continue;
      results.push({ nodeId: id as NodeId, name: candidate.name || id });
    }
    return results;
  }, [state.document.nodes, node]);

  useEffect(() => {
    if (otherImages.length > 0 && !otherImages.some((o) => o.nodeId === secondNodeId)) {
      setSecondNodeId(otherImages[0]!.nodeId);
    } else if (otherImages.length === 0) {
      setSecondNodeId('');
    }
  }, [otherImages, secondNodeId]);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    (async () => {
      const available = await getModelLoader().isModelAvailable(MODEL_ID);
      if (!cancelled) {
        setBlend((prev) => ({ ...prev, modelAvailable: available }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isImage]);

  const handleDownload = useCallback(async () => {
    setBlend((prev) => ({ ...prev, status: 'downloading', errorMessage: null }));
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
      setBlend((prev) => ({ ...prev, status: 'idle', modelAvailable: true }));
      announce('Blend Images model downloaded');
    } catch (err) {
      if (controller.signal.aborted) {
        setBlend((prev) => ({ ...prev, status: 'idle' }));
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      setBlend((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    } finally {
      downloadAbortRef.current = null;
    }
  }, [announce]);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const runBlend = useCallback(
    async (
      signal: AbortSignal,
    ): Promise<{ imageData: ImageData; width: number; height: number }> => {
      if (!imageSrc) throw new Error('No image selected');
      if (!secondNodeId) throw new Error('Pick a second image to blend with');
      const secondNode = state.document.nodes[secondNodeId];
      if (secondNode?.kind !== 'shape') throw new Error('Second image no longer exists');
      const secondSrc = imageShapeSrc(secondNode as ShapeNode);
      if (!secondSrc) throw new Error('Second image has no source');

      const [fullData, secondData] = await Promise.all([
        loadImageToImageData(imageSrc),
        loadImageToImageData(secondSrc),
      ]);
      if (signal.aborted) throw new Error('cancelled');

      const loader = getModelLoader();
      const modelPath = await loader.getModelPath(MODEL_ID, signal);
      if (!modelPath) throw new Error('Blend Images model not downloaded');

      const host = getInferenceWorkerHost();
      const result = await host.infer(
        {
          type: 'infer',
          modelType: 'rife',
          modelPath,
          modelId: MODEL_ID,
          imageData: fullData,
          auxImageData: secondData,
          reuseSession: true,
        },
        { signal, timeoutMs: 60_000 },
      );

      if (signal.aborted) throw new Error('cancelled');

      const output = pickSoleOutputTensor(result.outputs as Record<string, unknown>);
      if (!output) throw new Error('Blend inference did not produce an output tensor');
      const outputH = output.dims[2] as number;
      const outputW = output.dims[3] as number;

      const decoded = decodeRifeOutput(
        output.data,
        outputW,
        outputH,
        fullData.width,
        fullData.height,
      );
      return { imageData: decoded, width: fullData.width, height: fullData.height };
    },
    [imageSrc, secondNodeId, state.document.nodes],
  );

  const handleGenerate = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBlend((prev) => ({ ...prev, status: 'generating', errorMessage: null }));

    try {
      const { imageData } = await runBlend(controller.signal);
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      setBlend((prev) => ({ ...prev, status: 'idle', previewDataUrl: dataUrl }));
      announce('Blend preview ready');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Blend generation failed';
      setBlend((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runBlend, announce]);

  const handleApply = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBlend((prev) => ({ ...prev, status: 'applying', errorMessage: null }));

    try {
      const { imageData, width, height } = await runBlend(controller.signal);
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
        suffix: 'blended',
      });
      updateDoc(() => inserted.doc);
      announce(`Blended image created (${width} x ${height})`);
      setBlend((prev) => ({ ...prev, status: 'idle', previewDataUrl: null }));
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : 'Apply failed';
      setBlend((prev) => ({ ...prev, status: 'error', errorMessage: message }));
    }
  }, [runBlend, state.document, state.selection, updateDoc, announce]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setBlend((prev) => ({ ...prev, status: 'idle' }));
  }, []);

  const handleDismissPreview = useCallback(() => {
    setBlend((prev) => ({ ...prev, previewDataUrl: null }));
  }, []);

  if (!isImage || !typedNode) return null;
  if (otherImages.length === 0) return null;

  const isProcessing = blend.status === 'generating' || blend.status === 'applying';
  const showPreview = blend.previewDataUrl != null;
  const needsDownload = !blend.modelAvailable && blend.status !== 'downloading';

  return (
    <DisclosureSection title="Blend Images" sectionId="blend-images">
      <div className="insp-field-group">
        <p className="insp-hint">
          Generates a new in-between image from this photo and another image in the document.
          Channel convention is unverified against a reference runtime — treat results as
          experimental. Runs locally in a web worker.
        </p>

        <div className="insp-field">
          <Select
            label="Blend with"
            value={secondNodeId}
            onChange={(v) => setSecondNodeId(v as NodeId)}
            placeholder="Choose image…"
            options={otherImages.map((o) => ({ value: o.nodeId, label: o.name }))}
          />
        </div>

        {needsDownload && (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDownload}
              aria-label="Download Blend Images model (~21.6 MB)"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time ~21.6 MB download. Stored locally on this device.
            </p>
          </div>
        )}

        {blend.status === 'downloading' && (
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
          <section className="insp-nested-panel" aria-label="Blend preview">
            <p className="insp-subsection__label">Preview</p>
            <img
              src={blend.previewDataUrl ?? undefined}
              alt="Blend preview"
              style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain' }}
            />
            <p className="insp-hint" role="status">
              Preview generated. Apply to create a full-resolution blended layer.
            </p>
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApply}
                disabled={isProcessing}
                loading={blend.status === 'applying'}
                aria-label="Apply blend at full resolution"
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
                {blend.status === 'generating' ? 'Blending…' : 'Applying…'}
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
              disabled={needsDownload || !secondNodeId}
              onClick={handleGenerate}
              aria-label="Generate blended image preview"
            >
              Blend
            </Button>
          )}
        </div>

        {blend.status === 'error' && blend.errorMessage && (
          <p className="insp-hint insp-hint--error" role="alert">
            {blend.errorMessage}
          </p>
        )}
      </div>
    </DisclosureSection>
  );
}
