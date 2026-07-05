import type { BackgroundRemovalMethod, SceneNode, ImageNode } from '@strata/scene';
import { getModelLoader } from '@strata/engine';
import { useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';

export function BackgroundRemovalSection({ nodes }: { nodes: SceneNode[] }) {
  const { state, removeBackground, updateNode, announce } = useEditor();
  const node = nodes[0] as ImageNode;
  if (node.kind !== 'image') return null;

  const bg = node.backgroundRemoval;
  const loader = getModelLoader();
  const aiAvailable = loader.getState() === 'ready';
  const [method, setMethod] = useState<BackgroundRemovalMethod>(bg?.method ?? 'quick');
  const [pending, setPending] = useState(false);

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

  const handleDownload = async () => {
    try {
      await loader.downloadModel('birefnet-general-lite', (loaded, total) => {
        const pct = Math.round((loaded / total) * 100);
        announce(`Downloading AI model... ${pct}%`);
      });
      announce('AI model downloaded. You can now use AI Balanced or AI Best Quality.');
    } catch {
      announce('Failed to download AI model.');
    }
  };

  return (
    <DisclosureSection title="Background Removal">
      <div className="bg-removal__method">
        <label htmlFor="bg-method">Method</label>
        <select
          id="bg-method"
          value={method}
          onChange={(e) => setMethod(e.target.value as BackgroundRemovalMethod)}
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

      {!aiAvailable && (
        <div className="bg-removal__actions">
          <button className="button--primary" onClick={handleDownload}>
            Download AI Model
          </button>
        </div>
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
    </DisclosureSection>
  );
}
