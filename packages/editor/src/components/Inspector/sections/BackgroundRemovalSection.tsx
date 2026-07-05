import type { SceneNode, ImageNode } from '@strata/scene';
import { getModelLoader } from '@strata/engine';
import type { RemovalMethod } from '@strata/engine';
import { useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { ModelDownloadDialog } from '../../BackgroundRemoval/ModelDownloadDialog';

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, removeBackground, updateNode, announce } = useEditor();
  const node = nodes[0] as ImageNode;
  if (node.kind !== 'image') return null;

  const bg = node.backgroundRemoval;
  const loader = getModelLoader();
  const modelState = loader.getState();
  const aiAvailable = modelState === 'ready';
  const [method, setMethod] = useState<RemovalMethod>(bg?.method ?? 'quick');
  const [pending, setPending] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);

  const handleApply = async () => {
    setPending(true);
    try {
      await removeBackground(method);
    } finally {
      setPending(false);
    }
  };

  const handleReset = () => {
    updateNode(node.id, (n) => {
      const { backgroundRemoval: _, ...rest } = n as ImageNode;
      return rest;
    });
    announce('Background removal reset');
  };

  const handleDownload = () => {
    setShowDownloadDialog(true);
  };

  return (
    <DisclosureSection title="Background Removal">
      <div className="bg-removal__method">
        <label htmlFor="bg-method">Method</label>
        <select
          id="bg-method"
          value={method}
          onChange={(e) => setMethod(e.target.value as RemovalMethod)}
        >
          <option value="quick">Quick (no download needed)</option>
          <option value="ai-balanced" disabled={!aiAvailable}>
            AI Balanced{!aiAvailable ? ' (not downloaded)' : ''}
          </option>
          <option value="ai-quality" disabled={!aiAvailable}>
            AI Best Quality{!aiAvailable ? ' (not downloaded)' : ''}
          </option>
        </select>
      </div>

      {method !== 'quick' && !aiAvailable && modelState !== 'downloading' && (
        <div className="bg-removal__actions">
          <button className="button--primary" onClick={handleDownload}>
            Download AI Model
          </button>
        </div>
      )}
      {method !== 'quick' && modelState === 'downloading' && (
        <p className="bg-removal__hint">Downloading model... Please wait.</p>
      )}

      {bg && (
        <div className="bg-removal__info">
          <span>Confidence: {Math.round((bg.confidence ?? 0) * 100)}%</span>
          <span>Method: {bg.method}</span>
        </div>
      )}

      <div className="bg-removal__actions">
        <button className="button--primary" onClick={handleApply} disabled={pending}>
          {pending ? 'Processing...' : bg ? 'Re-apply' : 'Remove Background'}
        </button>
        {bg && (
          <button className="button--ghost" onClick={handleReset}>
            Reset to Original
          </button>
        )}
      </div>
      {showDownloadDialog && (
        <ModelDownloadDialog
          modelId={method === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite'}
          onClose={() => setShowDownloadDialog(false)}
          onComplete={() => setShowDownloadDialog(false)}
        />
      )}
    </DisclosureSection>
  );
}
