import { AVAILABLE_MODELS, getModelLoader, UPSCALE_MODELS } from '@strata/engine';
import { useCallback, useRef, useState } from 'react';
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
  const removalModel = AVAILABLE_MODELS.find((candidate) => candidate.id === modelId);
  const model = removalModel ?? UPSCALE_MODELS.find((candidate) => candidate.id === modelId);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<DownloadStatus>('confirm');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setProgress(0);
    setError('');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        modelId,
        (loaded, total) => {
          setProgress(Math.round((loaded / total) * 100));
        },
        controller.signal,
      );
      setStatus('done');
      setTimeout(onComplete, 1000);
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus('confirm');
        return;
      }
      setStatus('error');
      setError((e as Error).message);
    } finally {
      abortRef.current = null;
    }
  }, [modelId, onComplete]);

  const handleCancel = useCallback(() => {
    if (status === 'downloading') {
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus('confirm');
      setProgress(0);
      return;
    }
    onClose();
  }, [status, onClose]);

  const sizeMB = model ? Math.round(model.size / 1_000_000) : 0;
  const sourceHost = model ? sourceHostname(model.remoteUrl) : 'a remote server';
  const purpose = removalModel ? 'background removal' : 'image upscaling';

  return (
    <div
      className="model-download-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Download AI Model"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <FocusTrap onClose={handleCancel}>
        <div className="model-download-dialog">
          <h2>Download AI Model</h2>

          {status === 'confirm' && (
            <>
              <p className="model-download__desc">
                {model ? `${model.name} — ~${sizeMB} MB` : 'This model'} will be downloaded from{' '}
                <strong>{sourceHost}</strong> and stored on this device for offline local {purpose}.
                It is only used on this machine — no images are uploaded. This is a one-time
                download.
              </p>
              <div className="model-download__actions">
                <button type="button" className="button button--ghost" onClick={handleCancel}>
                  Cancel
                </button>
                <button type="button" className="button button--primary" onClick={handleDownload}>
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
              <button type="button" className="button button--primary" onClick={handleDownload}>
                Retry
              </button>
            </div>
          )}

          {status !== 'confirm' && (
            <div className="model-download__actions">
              <button type="button" className="button button--ghost" onClick={handleCancel}>
                {status === 'done' ? 'Close' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  );
}
