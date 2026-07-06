import type { RemovalMethod } from '@strata/engine';
import { getModelLoaderReady, workerModelIdForMethod } from '@strata/engine';
import type { SceneNode, ShapeNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { useCallback, useEffect, useState } from 'react';
import { useEditor } from '../../../context';
import { ModelDownloadDialog } from '../../BackgroundRemoval/ModelDownloadDialog';
import { DisclosureSection } from '../controls/DisclosureSection';

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    state,
    removeBackgroundWithOptions,
    updateNode,
    announce,
    setShowOriginalBg,
    setTool,
    setRefineMaskOptions,
  } = useEditor();
  const node = nodes[0] as ShapeNode;
  if (!isImageShape(node) && !node.backgroundRemoval) return null;

  const bg = node.backgroundRemoval;
  const [method, setMethod] = useState<RemovalMethod>(bg?.method ?? 'quick');
  const [pending, setPending] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [feather, setFeather] = useState(bg?.feather ?? 0.5);
  const [decontaminate, setDecontaminate] = useState(bg?.decontaminate ?? true);
  const [modelState, setModelState] = useState<'unavailable' | 'downloading' | 'ready' | 'error'>(
    'unavailable',
  );
  const [aiAvailable, setAiAvailable] = useState(false);
  const showingOriginal = state.showOriginalBgNodeId === node.id;
  const refiningMask = state.tool === 'refineMask' && state.selection[0] === node.id;
  const { brushSize, hardness } = state.refineMaskOptions ?? { brushSize: 20, hardness: 0.8 };

  const requiredModelId = workerModelIdForMethod(method);

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
    void refreshModelStatus();
    let unsub: (() => void) | undefined;
    void getModelLoaderReady().then((loader) => {
      unsub = loader.subscribe(() => {
        void refreshModelStatus();
      });
    });
    return () => unsub?.();
  }, [refreshModelStatus]);

  const handleApply = async () => {
    if (method !== 'quick' && !aiAvailable) {
      announce('Download the AI model first, or switch to Quick mode.');
      setShowDownloadDialog(true);
      return;
    }
    setPending(true);
    try {
      await removeBackgroundWithOptions(method, feather, decontaminate);
    } finally {
      setPending(false);
    }
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

  const downloadModelId = method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite';

  return (
    <DisclosureSection title="Background Removal">
      <div className="bg-removal__method">
        <label htmlFor="bg-method">Method</label>
        <select
          id="bg-method"
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
            AI Best Quality{!aiAvailable ? ' (download required)' : ''}
          </option>
        </select>
        <span id="bg-method-desc" className="sr-only">
          Quick uses a fast heuristic. AI methods use a machine learning model for better results
          but require a download.
        </span>
      </div>

      {method !== 'quick' && !aiAvailable && modelState !== 'downloading' && (
        <div className="bg-removal__actions">
          <button
            className="button--primary"
            onClick={handleDownload}
            aria-label="Download AI model for background removal"
          >
            Download AI Model
          </button>
          <p className="bg-removal__hint">
            Requires a one-time download stored on this device. Manage models in Settings, Offline
            Models.
          </p>
        </div>
      )}
      {method !== 'quick' && modelState === 'downloading' && (
        <p className="bg-removal__hint" aria-live="polite">
          Downloading model... Please wait.
        </p>
      )}

      {bg && (
        <div className="bg-removal__info">
          <span>Confidence: {Math.round((bg.confidence ?? 0) * 100)}%</span>
          <span>Method: {bg.method}</span>
        </div>
      )}

      <div className="bg-removal__refinement">
        <label htmlFor="bg-feather">Feather</label>
        <div className="bg-removal__number-input">
          <button
            type="button"
            className="bg-removal__number-btn"
            onClick={() => setFeather((v) => Math.max(0, +(v - 0.1).toFixed(1)))}
            aria-label="Decrease feather"
          >
            -
          </button>
          <input
            id="bg-feather"
            type="number"
            min={0}
            max={3}
            step={0.1}
            value={feather}
            onChange={(e) => {
              const v = Number.parseFloat(e.target.value);
              if (!Number.isNaN(v)) setFeather(Math.max(0, Math.min(3, v)));
            }}
            className="bg-removal__number-field"
          />
          <button
            type="button"
            className="bg-removal__number-btn"
            onClick={() => setFeather((v) => Math.min(3, +(v + 0.1).toFixed(1)))}
            aria-label="Increase feather"
          >
            +
          </button>
        </div>
      </div>

      <label className="bg-removal__checkbox-label">
        <input
          type="checkbox"
          checked={decontaminate}
          onChange={(e) => setDecontaminate(e.target.checked)}
        />
        <span>Decontaminate</span>
      </label>

      <div className="bg-removal__actions">
        <button
          className="button--primary"
          onClick={handleApply}
          disabled={pending}
          aria-label={
            pending
              ? 'Processing background removal'
              : bg
                ? 'Re-apply background removal'
                : 'Remove background from image'
          }
        >
          {pending ? 'Processing...' : bg ? 'Re-apply' : 'Remove Background'}
        </button>
        {bg && (
          <button
            className="button--ghost"
            onClick={handleReset}
            aria-label="Reset background removal to original image"
          >
            Reset to Original
          </button>
        )}
        {bg && (
          <button
            className="button--ghost"
            onClick={handleRefineMask}
            aria-label="Refine background removal mask with brush"
          >
            Refine Mask
          </button>
        )}
        {bg && (
          <button
            className={`button--ghost ${showingOriginal ? 'button--active' : ''}`}
            onClick={handleTogglePreview}
          >
            {showingOriginal ? 'Showing Original' : 'Show Original'}
          </button>
        )}
      </div>

      {refiningMask && bg && (
        <div className="bg-removal__refine-controls">
          <div className="bg-removal__refinement">
            <label htmlFor="bg-refine-brush">Brush size</label>
            <input
              id="bg-refine-brush"
              type="range"
              min={5}
              max={100}
              value={brushSize}
              onChange={(e) => setRefineMaskOptions({ brushSize: Number(e.target.value) })}
            />
            <span>{brushSize}px</span>
          </div>
          <div className="bg-removal__refinement">
            <label htmlFor="bg-refine-hardness">Hardness</label>
            <input
              id="bg-refine-hardness"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={hardness}
              onChange={(e) => setRefineMaskOptions({ hardness: Number(e.target.value) })}
            />
            <span>{Math.round(hardness * 100)}%</span>
          </div>
          <button type="button" className="button--ghost" onClick={() => setTool('select')}>
            Done
          </button>
        </div>
      )}
      {showDownloadDialog && (
        <ModelDownloadDialog
          modelId={downloadModelId}
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
