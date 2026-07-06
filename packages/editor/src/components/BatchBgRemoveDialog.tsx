/**
 * BatchBgRemoveDialog — full-screen modal for batch background removal.
 *
 * Three-stage workflow (select -> processing -> results):
 * - Select: method picker + file list with thumbnail previews
 * - Processing: per-file progress with error isolation
 * - Results: summary with retry for failed items
 */

import { getImageCache, removeBackground } from '@strata/engine';
import type {
  BackgroundRemovalMethod,
  BackgroundRemovalState,
  ImageNode,
  NodeId,
  SceneNode,
} from '@strata/scene';
import { shapeHeight, shapeWidth } from '@strata/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './BatchBgRemoveDialog.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type BgStage = 'select' | 'processing' | 'results';

type FileStatus = 'queued' | 'processing' | 'done' | 'error' | 'skipped';

interface ProcessingFile {
  id: NodeId;
  name: string;
  src: string;
  w: number;
  h: number;
  status: FileStatus;
  error?: string;
}

export interface BatchBgRemoveDialogProps {
  open: boolean;
  onClose: () => void;
  nodes: SceneNode[];
  onNodeUpdate: (id: NodeId, state: BackgroundRemovalState) => void;
}

const METHOD_OPTIONS: { value: BackgroundRemovalMethod; label: string; desc: string }[] = [
  { value: 'quick', label: 'Quick', desc: 'Fast heuristic, best for simple backgrounds' },
  { value: 'ai-balanced', label: 'AI Balanced', desc: 'Good quality with moderate speed' },
  { value: 'ai-quality', label: 'AI Quality', desc: 'Best quality, handles complex edges' },
];

// ── Helper ────────────────────────────────────────────────────────────────────

