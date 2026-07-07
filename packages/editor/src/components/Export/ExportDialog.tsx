/**
 * Export dialog — full-screen modal for batch export management.
 *
 * Shows all nodes with enabled presets as export jobs, progress tracking,
 * destination configuration, and cancellation support.
 */

import {
  timelineToCSSKeyframes,
  timelineToLottieJSON,
  timelineToSVGAnimations,
} from '@strata/codegen';
import {
  checkVideoExportSupport,
  computeVideoFrameCount,
  getModelLoaderReady,
  workerModelIdForMethod,
} from '@strata/engine';
import { prefersReducedMotion } from '@strata/prototype';
import type {
  BackgroundRemovalMethod,
  BackgroundRemovalState,
  Document,
  ExportBatch,
  ExportJob,
  ExportPreset,
  ExportScale,
  NodeId,
  SceneNode,
  ShapeNode,
  Timeline,
} from '@strata/scene';
import { imageShapeH, imageShapeSrc, imageShapeW, isImageShape } from '@strata/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createVideoFrameRenderer } from '../../motion/videoExportBridge';
import type { ExportReport } from '../../exportService';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';
import { BatchJobList } from './BatchJobList';
import { DestinationPicker } from './DestinationPicker';
import { ExportProgressBar } from './ExportProgressBar';

import './ExportDialog.css';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: SceneNode[];
  document?: Document;
  timelines?: Record<string, Timeline>;
  onExport: (batch: ExportBatch) => Promise<ExportReport | void>;
  onPackageExport?: () => Promise<void>;
  onApplyBackgroundRemoval?: (nodeId: NodeId, state: BackgroundRemovalState) => void;
  onExportMotion?: (format: 'css' | 'lottie' | 'svg', fileName: string, content: string) => void;
  onSaveVideoFile?: (fileName: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  selectionIds?: NodeId[];
  initialTemplate?: string;
}

const BG_METHOD_OPTIONS: { value: BackgroundRemovalMethod; label: string }[] = [
  { value: 'quick', label: 'Quick' },
  { value: 'ai-balanced', label: 'AI Balanced' },
  { value: 'ai-quality', label: 'AI Quality' },
];

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'export';
}

function nodeBaseDimensions(node: SceneNode): { w: number; h: number } {
  if (node.kind === 'frame') {
    return { w: Math.max(1, node.w), h: Math.max(1, node.h) };
  }
  if (node.kind === 'text') {
    return {
      w: Math.max(1, node.text.length * node.fontSize * 0.6),
      h: Math.max(1, node.fontSize * 1.4),
    };
  }
  if (node.kind !== 'shape') return { w: 200, h: 160 };
  if (node.fills?.some((f) => f.type === 'image' && !!f.image?.src)) {
    return { w: Math.max(1, imageShapeW(node)), h: Math.max(1, imageShapeH(node)) };
  }

  switch (node.shape.kind) {
    case 'rect':
      return { w: Math.max(1, node.shape.w), h: Math.max(1, node.shape.h) };
    case 'ellipse':
      return { w: Math.max(1, node.shape.rx * 2), h: Math.max(1, node.shape.ry * 2) };
    case 'circle': {
      const d = Math.max(1, node.shape.r * 2);
      return { w: d, h: d };
    }
    case 'line':
    case 'arrow':
      return {
        w: Math.max(1, Math.abs(node.shape.to[0] - node.shape.from[0]) + node.shape.tolerance * 2),
        h: Math.max(1, Math.abs(node.shape.to[1] - node.shape.from[1]) + node.shape.tolerance * 2),
      };
    case 'polygon':
      return { w: Math.max(1, node.shape.radius * 2), h: Math.max(1, node.shape.radius * 2) };
    case 'star':
      return {
        w: Math.max(1, node.shape.outerRadius * 2),
        h: Math.max(1, node.shape.outerRadius * 2),
      };
    case 'path': {
      if (node.shape.points.length === 0) return { w: 100, h: 100 };
      const xs = node.shape.points.map((p) => p.x);
      const ys = node.shape.points.map((p) => p.y);
      return {
        w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      };
    }
    default:
      return { w: 100, h: 100 };
  }
}

function scaledDimensions(
  base: { w: number; h: number },
  scale: ExportScale,
): { w: number; h: number } {
  const factor =
    scale.type === 'factor'
      ? scale.value
      : scale.type === 'width'
        ? scale.pixels / base.w
        : scale.pixels / base.h;
  return {
    w: Math.max(1, Math.round(base.w * factor)),
    h: Math.max(1, Math.round(base.h * factor)),
  };
}

