/**
 * BackgroundRemovalSection — image cutout controls in the Properties panel.
 *
 * Layout / chrome match Appearance/Fill: DisclosureSection, FieldRow,
 * insp-select, NumberField, @strata/ui Button (replacing unstyled button--*).
 *
 * Research basis: Figma generative fill panel density; APG form disclosure.
 */
import type { RemovalMethod } from '@strata/engine';
import {
  DEFAULT_PREVIEW_MAX_DIMENSION,
  getModelLoaderReady,
  workerModelIdForMethod,
} from '@strata/engine';
import type { SceneNode, ShapeNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  if (message.includes('Model') || message.includes('model')) {
    return `Model failed to load: ${defaultMessage}`;
  }
  return message.length > 180 ? message.slice(0, 180) + '...' : message;
}

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    state,
    removeBackgroundWithOptions,
    cancelBackgroundRemoval,
    updateNode,
    announce,
    setShowOriginalBg,
    setTool,
    setRefineMaskOptions,
    refineHairEdges,
    startTrimapEdit,
    applyTrimapMatting,
    setTrimapEditOptions,
  } = useEditor();
  const node = nodes[0] as ShapeNode | undefined;
  const methodId = useId();
  const decontaminateId = useId();
  const trimapModeId = useId();
  const eligible = Boolean(node && (isImageShape(node) || node.backgroundRemoval));
  const bg = node?.backgroundRemoval;

  const [method, setMethod] = useState<RemovalMethod>(bg?.method ?? 'quick');
  const [pending, setPending] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [feather, setFeather] = useState(bg?.feather ?? 0.5);
  const [decontaminate, setDecontaminate] = useState(bg?.decontaminate ?? true);
  const [modelState, setModelState] = useState<'unavailable' | 'downloading' | 'ready' | 'error'>(
    'unavailable',
  );
  const [aiAvailable, setAiAvailable] = useState(false);

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

  const refreshModelStatus = useCallback(async () => {
    const loader = await getModelLoaderReady();
    setModelState(loader.getState());
    if (method === 'quick' || !requiredModelId) {
      setAiAvailable(true);
      return;
    }
    setAiAvailable(await loader.isModelAvailable(requiredModelId));
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

  if (!eligible || !node) return null;

  const handleApply = async () => {
    if (method !== 'quick' && !aiAvailable) {
      announce('Download the AI model first, or switch to Quick mode.');
      setShowDownloadDialog(true);
      return;
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
    updateNode(node.id, (n) => {
      const { backgroundRemoval: _, ...rest } = n as ShapeNode;
      return rest;
    });
    announce('Background removal reset');
  };

  const handleDownload = () => {
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
    setTool('refineMask');
    announce('Refine mask: paint to add, Alt+paint to subtract, Escape to finish');
  };

  const handleRefineHair = () => {
    void refineHairEdges();
  };

  const handleEditTrimap = () => {
    startTrimapEdit();
  };

  const handleApplyTrimap = () => {
    void applyTrimapMatting();
  };

  const downloadModelId = requiredModelId;

  return (
    <DisclosureSection title="Background Removal">
      <div className="insp-field-group">
        <FieldRow label="Method" htmlFor={methodId}>
          <select
            id={methodId}
            className="insp-select"
            value={method}
            aria-label="Background removal method"
            aria-describedby="bg-method-desc"
            onChange={(e) => setMethod(e.target.value as RemovalMethod)}
          >
            <option value="quick">Quick (no download needed)</option>
            <option value="ai-balanced">
              AI Balanced{!aiAvailable ? ' (download required)' : ''}
            </option>
            <option value="ai-quality">
              AI High Quality{!aiAvailable ? ' (download required)' : ''}
            </option>
          </select>
        </FieldRow>
        <span id="bg-method-desc" className="sr-only">
          Quick uses a fast heuristic. AI Balanced uses the bundled offline model. AI High Quality
          uses a downloadable model for more complex edges.
        </span>

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
              onClick={handleDownload}
              aria-label="Download AI model for background removal"
            >
              Download AI Model
            </Button>
            <p className="insp-hint">
              Requires a one-time download stored on this device. Manage models in Settings, Offline
              Models.
            </p>
          </div>
        )}
        {method !== 'quick' && modelState === 'downloading' && (
          <p className="insp-hint" aria-live="polite">
            Downloading model... Please wait.
          </p>
        )}

        {bg && (
          <p className="insp-meta-row">
            <span>Confidence {Math.round((bg.confidence ?? 0) * 100)}%</span>
            <span className="insp-meta-row__sep" aria-hidden>
              ·
            </span>
            <span>{bg.method}</span>
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

        <label className="insp-check" htmlFor={decontaminateId}>
          <input
            id={decontaminateId}
            type="checkbox"
            className="insp-checkbox"
            checked={decontaminate}
            onChange={(e) => setDecontaminate(e.target.checked)}
          />
          <span>Decontaminate</span>
        </label>

        <div className="insp-actions">
          {pending ? (
            <>
              <span className="insp-hint" aria-live="polite">
                Processing… {Math.round(elapsedMs / 1000)}s
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
              aria-label={bg ? 'Re-apply background removal' : 'Remove background from image'}
            >
              {bg ? 'Re-apply' : 'Remove Background'}
            </Button>
          )}
        </div>

        {bg && (
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
              onClick={handleRefineMask}
              aria-label="Refine background removal mask with brush"
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
              variant="ghost"
              size="sm"
              onClick={handleEditTrimap}
              aria-label="Edit trimap for difficult edges"
            >
              Edit trimap
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

      {refiningMask && bg && (
        <div className="insp-nested-panel">
          <p className="insp-subsection__label">Refine mask</p>
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
            <Button type="button" variant="secondary" size="sm" onClick={() => setTool('select')}>
              Done
            </Button>
          </div>
        </div>
      )}

      {editingTrimap && bg && (
        <div className="insp-nested-panel">
          <p className="insp-subsection__label">Trimap</p>
          <FieldRow label="Pen" htmlFor={trimapModeId}>
            <select
              id={trimapModeId}
              className="insp-select"
              value={trimapOpts.penMode}
              aria-label="Trimap pen"
              onChange={(e) =>
                setTrimapEditOptions({
                  penMode: e.target.value as 'foreground' | 'unknown' | 'background',
                })
              }
            >
              <option value="foreground">Foreground</option>
              <option value="unknown">Unknown</option>
              <option value="background">Background</option>
            </select>
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
          modelId={downloadModelId ?? ''}
          onClose={() => setShowDownloadDialog(false)}
          onComplete={() => {
            setShowDownloadDialog(false);
            void refreshModelStatus();
          }}
        />
      )}
    </DisclosureSection>
  );
}
