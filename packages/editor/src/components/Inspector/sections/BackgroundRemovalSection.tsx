/**
 * BackgroundRemovalSection — image cutout controls in the Properties panel.
 *
 * Layout / chrome match Appearance/Fill: DisclosureSection, FieldRow,
 * insp-select, NumberField, @varve/ui Button (replacing unstyled button--*).
 *
 * Research basis: Figma generative fill panel density; APG form disclosure.
 */
import type { RemovalMethod } from '@varve/engine';
import {
  DEFAULT_PREVIEW_MAX_DIMENSION,
  getEnvironmentCapabilities,
  getModelInfo,
  getModelLoaderReady,
  isWasmModelSafe,
  workerModelIdForMethod,
} from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';
import { imageShapeSrc, isImageShape } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { removeRasterMaskFromNode } from '../../../backgroundRemoval/commitRasterMask';
import { isCapabilityRestricted } from '../../../capabilities/restrictions';
import { useEditor } from '../../../context';
import { ModelDownloadDialog } from '../../BackgroundRemoval/ModelDownloadDialog';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

function normalizeErrorMessage(e: unknown, defaultMessage: string): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message === 'cancelled' || message === 'AbortError' || message.includes('aborted')) {
    return 'Cancelled';
  }
  if (message.includes('timed out')) {
    return 'Timed out while waiting for the AI model. Switch to Quick mode or try again.';
  }
  if (message.includes('too large') || message.includes('Image too large')) {
    return 'Image too large for this AI model.';
  }
  if (message.includes('exceeds the safe WASM memory limit')) {
    return 'AI Quality model exceeds available memory without GPU acceleration. Switch to AI Balanced, or use Quick mode and manually refine the mask with the brush and trimap tools.';
  }
  if (message.includes('AI background removal failed in all quality modes')) {
    return 'AI background removal failed in every mode on this device. Use Quick mode, then manually refine the mask with the brush and trimap tools below.';
  }
  if (message.includes('Model') || message.includes('model')) {
    return `Model failed to load: ${defaultMessage}`;
  }
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

const METHOD_GUIDANCE: Record<
  RemovalMethod,
  { title: string; description: string; bestFor: string; tradeoff: string }