function buildJobs(nodes: SceneNode[]): ExportJob[] {
  const jobs: ExportJob[] = [];
  for (const node of nodes) {
    const presets: ExportPreset[] = node.presets ?? [];
    for (const preset of presets) {
      if (!preset.enabled) continue;
      const safeName = safeFilename(node.name);
      const ext = preset.format.startsWith('pdf')
        ? 'pdf'
        : preset.format === 'svg' || preset.format === 'svg-component'
          ? 'svg'
          : preset.format === 'react-tailwind' || preset.format === 'react-cssmodules'
            ? 'tsx'
            : preset.format === 'flutter'
              ? 'dart'
              : preset.format === 'swiftui'
                ? 'swift'
                : preset.format;
      const suffix = preset.suffix ? `-${preset.suffix}` : '';
      const fileName = `${safeName}${suffix}.${ext}`;
      const dimensions = scaledDimensions(nodeBaseDimensions(node), preset.scale);
      jobs.push({
        presetId: preset.id,
        nodeId: node.id,
        nodeName: node.name,
        format: preset.format,
        fileName,
        scale: preset.scale,
        dimensions,
        estimatedSize: 1024 * 50,
        status: 'pending',
      });
    }
  }
  return jobs;
}

export function ExportDialog({
  isOpen,
  onClose,
  nodes,
  document,
  timelines = {},
  onExport,
  onPackageExport,
  onApplyBackgroundRemoval,
  onExportMotion,
  onSaveVideoFile,
  selectionIds = [],
  initialTemplate = '{name}{suffix}.{ext}',
}: ExportDialogProps) {
  const [running, setRunning] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [progress, setProgress] = useState({ done: 0, errors: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState(initialTemplate);
  const [folderRule, setFolderRule] = useState<ExportBatch['folderRule']>('flat');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [removeBgBeforeExport, setRemoveBgBeforeExport] = useState(false);
  const [bgMethod, setBgMethod] = useState<BackgroundRemovalMethod>('quick');
  const [aiAvailable, setAiAvailable] = useState(true);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ done: 0, total: 0 });
  const [videoSupport] = useState(() => checkVideoExportSupport());
  const videoAbortRef = useRef<AbortController | null>(null);

  const requiredModelId = workerModelIdForMethod(bgMethod);

  const timelineList = useMemo(() => Object.values(timelines), [timelines]);

  const nodeNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const node of nodes) {
      names[node.id] = node.name;
    }
    if (document) {
      for (const [id, node] of Object.entries(document.nodes)) {
        names[id] = node.name;
      }
    }
    return names;
  }, [nodes, document]);

  const refreshModelStatus = useCallback(async () => {
    if (bgMethod === 'quick' || !requiredModelId) {
      setAiAvailable(true);
      return;
    }
    const loader = await getModelLoaderReady();
    setAiAvailable(await loader.isModelAvailable(requiredModelId));
  }, [bgMethod, requiredModelId]);

  useEffect(() => {
    if (isOpen) void refreshModelStatus();
  }, [isOpen, refreshModelStatus]);

  const jobs = useMemo(() => buildJobs(nodes), [nodes]);

  useEffect(() => {
    if (isOpen) {
      setRunning(false);
      setProgress({ done: 0, errors: 0 });
      setAnnounceMsg('');
      const allIds = new Set(jobs.map((job) => `${job.nodeId}-${job.presetId}`));
      setSelectedIds(allIds);
    }
  }, [isOpen, jobs]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const handleExport = useCallback(async () => {
    setRunning(true);
    setProgress({ done: 0, errors: 0 });
    const selectedJobs = jobs.filter((job) => selectedIds.has(`${job.nodeId}-${job.presetId}`));

    if (removeBgBeforeExport) {
      if (bgMethod !== 'quick' && !aiAvailable) {
        setAnnounceMsg('Download the AI model first, or switch to Quick mode.');
        setShowDownloadDialog(true);
        setRunning(false);
        return;
      }

      const imageNodes = nodes.filter((n): n is ShapeNode => isImageShape(n));
      const pendingImages = imageNodes.filter((n) => !n.backgroundRemoval);
      if (pendingImages.length > 0 && onApplyBackgroundRemoval) {
        setAnnounceMsg(`Removing background from ${pendingImages.length} image(s)...`);
        const { removeBackground: removeBgFn } = await import('@strata/engine');
        const { getImageCache } = await import('@strata/engine');
        const cache = getImageCache();
        for (const imgNode of pendingImages) {
          try {
            const src = imageShapeSrc(imgNode);
            const w = imageShapeW(imgNode);
            const h = imageShapeH(imgNode);
            const img = await cache.load(src);
            if (!img) continue;
            const c = globalThis.document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const result = await removeBgFn(imageData, {
              method: bgMethod,
              feather: 0.5,
              decontaminate: true,
            });
            if (bgMethod !== 'quick' && result.method === 'quick') {
              setAnnounceMsg(
                'AI model unavailable; used quick heuristic instead. Download the AI model in Settings, Offline Models.',
              );
            }
            onApplyBackgroundRemoval(imgNode.id, {
              maskDataUrl: result.maskDataUrl,
              method: result.method,
              confidence: result.confidence,
              appliedAt: Date.now(),
              feather: 0.5,
              decontaminate: true,
            });
          } catch {
            // continue with export even if bg removal fails
          }
        }
      }
    }

    const batch: ExportBatch = {
      jobs: selectedJobs,
      destinationFolder: destinationLabel || null,
      filenameTemplate: template,
      folderRule,
    };
    try {
      const report = await onExport(batch);
      if (report) {
        setProgress({ done: report.successCount, errors: report.failureCount });
        if (report.failureCount > 0) {
          setAnnounceMsg(
            report.successCount > 0
              ? `Export partially complete: ${report.successCount} exported, ${report.failureCount} failed`
              : `Export failed: ${report.failureCount} of ${report.totalJobs} files failed`,
          );
        } else {
          setAnnounceMsg(`Export complete: ${report.successCount} files exported`);
        }
      } else {
        setProgress({ done: selectedJobs.length, errors: 0 });
        setAnnounceMsg(`Export complete: ${selectedJobs.length} files exported`);
      }
    } catch (err) {
      setProgress({ done: 0, errors: selectedJobs.length });
      const msg = err instanceof Error ? err.message : String(err);
      setAnnounceMsg(`Export failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }, [
    jobs,
    selectedIds,
    onExport,
    destinationLabel,
    template,
    folderRule,
    removeBgBeforeExport,
    nodes,
    onApplyBackgroundRemoval,
    bgMethod,
    aiAvailable,
  ]);

  const handleCancel = useCallback(() => {
    if (videoExporting) {
      videoAbortRef.current?.abort();
      setVideoExporting(false);
      setVideoProgress({ done: 0, total: 0 });
      setAnnounceMsg('Video export cancelled');
      return;
    }
    setRunning(false);
    setProgress({ done: 0, errors: 0 });
    setAnnounceMsg('Export cancelled');
  }, [videoExporting]);

  const handlePackageExport = useCallback(async () => {
    if (!onPackageExport) return;
    setPackaging(true);
    setAnnounceMsg('Packaging document...');
    try {
      await onPackageExport();
      setAnnounceMsg('Package export complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAnnounceMsg(`Package export failed: ${msg}`);
    } finally {
      setPackaging(false);
    }
  }, [onPackageExport]);

  const handleVideoExport = useCallback(
    async (tl: Timeline, format: 'mp4' | 'webm') => {
      if (!document || !onSaveVideoFile) return;
      if (!videoSupport.supported) {
        setAnnounceMsg(videoSupport.reason ?? 'Video export unavailable in this browser');
        return;
      }

      const reducedMotion = prefersReducedMotion();
      const width = document.canvasWidth ?? 1920;
      const height = document.canvasHeight ?? 1080;
      const fps = 30;
      const totalFrames = computeVideoFrameCount(tl.duration, fps, reducedMotion);

      videoAbortRef.current?.abort();
      const controller = new AbortController();
      videoAbortRef.current = controller;

      setVideoExporting(true);
      setVideoProgress({ done: 0, total: totalFrames });
      setAnnounceMsg(`Exporting ${tl.name} as ${format.toUpperCase()}...`);

      try {
        const { renderFrame } = await createVideoFrameRenderer({
          doc: document,
          timeline: tl,
          options: {
            width,
            height,
            boundsMode: 'canvas',
            selectionIds,
            pageContentRoot: document.pages?.find((p) => p.id === document.activePageId)
              ?.contentRoot,
          },
        });

        const { exportTimelineToVideo } = await import('@strata/engine');
        const result = await exportTimelineToVideo(
          { id: tl.id, duration: tl.duration },
          {
            width,
            height,
            fps,
            codec: format === 'mp4' ? 'h264' : 'vp9',
            reducedMotion,
            signal: controller.signal,
            onProgress: (done, total) => setVideoProgress({ done, total }),
          },
          renderFrame,
        );

        if (controller.signal.aborted) return;

        if (!result.bytes) {
          setAnnounceMsg(result.reason ?? 'Video export failed');
          return;
        }

        const ext = result.mimeType?.includes('webm') ? 'webm' : 'mp4';
        const mime = result.mimeType ?? (ext === 'webm' ? 'video/webm' : 'video/mp4');
        await onSaveVideoFile(`${safeFilename(tl.name)}.${ext}`, result.bytes, mime);
        setAnnounceMsg(`Video export complete: ${tl.name}.${ext}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAnnounceMsg(`Video export failed: ${msg}`);
      } finally {
        setVideoExporting(false);
        videoAbortRef.current = null;
      }
    },
    [document, onSaveVideoFile, selectionIds, videoSupport],
  );

  const handleToggleJob = useCallback((jobKey: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobKey)) next.delete(jobKey);
      else next.add(jobKey);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allIds = new Set(jobs.map((job) => `${job.nodeId}-${job.presetId}`));
      return prev.size === jobs.length ? new Set() : allIds;
    });
  }, [jobs]);

  const handleSelectDestination = useCallback(() => {
    setDestinationLabel('/exports');
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="export-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="export-dialog">
        <div className="export-dialog__header">
          <h2 className="export-dialog__title">Export</h2>
          <button
            type="button"
            className="export-dialog__close"
            aria-label="Close"
            onClick={onClose}
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

        <div className="export-dialog__body">
          <section className="export-dialog__section" aria-label="Jobs">
            <h3 className="export-dialog__section-title">Files to export</h3>
            <BatchJobList
              jobs={jobs}
              selectedIds={selectedIds}
              onToggleJob={handleToggleJob}
              onToggleAll={handleToggleAll}
            />
          </section>

          <section className="export-dialog__section" aria-label="Destination">
            <h3 className="export-dialog__section-title">Destination</h3>
            <DestinationPicker
              template={template}
              folderRule={folderRule}
              jobs={jobs}
              onTemplateChange={setTemplate}
              onFolderRuleChange={setFolderRule}
              onSelectDestination={handleSelectDestination}
              destinationLabel={destinationLabel}
            />
          </section>

          <section className="export-dialog__section" aria-label="Background">
            <h3 className="export-dialog__section-title">Background</h3>
            <label className="export-dialog__checkbox-label">
              <input
                type="checkbox"
                checked={removeBgBeforeExport}
                onChange={(e) => setRemoveBgBeforeExport(e.target.checked)}
              />
              <span>Remove background before export</span>
            </label>
            {removeBgBeforeExport && (
              <div className="export-dialog__bg-method">
                <label htmlFor="export-bg-method">Method</label>
                <select
                  id="export-bg-method"
                  value={bgMethod}
                  aria-label="Background removal method for export"
                  onChange={(e) => {
                    const next = e.target.value as BackgroundRemovalMethod;
                    setBgMethod(next);
                    void (async () => {
                      if (next === 'quick') {
                        setAiAvailable(true);
                        return;
                      }
                      const modelId = workerModelIdForMethod(next);
                      if (!modelId) {
                        setAiAvailable(true);
                        return;
                      }
                      const loader = await getModelLoaderReady();
                      setAiAvailable(await loader.isModelAvailable(modelId));
                    })();
                  }}
                >
                  {BG_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                      {opt.value !== 'quick' && !aiAvailable ? ' (download required)' : ''}
                    </option>
                  ))}
                </select>
                {bgMethod !== 'quick' && !aiAvailable && (
                  <button
                    type="button"
                    className="export-dialog__btn export-dialog__btn--secondary"
                    onClick={() => setShowDownloadDialog(true)}
                  >
                    Download AI Model
                  </button>
                )}
              </div>
            )}
            {removeBgBeforeExport &&
              (() => {
                const imageCount = nodes.filter(
                  (n) => isImageShape(n) && !(n as ShapeNode).backgroundRemoval,
                ).length;
                return imageCount > 0 ? (
                  <p className="export-dialog__note">
                    Background removal will be applied to {imageCount} image
                    {imageCount !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="export-dialog__note">All images already have background removal</p>
                );
              })()}
          </section>

          {timelineList.length > 0 && (onExportMotion || onSaveVideoFile) && (
            <section className="export-dialog__section" aria-label="Motion export">
              <h3 className="export-dialog__section-title">Motion Export</h3>
              <p className="export-dialog__note">
                Export document timelines as CSS keyframes, Lottie JSON, or video (WebCodecs;
                Chromium recommended).
              </p>
              {!videoSupport.supported && onSaveVideoFile && (
                <p className="export-dialog__note export-dialog__note--warn" role="status">
                  Video export unavailable: {videoSupport.reason}
                </p>
              )}
              <div className="export-dialog__motion-actions">
                {timelineList.map((tl) => (
                  <div key={tl.id} className="export-dialog__motion-row">
                    <span>{tl.name}</span>
                    {onExportMotion && (
                      <>
                        <button
                          type="button"
                          className="export-dialog__btn export-dialog__btn--secondary"
                          disabled={videoExporting || running}
                          onClick={() => {
                            const css = timelineToCSSKeyframes(tl, nodeNames);
                            onExportMotion('css', `${tl.name}.css`, css);
                          }}
                        >
                          CSS
                        </button>
                        <button
                          type="button"
                          className="export-dialog__btn export-dialog__btn--secondary"
                          disabled={videoExporting || running}
                          onClick={() => {
                            const lottieDocument =
                              document ?? ({ nodes: nodeNames } as unknown as Document);
                            const json = timelineToLottieJSON(tl, lottieDocument);
                            onExportMotion('lottie', `${tl.name}.json`, json);
                          }}
                        >
                          Lottie
                        </button>
                        <button
                          type="button"
                          className="export-dialog__btn export-dialog__btn--secondary"
                          disabled={videoExporting || running}
                          onClick={() => {
                            const svg = timelineToSVGAnimations(tl, nodeNames);
                            onExportMotion('svg', `${tl.name}.svg`, svg);
                          }}
                        >
                          SVG
                        </button>
                      </>
                    )}
                    {onSaveVideoFile && (
                      <>
                        <button
                          type="button"
                          className="export-dialog__btn export-dialog__btn--secondary"
                          disabled={videoExporting || running || !videoSupport.supported}
                          aria-label={`Export ${tl.name} as MP4`}
                          onClick={() => void handleVideoExport(tl, 'mp4')}
                        >
                          MP4
                        </button>
                        <button
                          type="button"
                          className="export-dialog__btn export-dialog__btn--secondary"
                          disabled={videoExporting || running || !videoSupport.supported}
                          aria-label={`Export ${tl.name} as WebM`}
                          onClick={() => void handleVideoExport(tl, 'webm')}
                        >
                          WebM
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {videoExporting && (
                <ExportProgressBar
                  total={videoProgress.total}
                  done={videoProgress.done}
                  errors={0}
                  running={videoExporting}
                  onCancel={handleCancel}
                />
              )}
            </section>
          )}

          {(running || progress.done > 0 || progress.errors > 0) && (
            <section className="export-dialog__section" aria-label="Progress">
              <h3 className="export-dialog__section-title">Progress</h3>
              <ExportProgressBar
                total={selectedIds.size}
                done={progress.done}
                errors={progress.errors}
                running={running}
                onCancel={handleCancel}
              />
            </section>
          )}
        </div>

        <div className="export-dialog__footer">
          <button
            type="button"
            className="export-dialog__btn export-dialog__btn--secondary"
            onClick={onClose}
            disabled={running || videoExporting || packaging}
          >
            Close
          </button>
          {onPackageExport && (
            <button
              type="button"
              className="export-dialog__btn export-dialog__btn--secondary"
              onClick={handlePackageExport}
              disabled={running || videoExporting || packaging}
            >
              {packaging ? 'Packaging...' : 'Package'}
            </button>
          )}
          <button
            type="button"
            className="export-dialog__btn export-dialog__btn--primary"
            onClick={handleExport}
            disabled={running || packaging || selectedIds.size === 0}
          >
            {running ? 'Exporting\u2026' : `Export (${selectedIds.size})`}
          </button>
        </div>

        <div role="status" aria-live="polite" className="strata-visually-hidden">
          {announceMsg}
        </div>

        {showDownloadDialog && (
          <ModelDownloadDialog
            modelId={bgMethod === 'ai-quality' ? 'birefnet-general' : 'birefnet-general-lite'}
            onClose={() => setShowDownloadDialog(false)}
            onComplete={() => {
              setShowDownloadDialog(false);
              void refreshModelStatus();
            }}
          />
        )}
      </div>
    </div>
  );
}