function nodeToFile(node: SceneNode): ProcessingFile | null {
  // Traditional image node
  if (node.kind === 'image') {
    const img = node as ImageNode;
    return { id: img.id, name: img.name, src: img.src, w: img.w, h: img.h, status: 'queued' };
  }
  // Shape node with an image fill (e.g., pasted from clipboard)
  if (node.kind === 'shape') {
    const imageFill = node.fills?.find((f) => f.type === 'image' && !!f.image?.src);
    if (!imageFill?.image?.src) return null;
    const w = shapeWidth(node.shape);
    const h = shapeHeight(node.shape);
    return { id: node.id, name: node.name, src: imageFill.image.src, w: w || 200, h: h || 200, status: 'queued' };
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BatchBgRemoveDialog({
  open,
  onClose,
  nodes,
  onNodeUpdate,
}: BatchBgRemoveDialogProps) {
  const [stage, setStage] = useState<BgStage>('select');
  const [method, setMethod] = useState<BackgroundRemovalMethod>('ai-balanced');
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [progress, setProgress] = useState(0);
  const cancelledRef = useRef(false);
  const [announceMsg, setAnnounceMsg] = useState('');

  const imageNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          n.kind === 'image' ||
          (n.kind === 'shape' && !!n.fills?.some((f) => f.type === 'image' && !!f.image?.src)),
      ),
    [nodes],
  );

  useEffect(() => {
    if (open) {
      setStage('select');
      setMethod('ai-balanced');
      setFiles(imageNodes.map(nodeToFile).filter((f): f is ProcessingFile => f !== null));
      setProgress(0);
      cancelledRef.current = false;
      setAnnounceMsg('');
    }
  }, [open, imageNodes]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage]);

  const handleClose = useCallback(() => {
    cancelledRef.current = true;
    setStage('select');
    setFiles([]);
    setProgress(0);
    setAnnounceMsg('');
    onClose();
  }, [onClose]);

  const updateFileStatus = useCallback((id: NodeId, status: FileStatus, error?: string) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status, error } : f)));
  }, []);

  const runFile = useCallback(
    async (file: ProcessingFile): Promise<'done' | 'error'> => {
      const cache = getImageCache();

      let img: HTMLImageElement;
      try {
        img = await cache.load(file.src);
      } catch (err) {
        updateFileStatus(file.id, 'error', `Failed to load image: ${err}`);
        return 'error';
      }

      const canvas = document.createElement('canvas');
      canvas.width = file.w;
      canvas.height = file.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        updateFileStatus(file.id, 'error', 'Canvas not available');
        return 'error';
      }
      ctx.drawImage(img, 0, 0, file.w, file.h);

      let imageData: ImageData;
      try {
        imageData = ctx.getImageData(0, 0, file.w, file.h);
      } catch (err) {
        updateFileStatus(file.id, 'error', `Failed to read pixels: ${err}`);
        return 'error';
      }

      let result: import('@strata/engine').BackgroundRemovalResult;
      try {
        result = await removeBackground(imageData, {
          method,
          feather: 2,
          smooth: 1,
          decontaminate: true,
        });
      } catch (err) {
        updateFileStatus(file.id, 'error', `Background removal failed: ${err}`);
        return 'error';
      }

      const state: BackgroundRemovalState = {
        maskDataUrl: result.maskDataUrl,
        method,
        confidence: result.confidence,
        appliedAt: Date.now(),
        feather: 2,
        decontaminate: true,
      };
      try {
        onNodeUpdate(file.id, state);
        updateFileStatus(file.id, 'done');
        return 'done';
      } catch (err) {
        updateFileStatus(file.id, 'error', `Failed to apply result: ${err}`);
        return 'error';
      }
    },
    [method, onNodeUpdate, updateFileStatus],
  );

  const handleStart = useCallback(async () => {
    const filtered = files.map((f) => {
      const node = nodes.find((n) => n.id === f.id);
      if ((node as ImageNode | undefined)?.backgroundRemoval) return { ...f, status: 'skipped' as const };
      return f;
    });

    setFiles(filtered);
    setStage('processing');
    cancelledRef.current = false;

    let done = 0;
    let failed = 0;
    let skipped = 0;
    const total = filtered.length;

    for (let i = 0; i < filtered.length; i++) {
      if (cancelledRef.current) break;

      const f = filtered[i]!;
      if (f.status === 'skipped') {
        skipped++;
        setProgress(i + 1);
        continue;
      }

      updateFileStatus(f.id, 'processing');
      setProgress(i);
      setAnnounceMsg(`Processing file ${i + 1} of ${total}: ${f.name}`);

      // eslint-disable-next-line no-await-in-loop
      const result = await runFile(f);

      if (result === 'done') {
        done++;
      } else {
        failed++;
      }
      setProgress(i + 1);
    }

    if (!cancelledRef.current) {
      setProgress(total);
      setAnnounceMsg(
        `Background removal complete: ${done} succeeded, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ''}`,
      );
      setStage('results');
    }
  }, [files, nodes, runFile, updateFileStatus]);

  const handleRetry = useCallback(
    async (id: NodeId) => {
      const file = files.find((f) => f.id === id);
      if (!file) return;

      updateFileStatus(id, 'processing');
      setAnnounceMsg(`Retrying: ${file.name}`);

      const result = await runFile(file);

      if (result === 'done') {
        setAnnounceMsg(`Retry succeeded: ${file.name}`);
      } else {
        setAnnounceMsg(`Retry failed: ${file.name}`);
      }
    },
    [files, runFile, updateFileStatus],
  );

  const canStart =
    files.length > 0 && files.some((f) => f.status === 'queued' || f.status === 'error');
  const doneCount = files.filter((f) => f.status === 'done').length;
  const failedCount = files.filter((f) => f.status === 'error').length;
  const skippedCount = files.filter((f) => f.status === 'skipped').length;

  if (!open) return null;

  return (
    <div
      className="batch-bg-remove-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Batch background removal"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="batch-bg-remove">
        <div className="batch-bg-remove__header">
          <h2 className="batch-bg-remove__title">Remove background</h2>
          <button
            type="button"
            className="batch-bg-remove__close"
            aria-label="Close"
            onClick={handleClose}
            disabled={stage === 'processing'}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {stage === 'select' && (
          <>
            <div className="batch-bg-remove__body">
              {imageNodes.length === 0 ? (
                <div className="batch-bg-remove__empty">
                  <p className="batch-bg-remove__empty-text">
                    No image nodes selected. Select one or more image layers to remove their
                    background.
                  </p>
                </div>
              ) : (
                <>
                  <section className="batch-bg-remove__section" aria-label="Method">
                    <h3 className="batch-bg-remove__section-title">Method</h3>
                    <div
                      className="batch-bg-remove__method-list"
                      role="radiogroup"
                      aria-label="Background removal method"
                    >
                      {METHOD_OPTIONS.map((opt) => (
                        <label
                          key={opt.value}
                          className={`batch-bg-remove__method-item ${method === opt.value ? 'batch-bg-remove__method-item--active' : ''}`}
                        >
                          <input
                            type="radio"
                            name="bg-remove-method"
                            value={opt.value}
                            checked={method === opt.value}
                            onChange={() => setMethod(opt.value)}
                            className="batch-bg-remove__method-radio"
                          />
                          <span className="batch-bg-remove__method-label">{opt.label}</span>
                          <span className="batch-bg-remove__method-desc">{opt.desc}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                  <section className="batch-bg-remove__section" aria-label="Files">
                    <h3 className="batch-bg-remove__section-title">
                      {files.length} image{files.length !== 1 ? 's' : ''} selected
                    </h3>
                    <div className="batch-bg-remove__file-list">
                      {files.map((f) => (
                        <div key={f.id} className="batch-bg-remove__file-row">
                          <div className="batch-bg-remove__file-thumb">
                            <Thumbnail src={f.src} w={f.w} h={f.h} />
                          </div>
                          <span className="batch-bg-remove__file-name">{f.name}</span>
                          <StatusBadge status={f.status} />
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>

            <div className="batch-bg-remove__footer">
              <button
                type="button"
                className="batch-bg-remove__btn batch-bg-remove__btn--secondary"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="batch-bg-remove__btn batch-bg-remove__btn--primary"
                disabled={!canStart}
                onClick={handleStart}
              >
                Remove background{files.length > 0 ? ` (${files.length})` : ''}
              </button>
            </div>
          </>
        )}

        {stage === 'processing' && (
          <>
            <div className="batch-bg-remove__body">
              <div className="batch-bg-remove__progress">
                <div className="batch-bg-remove__progress-bar">
                  <div
                    className="batch-bg-remove__progress-fill"
                    style={{ width: `${files.length > 0 ? (progress / files.length) * 100 : 0}%` }}
                  />
                </div>
                <p className="batch-bg-remove__progress-text">
                  Processing file {Math.min(progress + 1, files.length)} of {files.length}
                </p>
              </div>

              <div className="batch-bg-remove__file-list">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className={`batch-bg-remove__file-row batch-bg-remove__file-row--${f.status}`}
                  >
                    <div className="batch-bg-remove__file-thumb">
                      <Thumbnail src={f.src} w={f.w} h={f.h} />
                    </div>
                    <span className="batch-bg-remove__file-name">{f.name}</span>
                    <StatusBadge status={f.status} />
                  </div>
                ))}
              </div>
            </div>

            <div className="batch-bg-remove__footer">
              <button
                type="button"
                className="batch-bg-remove__btn batch-bg-remove__btn--secondary"
                onClick={handleClose}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {stage === 'results' && (
          <>
            <div className="batch-bg-remove__body">
              <div className="batch-bg-remove__results-summary">
                <span className="batch-bg-remove__results-count">
                  <span className="batch-bg-remove__results-success">{doneCount} succeeded</span>
                  {failedCount > 0 && (
                    <>
                      <span className="batch-bg-remove__results-sep">, </span>
                      <span className="batch-bg-remove__results-fail">{failedCount} failed</span>
                    </>
                  )}
                  {skippedCount > 0 && (
                    <>
                      <span className="batch-bg-remove__results-sep">, </span>
                      <span className="batch-bg-remove__results-skipped">
                        {skippedCount} skipped
                      </span>
                    </>
                  )}
                </span>
              </div>

              <div className="batch-bg-remove__file-list">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className={`batch-bg-remove__file-row batch-bg-remove__file-row--${f.status}`}
                  >
                    <div className="batch-bg-remove__file-thumb">
                      <Thumbnail src={f.src} w={f.w} h={f.h} />
                    </div>
                    <span className="batch-bg-remove__file-name">{f.name}</span>
                    <StatusBadge status={f.status} />
                    {f.status === 'error' && (
                      <button
                        type="button"
                        className="batch-bg-remove__retry-btn"
                        onClick={() => handleRetry(f.id)}
                        aria-label={`Retry ${f.name}`}
                      >
                        Retry
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="batch-bg-remove__footer">
              <button
                type="button"
                className="batch-bg-remove__btn batch-bg-remove__btn--primary"
                onClick={handleClose}
              >
                Done
              </button>
            </div>
          </>
        )}

        <div role="status" aria-live="polite" className="strata-visually-hidden">
          {announceMsg}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Thumbnail({ src, w, h }: { src: string; w: number; h: number }) {
  return (
    <img
      className="batch-bg-remove__thumb-img"
      src={src}
      alt=""
      width={28}
      height={(28 / w) * h}
      loading="lazy"
    />
  );
}

function StatusBadge({ status }: { status: FileStatus }) {
  const label =
    status === 'queued'
      ? 'Queued'
      : status === 'processing'
        ? 'Processing\u2026'
        : status === 'done'
          ? 'Done'
          : status === 'skipped'
            ? 'Already processed'
            : 'Failed';

  return (
    <span className={`batch-bg-remove__status-badge batch-bg-remove__status-badge--${status}`}>
      {label}
    </span>
  );
}
