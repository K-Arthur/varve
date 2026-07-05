import { useState, useEffect, useCallback } from 'react';
import { getModelLoader, AVAILABLE_MODELS } from '@strata/engine';
import type { ModelMetadata } from '@strata/engine';
import './ModelDownloadDialog.css';

interface ModelDownloadDialogProps {
  modelId: string;
  onClose: () => void;
  onComplete: () => void;
}

export function ModelDownloadDialog({ modelId, onClose, onComplete }: ModelDownloadDialogProps) {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'downloading' | 'done' | 'error'>('downloading');
  const [error, setError] = useState('');

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setProgress(0);
    setError('');
    try {
      const loader = getModelLoader();
      await loader.downloadModel(modelId, (loaded, total) => {
        setProgress(Math.round((loaded / total) * 100));
      });
      setStatus('done');
      setTimeout(onComplete, 1000);
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  }, [modelId, onComplete]);

  useEffect(() => {
    handleDownload();
  }, [handleDownload]);

  const sizeMB = model ? Math.round(model.size / 1_000_000) : 0;

  return (
    <div
      className="model-download-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Download AI Model"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="model-download-dialog">
        <h2>Download AI Model</h2>
        {model && (
          <p className="model-download__desc">
            {model.name} — ~{sizeMB} MB
          </p>
        )}

        {status === 'downloading' && (
          <div className="model-download__progress">
            <div className="model-download__bar">
              <div className="model-download__fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="model-download__pct">{progress}%</span>
          </div>
        )}

        {status === 'done' && <p className="model-download__done">Model ready!</p>}

        {status === 'error' && (
          <div className="model-download__error">
            <p>Download failed: {error}</p>
            <button className="button button--primary" onClick={handleDownload}>
              Retry
            </button>
          </div>
        )}

        <div className="model-download__actions">
          <button className="button button--ghost" onClick={onClose}>
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