> = {
  quick: {
    title: 'Fast cutout',
    description: 'Instant local masking with no model download.',
    bestFor: 'Flat, studio, product, and colour-consistent backgrounds.',
    tradeoff: 'Natural scenes may need AI Balanced or a short brush cleanup.',
  },
  'ai-balanced': {
    title: 'Auto cutout',
    description: 'General-purpose subject detection with automatic low-memory fallback.',
    bestFor: 'People, pets, vehicles, products, and everyday photos.',
    tradeoff: 'Install enhanced Balanced for the strongest results on varied systems.',
  },
  'ai-quality': {
    title: 'High-quality cutout',
    description: 'BiRefNet Lite preserves difficult boundaries and fine structure.',
    bestFor: 'Hair, fur, foliage, thin objects, and visually complex scenes.',
    tradeoff: 'Uses more memory and is slower than the other modes.',
  },
};

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    state,
    applySam2Segmentation,
    cancelSam2Segmentation,
    selectSam2Candidate,
    removeBackgroundWithOptions,
    cancelBackgroundRemoval,
    applyBackgroundRemovalPreview,
    cancelBackgroundRemovalPreview,
    updateDoc,
    announce,
    setShowOriginalBg,
    setMaskPreviewMode,
    setTool,
    setRefineMaskOptions,
    refineHairEdges,
    startTrimapEdit,
    applyTrimapMatting,
    setTrimapEditOptions,
  } = useEditor();
  const node = nodes[0] as ShapeNode | undefined;
  const decontaminateId = useId();
  const hasMask = Boolean(
    node && (isImageShape(node) || node.mask?.rasterMask || node.backgroundRemoval),
  );
  const rasterMask = node?.mask?.rasterMask;
  const previewSession =
    node && state.backgroundRemovalPreviewSession?.nodeId === node.id
      ? state.backgroundRemovalPreviewSession
      : null;
  const maskProvenance = rasterMask?.provenance ?? node?.backgroundRemoval;
  const eligible = hasMask;
  const objectSelection =
    node && state.objectSelectionSession?.nodeId === node.id ? state.objectSelectionSession : null;

  const [method, setMethod] = useState<RemovalMethod>(
    (maskProvenance as { method?: RemovalMethod })?.method ?? 'quick',
  );
  const [pending, setPending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [enhancedBalancedAvailable, setEnhancedBalancedAvailable] = useState(false);
  const [maskEditorOpen, setMaskEditorOpen] = useState(
    () =>
      state.selection[0] === node?.id &&
      (state.tool === 'refineMask' || state.tool === 'trimapEdit'),
  );
  const [feather, setFeather] = useState((maskProvenance as { feather?: number })?.feather ?? 0.5);
  const [decontaminate, setDecontaminate] = useState(
    (maskProvenance as { decontaminate?: boolean })?.decontaminate ?? true,
  );
  const [modelState, setModelState] = useState<'unavailable' | 'downloading' | 'ready' | 'error'>(
    'unavailable',
  );
  const [aiAvailable, setAiAvailable] = useState(false);
  const [hasGpuAccel, setHasGpuAccel] = useState(false);
  const [wasmModelSafe, setWasmModelSafe] = useState(true);

  const showingOriginal = Boolean(node && state.showOriginalBgNodeId === node.id);
  const refiningMask = Boolean(
    node && state.tool === 'refineMask' && state.selection[0] === node.id,
  );
  const editingTrimap = Boolean(
    node && state.tool === 'trimapEdit' && state.selection[0] === node.id,
  );
  const { brushSize, hardness } = state.refineMaskOptions ?? { brushSize: 20, hardness: 0.8 };
  const trimapOpts = state.trimapEditOptions ?? {
    brushSize: 20,
    hardness: 0.8,
    penMode: 'unknown' as const,
  };

  const requiredModelId = workerModelIdForMethod(method);
  const imageMaxDim = node?.shape?.kind === 'rect' ? Math.max(node.shape.w, node.shape.h) : 0;
  const previewDownscaleActive = method !== 'quick' && imageMaxDim > DEFAULT_PREVIEW_MAX_DIMENSION;
  const methodGuidance = METHOD_GUIDANCE[method];

  const startObjectSelection = useCallback(() => {
    if (!node) return;
    setTool('sam2Segment');
    announce(
      'Object Selection active. Click to include; Shift-click to subtract; drag a box to prompt.',
    );
  }, [announce, node, setTool]);

  const applyObjectSelectionMask = useCallback(() => {
    if (!node || !objectSelection) return;
    void applySam2Segmentation({
      nodeId: node.id,
      prompts: {
        points: objectSelection.points,
        box: objectSelection.box ?? undefined,
      },
      operation: 'mask',
      candidateIndex: objectSelection.selectedCandidate,
    });
  }, [applySam2Segmentation, node, objectSelection]);

  const refreshModelStatus = useCallback(async () => {
    const loader = await getModelLoaderReady();
    setModelState(loader.getState());
    if (method === 'quick' || !requiredModelId) {
      setAiAvailable(true);
      setEnhancedBalancedAvailable(await loader.isModelAvailable('isnet-general-use'));
      return;
    }
    setAiAvailable(await loader.isModelAvailable(requiredModelId));
    setEnhancedBalancedAvailable(await loader.isModelAvailable('isnet-general-use'));
  }, [method, requiredModelId]);

  useEffect(() => {
    if (!eligible) return;
    void refreshModelStatus();
    let unsub: (() => void) | undefined;
    void getModelLoaderReady().then((loader) => {
      unsub = loader.subscribe(() => {
        void refreshModelStatus();
      });
    });
    return () => unsub?.();
  }, [refreshModelStatus, eligible]);

  useEffect(() => {
    getEnvironmentCapabilities().then((caps) => {
      setHasGpuAccel(caps.hasWebGPU || caps.hasWebGL || caps.isTauri);
    });
  }, []);

  useEffect(() => {
    if (method !== 'quick' && requiredModelId) {
      isWasmModelSafe(requiredModelId).then(setWasmModelSafe);
    } else {
      setWasmModelSafe(true);
    }
  }, [method, requiredModelId]);

  useEffect(() => {
    if (pending) {
      setElapsedMs(0);
      const start = Date.now();
      elapsedRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - start);
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
  }, [pending]);

  if (isCapabilityRestricted('inference')) return null;
  if (!eligible || !node) return null;

  const handleApply = async () => {
    // Re-check freshly rather than trusting `aiAvailable` state: it's set
    // asynchronously by the model-status effect keyed on `method`, so
    // switching the dropdown and clicking Apply before that effect resolves
    // could otherwise let a stale "available" reading from a previously
    // selected method through, silently attempting removal with no model.
    if (method !== 'quick' && requiredModelId) {
      const loader = await getModelLoaderReady();
      const stillAvailable = await loader.isModelAvailable(requiredModelId);
      setAiAvailable(stillAvailable);
      if (!stillAvailable) {
        announce('Download the AI model first, or switch to Quick mode.');
        setDownloadModelId(requiredModelId);
        setShowDownloadDialog(true);
        return;
      }
    }
    setError(null);
    setPending(true);
    try {
      await removeBackgroundWithOptions(method, feather, decontaminate);
    } catch (e) {
      const message = normalizeErrorMessage(e, 'Background removal failed');
      setError(message);
      if (message !== 'Cancelled') {
        announce(message);
      }
    } finally {
      setPending(false);
    }
  };

  const handleCancel = () => {
    cancelBackgroundRemoval();
    setPending(false);
    setError('Cancelled');
  };

  const handleReset = () => {
    updateDoc((document) => {
      const withoutNativeMask = removeRasterMaskFromNode(document, node.id);
      const current = withoutNativeMask.nodes[node.id] as ShapeNode | undefined;
      if (!current?.backgroundRemoval) return withoutNativeMask;
      const { backgroundRemoval: _, ...rest } = current;
      return {
        ...withoutNativeMask,
        nodes: { ...withoutNativeMask.nodes, [node.id]: rest as ShapeNode },
      };
    });
    announce('Background removal reset');
  };

  const handleDownload = (modelId = requiredModelId) => {
    // Show a warning before downloading AI Quality on environments without GPU
    if (method === 'ai-quality' && !hasGpuAccel) {
      announce(
        'This model requires significant memory. Download it now, but inference may fail without GPU acceleration on this device.',
      );
    }
    setDownloadModelId(modelId);
    setShowDownloadDialog(true);
  };

  const handleTogglePreview = () => {
    setShowOriginalBg(showingOriginal ? null : node.id);
    announce(
      showingOriginal
        ? 'Showing masked result'
        : 'Showing original image without background removal',
    );
  };

  const handleRefineMask = () => {
    setMaskEditorOpen(true);
    setMaskPreviewMode('checkerboard');
    setTool('refineMask');
    announce('Refine mask: paint to add, Alt+paint to subtract, Escape to finish');
  };

  const handleRefineHair = () => {
    void refineHairEdges();
  };

  const handleEditTrimap = () => {
    setMaskEditorOpen(true);
    startTrimapEdit();
  };

  const handleApplyTrimap = () => {
    void applyTrimapMatting();
  };

  const handleDoneMaskEditing = () => {
    setTool('select');
    setMaskPreviewMode('none');
    setMaskEditorOpen(false);
    announce('Mask editing finished');
  };

  return (
    <>
      {eligible && (
        <DisclosureSection title="Object Selection" defaultExpanded={Boolean(objectSelection)}>
          <div className="insp-field" style={{ flexDirection: 'column', gap: 'var(--space-1)' }}>
            <p className="insp-field__hint">
              Select an object on the image, then refine it with more points or a box. The preview
              is temporary until you apply it as a mask.
            </p>
            <button type="button" className="insp-btn-sm" onClick={startObjectSelection}>
              {objectSelection ? 'Continue Object Selection' : 'Select Object'}
            </button>
            {objectSelection && (
              <>
                <span className="insp-field__hint" role="status" aria-live="polite">
                  Preview ready · {Math.round(objectSelection.confidence * 100)}% model confidence ·{' '}
                  {objectSelection.candidates.length} candidate mask
                  {objectSelection.candidates.length === 1 ? '' : 's'}
                </span>
                {objectSelection.candidates.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                    <button
                      type="button"
                      className="insp-btn-sm"
                      aria-label="Previous object-selection candidate"
                      onClick={() =>
                        selectSam2Candidate(
                          (objectSelection.selectedCandidate -
                            1 +
                            objectSelection.candidates.length) %
                            objectSelection.candidates.length,
                        )
                      }
                    >
                      Previous
                    </button>
                    <span className="insp-field__hint" aria-live="polite">
                      Candidate {objectSelection.selectedCandidate + 1} of{' '}
                      {objectSelection.candidates.length}
                    </span>
                    <button
                      type="button"
                      className="insp-btn-sm"
                      aria-label="Next object-selection candidate"
                      onClick={() =>
                        selectSam2Candidate(
                          (objectSelection.selectedCandidate + 1) %
                            objectSelection.candidates.length,
                        )
                      }
                    >
                      Next
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <button type="button" className="insp-btn-sm" onClick={applyObjectSelectionMask}>
                    Apply as mask
                  </button>
                  <button type="button" className="insp-btn-sm" onClick={cancelSam2Segmentation}>
                    Cancel
                  </button>
                </div>
                <p className="insp-field__hint">
                  Canvas markers use + for include and − for exclude. Dragging creates a box prompt;
                  it does not add an accidental point.
                </p>
              </>
            )}
          </div>
        </DisclosureSection>
      )}
      <DisclosureSection title="Background Removal" sectionId="background-removal">
        <div className="insp-field-group">
          <FieldRow label="Method">
            <Select
              label="Background removal method"
              value={method}
              options={[
                { value: 'quick', label: 'Fast — instant, simple backgrounds' },
                {
                  value: 'ai-balanced',
                  label: `Auto — general photos (AI Balanced)${!aiAvailable ? ' (download required)' : ''}`,
                },
                {
                  value: 'ai-quality',
                  label: `High quality — fine details (AI High Quality)${
                    !aiAvailable ? ' (download required)' : ''
                  }${!wasmModelSafe && !hasGpuAccel ? ' — may need GPU' : ''}`,
                },
              ]}
              onChange={(v) => setMethod(v as RemovalMethod)}
            />
          </FieldRow>
          <span id="bg-method-desc" className="sr-only">
            Fast uses a local heuristic. Auto uses IS-Net General Use when installed and falls back
            to bundled U²-Net Light. High quality uses BiRefNet Lite where the available provider is
            safe.
          </span>

          <section className="insp-nested-panel" aria-label={`${methodGuidance.title} guidance`}>
            <p className="insp-subsection__label">{methodGuidance.title}</p>
            <p className="insp-model-info__desc">{methodGuidance.description}</p>
            <p className="insp-hint">
              <strong>Best for:</strong> {methodGuidance.bestFor}
            </p>
            <p className="insp-hint">{methodGuidance.tradeoff}</p>
            {method === 'quick' && (
              <ol className="insp-hint" aria-label="Quick cutout workflow">
                <li>Create an automatic mask preview.</li>
                <li>Review it on the checkerboard before applying.</li>
                <li>Open Edit mask for brush or trimap corrections.</li>
              </ol>
            )}
          </section>

          {(() => {
            const info = getModelInfo(method);
            if (!info) return null;
            const needsGpuWarn = info.gpuRecommended && method === 'ai-quality' && !hasGpuAccel;
            return (
              <div className="insp-model-info">
                <p className="insp-hint">
                  {info.quality} &middot; {info.diskSizeDisplay} on disk &middot;{' '}
                  {info.peakRamDisplay} RAM during inference
                </p>
                <p className="insp-model-info__desc">{info.description}</p>
                {needsGpuWarn && (
                  <p className="insp-hint insp-hint--warn" role="status">
                    GPU acceleration recommended for this model. Without it, inference may be slow
                    or fail on some systems.
                  </p>
                )}
                {method === 'ai-quality' && !wasmModelSafe && !hasGpuAccel && !needsGpuWarn && (
                  <p className="insp-hint insp-hint--warn" role="status">
                    This model exceeds the safe WASM memory limit without GPU acceleration. The AI
                    Balanced model will be used as fallback if AI Quality fails. Consider switching
                    to AI Balanced for reliable results.
                  </p>
                )}
              </div>
            );
          })()}

          {previewDownscaleActive && (
            <p className="insp-hint" aria-live="polite">
              Processing at reduced resolution; full-resolution mask upscaled.
            </p>
          )}

          {method !== 'quick' && !aiAvailable && modelState !== 'downloading' && (
            <div className="insp-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => handleDownload()}
                aria-label="Download AI model for background removal"
              >
                Download AI Model
              </Button>
              <p className="insp-hint">
                Requires a one-time download stored on this device. Manage models in Settings,
                Offline Models.
              </p>
            </div>
          )}

          {method === 'ai-balanced' && aiAvailable && !enhancedBalancedAvailable && (
            <div className="insp-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleDownload('isnet-general-use')}
                aria-label="Download enhanced Balanced model"
              >
                Upgrade Balanced
              </Button>
              <p className="insp-hint">
                Optional 179 MB IS-Net model improves varied people, animals, vehicles, and objects.
                The bundled low-memory model remains available as fallback.
              </p>
            </div>
          )}
          {method !== 'quick' && modelState === 'downloading' && (
            <p className="insp-hint" aria-live="polite">
              Downloading model... Please wait.
            </p>
          )}

          {maskProvenance && (
            <p className="insp-meta-row">
              <span>
                Confidence{' '}
                {Math.round(((maskProvenance as { confidence?: number }).confidence ?? 0) * 100)}%
              </span>
              <span className="insp-meta-row__sep" aria-hidden>
                ·
              </span>
              <span>{(maskProvenance as { method?: string }).method ?? 'quick'}</span>
            </p>
          )}

          {maskProvenance &&
            ((maskProvenance as { confidence?: number }).confidence ?? 1) < 0.55 && (
              <p className="insp-hint insp-hint--warn" role="status">
                This mask is uncertain. Try AI Balanced or open Edit mask to correct the edges.
              </p>
            )}

          <div className="insp-field">
            <label className="insp-field__label" htmlFor="bg-feather">
              Feather
            </label>
            <div className="insp-field__control">
              <div className="insp-stepper">
                <button
                  type="button"
                  className="insp-stepper__btn"
                  onClick={() => setFeather((v) => Math.max(0, +(v - 0.1).toFixed(1)))}
                  aria-label="Decrease feather"
                >
                  −
                </button>
                <input
                  id="bg-feather"
                  type="number"
                  min={0}
                  max={3}
                  step={0.1}
                  value={feather}
                  aria-label="Feather"
                  className="insp-num__input insp-stepper__input"
                  onChange={(e) => {
                    const v = Number.parseFloat(e.target.value);
                    if (!Number.isNaN(v)) setFeather(Math.max(0, Math.min(3, v)));
                  }}
                />
                <button
                  type="button"
                  className="insp-stepper__btn"
                  onClick={() => setFeather((v) => Math.min(3, +(v + 0.1).toFixed(1)))}
                  aria-label="Increase feather"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="insp-hint">
            Feather softens the mask boundary. Keep it low for hard objects; increase it slightly
            for soft edges.
          </p>

          <label className="insp-check" htmlFor={decontaminateId}>
            <input
              id={decontaminateId}
              type="checkbox"
              className="insp-checkbox"
              checked={decontaminate}
              onChange={(e) => setDecontaminate(e.target.checked)}
            />
            <span>Reduce colour fringe</span>
          </label>
          <p className="insp-hint">
            Pulls background colour out of semi-transparent edge pixels after masking.
          </p>

          <div className="insp-actions">
            {pending ? (
              <>
                <span className="insp-hint" aria-live="polite">
                  Creating mask preview… {Math.round(elapsedMs / 1000)}s
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  aria-label="Cancel background removal"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void handleApply()}
                aria-label={
                  maskProvenance ? 'Re-apply background removal' : 'Remove background from image'
                }
              >
                {maskProvenance
                  ? 'Preview new mask'
                  : method === 'quick'
                    ? 'Create quick preview'
                    : 'Create AI preview'}
              </Button>
            )}
          </div>

          {previewSession && (
            <section className="insp-nested-panel" aria-label="Background removal review">
              <p className="insp-subsection__label">Review mask before applying</p>
              <div
                className="insp-mask-review"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(-45deg, var(--color-surface-sunken) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-surface-sunken) 75%), linear-gradient(-45deg, transparent 75%, var(--color-surface-sunken) 75%)',
                  backgroundSize: '16px 16px',
                }}
              >
                <img
                  src={imageShapeSrc(node)}
                  alt="Isolated subject preview"
                  style={{
                    display: 'block',
                    width: '100%',
                    maxHeight: 180,
                    objectFit: 'contain',
                    WebkitMaskImage: `url("${previewSession.maskDataUrl}")`,
                    WebkitMaskSize: 'contain',
                    WebkitMaskPosition: 'center',
                    WebkitMaskRepeat: 'no-repeat',
                    maskImage: `url("${previewSession.maskDataUrl}")`,
                    maskSize: 'contain',
                    maskPosition: 'center',
                    maskRepeat: 'no-repeat',
                  }}
                />
              </div>
              <p className="insp-hint" role="status">
                Requested {previewSession.requestedMethod}; generated {previewSession.actualMethod}
                {previewSession.modelId ? ` with ${previewSession.modelId}` : ''}
                {previewSession.modelPrecision
                  ? ` (${previewSession.modelPrecision.toUpperCase()})`
                  : ''}
                {previewSession.executionProvider ? ` on ${previewSession.executionProvider}` : ''}.
                {previewSession.precisionFallback && previewSession.precisionFallbackReason
                  ? ` ${previewSession.precisionFallbackReason}`
                  : ''}{' '}
                Nothing has been added to the document yet.
              </p>
              <div className="insp-field">
                <span className="insp-field__label">Mask confidence</span>
                <div className="insp-field__control">
                  <progress
                    max={1}
                    value={previewSession.confidence}
                    aria-label="Mask confidence"
                  />
                  <span>{Math.round(previewSession.confidence * 100)}%</span>
                </div>
              </div>
              {previewSession.confidence < 0.55 && (
                <p className="insp-hint insp-hint--warn" role="status">
                  The subject boundary is uncertain. Cancel and choose AI Balanced, or apply then
                  use Edit mask to correct it.
                </p>
              )}
              <div className="insp-actions">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={applyBackgroundRemovalPreview}
                >
                  Apply result
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelBackgroundRemovalPreview}
                >
                  Cancel preview
                </Button>
              </div>
            </section>
          )}

          {maskProvenance && (
            <div className="insp-actions insp-actions--secondary">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                aria-label="Reset background removal to original image"
              >
                Reset
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (maskEditorOpen) handleDoneMaskEditing();
                  else handleRefineMask();
                }}
                aria-expanded={maskEditorOpen}
                aria-controls="background-mask-editor"
              >
                {maskEditorOpen ? 'Close mask editor' : 'Edit mask'}
              </Button>
              <Button
                type="button"
                variant={showingOriginal ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={showingOriginal}
                onClick={handleTogglePreview}
              >
                {showingOriginal ? 'Showing Original' : 'Show Original'}
              </Button>
            </div>
          )}

          {error && error !== 'Cancelled' && (
            <p className="insp-hint insp-hint--error" role="alert">
              {error}
            </p>
          )}
        </div>

        {maskEditorOpen && maskProvenance && (
          <div className="insp-nested-panel" id="background-mask-editor">
            <p className="insp-subsection__label">Mask editor</p>
            <p className="insp-hint">
              Paint to add the subject. Hold Alt while painting to remove it. Use trimap for
              difficult semi-transparent edges.
            </p>
            <FieldRow label="Preview">
              <Select
                label="Mask preview mode"
                value={state.maskPreviewMode}
                options={[
                  { value: 'checkerboard', label: 'Checkerboard' },
                  { value: 'overlay', label: 'Overlay' },
                  { value: 'black', label: 'Black bg' },
                  { value: 'white', label: 'White bg' },
                  { value: 'mask-only', label: 'Mask only' },
                  { value: 'edge', label: 'Edge detection' },
                  { value: 'none', label: 'None' },
                ]}
                onChange={(v) =>
                  setMaskPreviewMode(v as import('../../../context/types').MaskPreviewMode)
                }
              />
            </FieldRow>
            <div className="insp-actions">
              <Button
                type="button"
                variant={refiningMask ? 'secondary' : 'ghost'}
                size="sm"
                onClick={handleRefineMask}
              >
                Refine Mask
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRefineHair}
                aria-label="Refine hair and fur edges with guided matting"
              >
                Refine edges (hair/fur)
              </Button>
              <Button
                type="button"
                variant={editingTrimap ? 'secondary' : 'ghost'}
                size="sm"
                onClick={handleEditTrimap}
                aria-label="Edit trimap for difficult edges"
              >
                Edit trimap
              </Button>
            </div>
            <FieldRow label="Brush size" htmlFor="bg-refine-brush">
              <input
                id="bg-refine-brush"
                type="range"
                className="insp-range"
                min={5}
                max={100}
                value={brushSize}
                aria-label="Brush size"
                onChange={(e) =>
                  setRefineMaskOptions({ brushSize: Number(e.target.value), hardness })
                }
              />
              <output htmlFor="bg-refine-brush">{brushSize}px</output>
            </FieldRow>
            <FieldRow label="Hardness" htmlFor="bg-refine-hardness">
              <input
                id="bg-refine-hardness"
                type="range"
                className="insp-range"
                min={0}
                max={1}
                step={0.05}
                value={hardness}
                aria-label="Hardness"
                onChange={(e) =>
                  setRefineMaskOptions({ brushSize, hardness: Number(e.target.value) })
                }
              />
              <output htmlFor="bg-refine-hardness">{Math.round(hardness * 100)}%</output>
            </FieldRow>
            <div className="insp-actions">
              <Button type="button" variant="primary" size="sm" onClick={handleDoneMaskEditing}>
                Done
              </Button>
            </div>
          </div>
        )}

        {maskEditorOpen && editingTrimap && maskProvenance && (
          <div className="insp-nested-panel">
            <p className="insp-subsection__label">Trimap</p>
            <FieldRow label="Pen">
              <Select
                label="Trimap pen"
                value={trimapOpts.penMode}
                options={[
                  { value: 'foreground', label: 'Foreground' },
                  { value: 'unknown', label: 'Unknown' },
                  { value: 'background', label: 'Background' },
                ]}
                onChange={(v) =>
                  setTrimapEditOptions({
                    penMode: v as 'foreground' | 'unknown' | 'background',
                  })
                }
              />
            </FieldRow>
            <FieldRow label="Brush size" htmlFor="bg-trimap-brush">
              <input
                id="bg-trimap-brush"
                type="range"
                className="insp-range"
                min={5}
                max={100}
                value={trimapOpts.brushSize}
                aria-label="Trimap brush size"
                onChange={(e) => setTrimapEditOptions({ brushSize: Number(e.target.value) })}
              />
            </FieldRow>
            <div className="insp-actions">
              <Button type="button" variant="primary" size="sm" onClick={handleApplyTrimap}>
                Apply trimap matting
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTool('select')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {showDownloadDialog && (
          <ModelDownloadDialog
            modelId={downloadModelId ?? requiredModelId ?? ''}
            onClose={() => {
              setShowDownloadDialog(false);
              setDownloadModelId(null);
            }}
            onComplete={() => {
              setShowDownloadDialog(false);
              setDownloadModelId(null);
              void refreshModelStatus();
            }}
          />
        )}
      </DisclosureSection>
    </>
  );
}
