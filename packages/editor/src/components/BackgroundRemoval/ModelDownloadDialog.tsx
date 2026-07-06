import { AVAILABLE_MODELS, getModelLoader } from '@strata/engine';
import { useCallback, useState } from 'react';
import { FocusTrap } from '../../onboard/FocusTrap';
import './ModelDownloadDialog.css';

interface ModelDownloadDialogProps {
  modelId: string;
  onClose: () => void;
  onComplete: () => void;
}

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'a remote server';
  }
}

type DownloadStatus = 'confirm' | 'downloading' | 'done' | 'error';

export function ModelDownloadDialog({ modelId, onClose, onComplete }: ModelDownloadDialogProps) {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  const [progress, setProgress] = useState(0);
  // Downloads are tens-to-hundreds of MB over the network — this is opt-in
  // by design (ADR-0005). The dialog must never start transferring data
  // before the user has seen the size/source and explicitly agreed; it only
  // opens once the caller's own "Download AI Model" button was already
  // clicked, so this second, more detailed gate is the actual point of
  // informed consent (name + size + source + purpose, not just a button).
  const [status, setStatus] = useState<DownloadStatus>('confirm');
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

  const sizeMB = model ? Math.round(model.size / 1_000_000) : 0;
  const sourceHost = model ? sourceHostname(model.remoteUrl) : 'a remote server';

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
      <FocusTrap onClose={onClose}>
        <div className="model-download-dialog">
          <h2>Download AI Model</h2>

          {status === 'confirm' && (
            <>
              <p className="model-download__desc">
                {model ? `${model.name} — ~${sizeMB} MB` : 'This model'} will be downloaded from{' '}
                <strong>{sourceHost}</strong> and stored on this device for offline background
                removal. It is only used locally to run AI-quality background removal — no images
                are uploaded anywhere. This is a one-time download; Quick mode remains available
                with no download required.
              </p>
              <div className="model-download__actions">
                <button className="button button--ghost" onClick={onClose}>
                  Cancel
                </button>
                <button className="button button--primary" onClick={handleDownload}>
                  Download
                </button>
              </div>
            </>
          )}

          {status !== 'confirm' && model && (
            <p className="model-download__desc">
              {model.name} — ~{sizeMB} MB
            </p>
          )}

          {status === 'downloading' && (
            <div className="model-download__progress" aria-live="polite">
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

          {status !== 'confirm' && (
            <div className="model-download__actions">
              <button className="button button--ghost" onClick={onClose}>
                {status === 'done' ? 'Close' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  );
}
