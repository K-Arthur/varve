import { AVAILABLE_MODELS, getModelById, getModelLoader, UPSCALE_MODELS } from '@varve/engine';
import { useCallback, useRef, useState } from 'react';
import {
  type NormalizedModelDownloadError,
  normalizeModelDownloadError,
} from '../../backgroundRemoval/normalizeModelDownloadError';
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

type DownloadStatus =
  | 'confirm'
  | 'connecting'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'ready'
  | 'error'
  | 'cancelled';

export function ModelDownloadDialog({ modelId, onClose, onComplete }: ModelDownloadDialogProps) {
  const removalModel = AVAILABLE_MODELS.find((candidate) => candidate.id === modelId);
  const featureModel = removalModel ?? UPSCALE_MODELS.find((candidate) => candidate.id === modelId);
  // Denoise/other catalog models (SCUNet, for one) are in neither feature list,
  // which previously rendered a contentless "This model … a remote server"
  // prompt. The shared catalog carries the real name, size, and source, and for
  // a model whose weights sit in a sibling file the advertised size must be the
  // catalog total rather than just the graph's.
  const catalogEntry = featureModel ? undefined : getModelById(modelId);
  const model =
    featureModel ??
    (catalogEntry
      ? {
          name: catalogEntry.name,
          size: catalogEntry.sizeBytes,
          remoteUrl: catalogEntry.remoteUrl,
        }
      : undefined);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<DownloadStatus>('confirm');
  const [error, setError] = useState<NormalizedModelDownloadError | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleDownload = useCallback(async () => {
    setStatus('connecting');
    setProgress(0);
    setError(null);
    setDetailsOpen(false);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const loader = getModelLoader();
      setStatus('downloading');
      await loader.downloadModel(
        modelId,
        (loaded, total) => {
          setProgress(Math.round((loaded / total) * 100));
        },
        controller.signal,
      );
      setStatus('ready');
      setTimeout(onComplete, 1000);
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus('cancelled');
        return;
      }
      const normalized = normalizeModelDownloadError(e);
      setError(normalized);
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }, [modelId, onComplete]);

  const handleCancel = useCallback(() => {
    if (status === 'connecting' || status === 'downloading' || status === 'verifying') {
      abortRef.current?.abort();
      abortRef.current = null;
      setStatus('cancelled');
      setProgress(0);
      return;
    }
    onClose();
  }, [status, onClose]);

  const sizeMB = model ? Math.round(model.size / 1_000_000) : 0;
  const sourceHost = model ? sourceHostname(model.remoteUrl) : 'a remote server';
  const purpose = removalModel
    ? 'background removal'
    : catalogEntry?.category === 'denoising'
      ? 'image denoising'
      : 'image upscaling';
  return (
    <div
      className="model-download-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Download AI Model"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') handleCancel();
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

          {status === 'connecting' && (
            <p className="model-download__status" role="status" aria-live="polite">
              Connecting to {sourceHost}…
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

          {status === 'verifying' && (
            <p className="model-download__status" role="status" aria-live="polite">
              Verifying the downloaded file…
            </p>
          )}

          {status === 'installing' && (
            <p className="model-download__status" role="status" aria-live="polite">
              Installing the model…
            </p>
          )}

          {status === 'ready' && <p className="model-download__done">Model ready!</p>}

          {status === 'cancelled' && (
            <p className="model-download__status" role="status" aria-live="polite">
              Download cancelled. Nothing was installed.
            </p>
          )}

          {status === 'error' && error && (
            <div className="model-download__error">
              <p className="model-download__error-title">{error.userMessage}</p>
              <p className="model-download__error-detail">{error.detail}</p>
              <button
                type="button"
                className="model-download__details-toggle"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
              >
                {detailsOpen ? 'Hide details' : 'Details'}
              </button>
              {detailsOpen && (
                <details open className="model-download__details">
                  <summary className="sr-only">Technical details</summary>
                  <dl>
                    <dt>Model</dt>
                    <dd>{modelId}</dd>
                    <dt>Error</dt>
                    <dd>{error.technicalMessage || 'No error details were provided.'}</dd>
                  </dl>
                </details>
              )}
            </div>
          )}

          {status !== 'confirm' && (
            <div className="model-download__actions">
              <button type="button" className="button button--ghost" onClick={handleCancel}>
                {status === 'ready' || status === 'cancelled' || status === 'error'
                  ? 'Close'
                  : 'Cancel'}
              </button>
              {status === 'error' && error?.retryable !== false && (
                <button type="button" className="button button--primary" onClick={handleDownload}>
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  );
}
