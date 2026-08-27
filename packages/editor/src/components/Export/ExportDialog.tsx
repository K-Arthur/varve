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
} from '@varve/codegen';
import {
  checkGifExportSupport,
  checkVideoExportSupport,
  computeVideoFrameCount,
  getModelLoaderReady,
  workerModelIdForMethod,
} from '@varve/engine';
import { prefersReducedMotion } from '@varve/prototype';
import type {
  BackgroundRemovalMethod,
  BackgroundRemovalState,
  Document,
  ExportBatch,
  ExportJob,
  ExportPreset,
  ExportScale,
  NodeId,
  PrintOptions,
  SceneNode,
  ShapeNode,
  Timeline,
} from '@varve/scene';
import {
  documentBleedMm,
  imageShapeH,
  imageShapeSrc,
  imageShapeW,
  isImageShape,
  pageBleedMm,
  textNodeLocalBounds,
} from '@varve/scene';
import {
  buildExportPlan,
  createExportConfiguration,
  type ExportBatchRequest,
  type ExportFinding,
  formatFileName,
  legacyFormatToCanonical,
  legacyPresetsToConfigurations,
  legacyScaleToCanonical,
  type PlatformKind,
} from '@varve/scene/export';
import { FocusTrap, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { estimateExportBytes } from '../../export/estimateSize';
import { applyExportBatchPaths } from '../../exportBatchPaths';
import {
  type ExportProgressEvent,
  type ExportReport,
  runBatchPreflight,
} from '../../exportService';
import { LIFECYCLE_COMMIT_EVENT } from '../../lifecycle';
import { createVideoFrameRenderer } from '../../motion/videoExportBridge';
import { loadSettings } from '../../settings';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';
import { confirmDialog } from '../PromptDialog';
import { BatchJobList } from './BatchJobList';
import { DestinationPicker } from './DestinationPicker';
import { ExportProgressBar } from './ExportProgressBar';
import { ExportResultsList } from './ExportResultsList';
import { OutputResolutionPanel } from './OutputResolutionPanel';
import { PreflightFindingsPanel } from './PreflightFindingsPanel';
import { PrintSettingsPanel } from './PrintSettingsPanel';

import './ExportDialog.css';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: SceneNode[];
  document?: Document;
  timelines?: Record<string, Timeline>;
  onExport: (
    batch: ExportBatch,
    signal?: AbortSignal,
    onProgress?: (event: ExportProgressEvent) => void,
  ) => Promise<ExportReport | undefined>;
  onPackageExport?: () => Promise<void>;
  onApplyBackgroundRemoval?: (nodeId: NodeId, state: BackgroundRemovalState) => void;
  onExportMotion?: (format: 'css' | 'lottie' | 'svg', fileName: string, content: string) => void;
  onSaveVideoFile?: (fileName: string, bytes: Uint8Array, mimeType: string) => Promise<void>;
  selectionIds?: NodeId[];
  initialTemplate?: string;
  /** Active platform; drives capability-gated preflight and destination hints. */
  platformKind?: PlatformKind;
  /** Native desktop folder picker. Browser batches use one ZIP destination. */
  onSelectDestination?: () => Promise<string | null>;
  /** Native file-manager integration for completed outputs. */
  onRevealOutput?: (path: string) => Promise<void>;
  revealOutputLabel?: string;
}

function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/[\p{Control}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || 'export'
  );
}

function nodeBaseDimensions(node: SceneNode): { w: number; h: number } {
  if (node.kind === 'frame') {
    return { w: Math.max(1, node.w), h: Math.max(1, node.h) };
  }
  if (node.kind === 'text') {
    const bounds = textNodeLocalBounds(node);
    return { w: Math.max(1, bounds.w), h: Math.max(1, bounds.h) };
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
        : scale.type === 'height'
          ? scale.pixels / base.h
          : scale.dpi / 96;
  return {
    w: Math.max(1, Math.round(base.w * factor)),
    h: Math.max(1, Math.round(base.h * factor)),
  };
}

export function buildJobs(nodes: SceneNode[], document?: Document): ExportJob[] {
  const jobs: ExportJob[] = [];
  for (const node of nodes) {
    const presets: ExportPreset[] = node.presets ?? [];
    if (presets.length === 0) continue;

    // Resolve names and dimensions through the canonical plan so the batch
    // dialog matches the inspector's naming preview (single source of truth).
    const configurations = legacyPresetsToConfigurations(node.id, presets);
    const request: ExportBatchRequest = {
      id: `dialog-${node.id}`,
      configurations,
      conflictPolicy: 'rename',
      failurePolicy: 'continue',
      createdAt: Date.now(),
      createdBy: 'export-dialog',
    };
    const plan = document ? buildExportPlan(document, request, { document }) : null;
    const planByConfig = new Map(plan?.items.map((item) => [item.configurationId, item]) ?? []);

    for (const preset of presets) {
      if (!preset.enabled) continue;
      const planItem = planByConfig.get(preset.id);
      const format = legacyFormatToCanonical(preset.format);
      const fileName =
        planItem?.relativePath ??
        formatFileName('{name}{suffix}.{ext}', {
          name: node.name,
          format,
          scale: legacyScaleToCanonical(preset.scale),
          suffix: preset.suffix || undefined,
        });
      const dimensions = planItem
        ? { w: planItem.resolvedDimensions.width, h: planItem.resolvedDimensions.height }
        : scaledDimensions(nodeBaseDimensions(node), preset.scale);
      jobs.push({
        presetId: preset.id,
        nodeId: node.id,
        nodeName: node.name,
        format: preset.format,
        fileName,
        scale: preset.scale,
        suffix: preset.suffix,
        raster: preset.raster,
        vector: preset.vector,
        code: preset.code,
        print: preset.print,
        dimensions,
        outputPpi: planItem?.outputResolutionPpi,
        estimatedSize: estimateExportBytes(dimensions.w, dimensions.h, format),
        status: 'pending',
      });
    }
  }
  return jobs;
}

function isPdfXFormat(format: ExportJob['format']): boolean {
  return format === 'pdf-x1a' || format === 'pdf-x4';
}

function isRasterExportFormat(format: ExportJob['format']): boolean {
  return format === 'png' || format === 'jpg' || format === 'webp';
}

function buildSelectedJobs(jobs: ExportJob[], selectedIds: Set<string>): ExportJob[] {
  return jobs.filter((job) => selectedIds.has(`${job.nodeId}-${job.presetId}`));
}

/**
 * Build the batch that will actually be executed: selected jobs with press
 * settings attached to PDF/X jobs. This is a pure transform — no side effects.
 */
function buildBatchForExport(
  selectedJobs: ExportJob[],
  template: string,
  folderRule: ExportBatch['folderRule'],
  destination: string | null,
  printSettings: PrintOptions,
  document: Document | undefined,
  resolutionOverride: number | null,
): ExportBatch {
  const jobsWithPrint = selectedJobs.map((job) => {
    const withPrint = isPdfXFormat(job.format) ? { ...job, print: printSettings } : job;
    if (!document || resolutionOverride === null || !isRasterExportFormat(job.format)) {
      return withPrint;
    }

    const configuration = createExportConfiguration({
      id: job.presetId,
      target: { type: 'node', nodeId: job.nodeId },
      format: legacyFormatToCanonical(job.format),
      scale: { mode: 'resolution', dpi: resolutionOverride },
      enabled: true,
    });
    const plan = buildExportPlan(
      document,
      {
        id: `batch-resolution-${job.presetId}`,
        configurations: [configuration],
        conflictPolicy: 'rename',
        failurePolicy: 'continue',
        createdAt: Date.now(),
        createdBy: 'export-dialog',
      },
      { document },
    );
    const item = plan.items[0];
    if (!item) return withPrint;
    return {
      ...withPrint,
      scale: { type: 'resolution', dpi: resolutionOverride } as const,
      outputPpi: item.outputResolutionPpi ?? resolutionOverride,
      dimensions: {
        w: item.resolvedDimensions.width,
        h: item.resolvedDimensions.height,
      },
    };
  });
  const jobs = applyExportBatchPaths(jobsWithPrint, template, folderRule);
  return {
    jobs,
    destinationFolder: destination,
    filenameTemplate: template,
    folderRule,
  };
}

function preflightFindings(
  batch: ExportBatch,
  document: Document | undefined,
  platformKind: PlatformKind,
): ExportFinding[] {
  if (!document || batch.jobs.length === 0) return [];
  return runBatchPreflight(batch, document, platformKind);
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
  initialTemplate = loadSettings().export.defaultFilenameTemplate,
  platformKind = 'web',
  onSelectDestination,
  onRevealOutput,
  revealOutputLabel,
}: ExportDialogProps) {
  const [running, setRunning] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [progress, setProgress] = useState({ done: 0, errors: 0 });
  const [progressDetail, setProgressDetail] = useState<
    Pick<ExportProgressEvent, 'stage' | 'currentFile'>
  >({ stage: 'preflight' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState(initialTemplate);

  // F-32: silent sanitization was the only signal for a useless filename
  // template; surface it inline instead of shipping "export" quietly.
  const templateError = useMemo(() => {
    if (template.trim() === '') return '';
    const stripped = template.replace(/\{(name|suffix|ext)\}/g, 'x');
    const sanitized = stripped.replace(/[^a-zA-Z0-9-_\s]/g, '').trim();
    if (sanitized === '') {
      return 'Filename template has no usable characters; exports will be named "export".';
    }
    return '';
  }, [template]);
  const [folderRule, setFolderRule] = useState<ExportBatch['folderRule']>('flat');
  const [resolutionOverride, setResolutionOverride] = useState<number | null>(null);
  const [destinationLabel, setDestinationLabel] = useState('');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [removeBgBeforeExport, setRemoveBgBeforeExport] = useState(false);
  const [bgMethod, setBgMethod] = useState<BackgroundRemovalMethod>('quick');
  const [aiAvailable, setAiAvailable] = useState(true);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [videoExporting, setVideoExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState({ done: 0, total: 0 });
  const [lastReport, setLastReport] = useState<ExportReport | null>(null);
  const [printSettings, setPrintSettings] = useState<PrintOptions>(() => {
    const settings = loadSettings().export;
    // Seed the export-job bleed from the document's canonical print
    // geometry when configured (the active page's resolved bleed in mm —
    // page override included), falling back to the app-wide export
    // default. The dialog value is an explicit export-job override of the
    // document value — canvas preview and PDF/X share the same underlying
    // bleed unless the designer changes it here for this export.
    const activePageId = document?.activePageId;
    const docBleedMm =
      document && activePageId
        ? pageBleedMm(document, activePageId)
        : document
          ? documentBleedMm(document)
          : 0;
    return {
      bleedMm: docBleedMm > 0 ? docBleedMm : settings.defaultBleedMm,
      enforceDpi: 300,
      includeCropMarks: true,
      includeRegistrationMarks: false,
      includeColorBars: false,
      outlineText: settings.defaultOutlineText,
      iccProfile: settings.defaultIccProfile,
    };
  });
  const [videoSupport] = useState(() => checkVideoExportSupport());
  const [gifSupport] = useState(() => checkGifExportSupport());
  const videoAbortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const previousFocusRef = useRef<Element | null>(null);

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

  const jobs = useMemo(() => buildJobs(nodes, document), [nodes, document]);

  const selectedJobs = useMemo(() => buildSelectedJobs(jobs, selectedIds), [jobs, selectedIds]);

  const hasPdfXJobs = useMemo(
    () => selectedJobs.some((job) => isPdfXFormat(job.format)),
    [selectedJobs],
  );

  const hasRasterJobs = useMemo(
    () => selectedJobs.some((job) => isRasterExportFormat(job.format)),
    [selectedJobs],
  );

  const exportBatch = useMemo(
    () =>
      buildBatchForExport(
        selectedJobs,
        template,
        folderRule,
        destinationLabel || null,
        printSettings,
        document,
        resolutionOverride,
      ),
    [
      selectedJobs,
      template,
      folderRule,
      destinationLabel,
      printSettings,
      document,
      resolutionOverride,
    ],
  );

  const displayJobs = useMemo(() => {
    const resolved = new Map(
      exportBatch.jobs.map((job) => [`${job.nodeId}-${job.presetId}`, job] as const),
    );
    return jobs.map((job) => resolved.get(`${job.nodeId}-${job.presetId}`) ?? job);
  }, [jobs, exportBatch.jobs]);

  const batchSummary = useMemo(() => {
    if (displayJobs.length === 0) return null;
    const count = displayJobs.length;
    let maxPx = 0;
    let largestW = 0;
    let largestH = 0;
    for (const job of displayJobs) {
      const px = (job.dimensions?.w ?? 0) * (job.dimensions?.h ?? 0);
      if (px > maxPx) {
        maxPx = px;
        largestW = job.dimensions?.w ?? 0;
        largestH = job.dimensions?.h ?? 0;
      }
    }
    return { count, largestW, largestH };
  }, [displayJobs]);

  const findings = useMemo(
    () => preflightFindings(exportBatch, document, platformKind),
    [exportBatch, document, platformKind],
  );

  useEffect(() => {
    if (isOpen) {
      setRunning(false);
      setProgress({ done: 0, errors: 0 });
      setProgressDetail({ stage: 'preflight' });
      setAnnounceMsg('');
      setLastReport(null);
      setResolutionOverride(null);
      const allIds = new Set(jobs.map((job) => `${job.nodeId}-${job.presetId}`));
      setSelectedIds(allIds);
    }
  }, [isOpen, jobs]);

  useEffect(() => {
    // Termination commit cancels in-flight export batches (lifecycle
    // finalizer, ADR-0216 D8): export outputs are not document state.
    function handleLifecycleCommit() {
      batchAbortRef.current?.abort();
      videoAbortRef.current?.abort();
    }
    window.addEventListener(LIFECYCLE_COMMIT_EVENT, handleLifecycleCommit);
    return () => window.removeEventListener(LIFECYCLE_COMMIT_EVENT, handleLifecycleCommit);
  }, []);

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

  // Save focus when dialog opens
  useEffect(() => {
    if (isOpen && typeof document !== 'undefined') {
      try {
        previousFocusRef.current = (
          document as unknown as { activeElement: Element | null }
        ).activeElement;
      } catch {
        /* jsdom may not have activeElement */
      }
    }
  }, [isOpen]);

  const handleExport = useCallback(async () => {
    const blockingErrors = findings.filter((f) => f.severity === 'error');
    if (blockingErrors.length > 0) {
      const proceed = await confirmDialog(
        'Preflight errors found',
        `Preflight found ${blockingErrors.length} error${blockingErrors.length === 1 ? '' : 's'} that may make the exported file${blockingErrors.length === 1 ? '' : 's'} unusable (e.g. missing fonts, out-of-gamut colors). Export anyway?`,
        { confirmLabel: 'Export anyway', variant: 'danger' },
      );
      if (!proceed) return;
    }
    setRunning(true);
    setProgress({ done: 0, errors: 0 });
    setProgressDetail({ stage: 'preflight' });
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
        const { removeBackground: removeBgFn } = await import('@varve/engine');
        const { getImageCache } = await import('@varve/engine');
        const cache = getImageCache();
        for (const imgNode of pendingImages) {
          try {
            const src = imageShapeSrc(imgNode);
            const w = imageShapeW(imgNode);
            const h = imageShapeH(imgNode);
            const img = await cache.load(src);
            if (!img) throw new Error(`Could not load ${imgNode.name}`);
            const c = globalThis.document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) throw new Error('Canvas rendering is unavailable');
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const result = await removeBgFn(imageData, {
              method: bgMethod,
              feather: 0.5,
              decontaminate: true,
            });
            if (bgMethod !== 'quick' && result.method === 'quick') {
              throw new Error('the provider returned a Quick result');
            }
            onApplyBackgroundRemoval(imgNode.id, {
              maskDataUrl: result.maskDataUrl,
              method: result.method,
              confidence: result.confidence,
              appliedAt: Date.now(),
              feather: 0.5,
              decontaminate: true,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setAnnounceMsg(`AI background removal failed: ${message}`);
            setRunning(false);
            return;
          }
        }
      }
    }

    batchAbortRef.current?.abort();
    const controller = new AbortController();
    batchAbortRef.current = controller;
    try {
      const report = await onExport(exportBatch, controller.signal, (event) => {
        setProgress({ done: event.completed, errors: event.failed });
        setProgressDetail({ stage: event.stage, currentFile: event.currentFile });
      });
      if (report) {
        setLastReport(report);
        setProgress({ done: report.successCount, errors: report.failureCount });
        if (controller.signal.aborted) {
          setAnnounceMsg('Export cancelled');
        } else if (report.failureCount > 0) {
          setAnnounceMsg(
            report.successCount > 0
              ? `Export partially complete: ${report.successCount} exported, ${report.failureCount} failed`
              : `Export failed: ${report.failureCount} of ${report.totalJobs} files failed`,
          );
        } else {
          const preflightNote =
            report.findings && report.findings.length > 0
              ? ` (${report.findings.filter((f) => f.severity === 'warning').length} warning${report.findings.filter((f) => f.severity === 'warning').length === 1 ? '' : 's'} from preflight)`
              : '';
          setAnnounceMsg(`Export complete: ${report.successCount} files exported${preflightNote}`);
        }
      } else if (!controller.signal.aborted) {
        setProgress({ done: selectedJobs.length, errors: 0 });
        setAnnounceMsg(`Export complete: ${selectedJobs.length} files exported`);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        setAnnounceMsg('Export cancelled');
      } else {
        setProgress({ done: 0, errors: selectedJobs.length });
        const msg = err instanceof Error ? err.message : String(err);
        setAnnounceMsg(`Export failed: ${msg}`);
      }
    } finally {
      batchAbortRef.current = null;
      setRunning(false);
    }
  }, [
    jobs,
    selectedJobs,
    selectedIds,
    exportBatch,
    onExport,
    destinationLabel,
    template,
    folderRule,
    removeBgBeforeExport,
    nodes,
    onApplyBackgroundRemoval,
    bgMethod,
    aiAvailable,
    findings,
  ]);

  const handleRetryFailed = useCallback(() => {
    const failedJobs = exportBatch.jobs.filter((job) =>
      lastReport?.files.some(
        (file) =>
          file.status === 'failed' && file.nodeId === job.nodeId && file.fileName === job.fileName,
      ),
    );
    if (failedJobs.length === 0) return;
    setLastReport(null);
    void (async () => {
      setRunning(true);
      setProgress({ done: 0, errors: 0 });
      setProgressDetail({ stage: 'preflight' });
      batchAbortRef.current?.abort();
      const controller = new AbortController();
      batchAbortRef.current = controller;
      try {
        const retryBatch = { ...exportBatch, jobs: failedJobs };
        const report = await onExport(retryBatch, controller.signal, (event) => {
          setProgress({ done: event.completed, errors: event.failed });
          setProgressDetail({ stage: event.stage, currentFile: event.currentFile });
        });
        if (report) {
          setLastReport(report);
          setProgress({ done: report.successCount, errors: report.failureCount });
          setAnnounceMsg(
            controller.signal.aborted
              ? 'Export cancelled'
              : report.failureCount > 0
                ? `Retry partial: ${report.successCount} exported, ${report.failureCount} still failed`
                : `Retry complete: ${report.successCount} files exported`,
          );
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          setAnnounceMsg('Export cancelled');
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setAnnounceMsg(`Retry failed: ${msg}`);
        }
      } finally {
        batchAbortRef.current = null;
        setRunning(false);
      }
    })();
  }, [exportBatch, lastReport, onExport]);

  const handleCancel = useCallback(() => {
    if (videoExporting) {
      videoAbortRef.current?.abort();
      setVideoExporting(false);
      setVideoProgress({ done: 0, total: 0 });
      setAnnounceMsg('Video export cancelled');
      return;
    }
    batchAbortRef.current?.abort();
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

        const { exportTimelineToVideo } = await import('@varve/engine');
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

  const handleGifExport = useCallback(
    async (tl: Timeline) => {
      if (!document || !onSaveVideoFile) return;
      if (!gifSupport.supported) {
        setAnnounceMsg(gifSupport.reason ?? 'GIF export unavailable');
        return;
      }

      const reducedMotion = prefersReducedMotion();
      const width = document.canvasWidth ?? 1920;
      const height = document.canvasHeight ?? 1080;
      const fps = 10;
      const totalFrames = reducedMotion ? 1 : Math.ceil((tl.duration / 1000) * fps);

      videoAbortRef.current?.abort();
      const controller = new AbortController();
      videoAbortRef.current = controller;

      setVideoExporting(true);
      setVideoProgress({ done: 0, total: totalFrames });
      setAnnounceMsg(`Exporting ${tl.name} as GIF...`);

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

        const { exportTimelineToGif } = await import('@varve/engine');
        const result = await exportTimelineToGif(renderFrame, tl.duration, {
          width,
          height,
          fps,
          repeat: 0,
          signal: controller.signal,
          onProgress: (done, total) => setVideoProgress({ done, total }),
        });

        if (controller.signal.aborted) return;

        if (!result.bytes) {
          setAnnounceMsg(result.reason ?? 'GIF export failed');
          return;
        }

        await onSaveVideoFile(`${safeFilename(tl.name)}.gif`, result.bytes, 'image/gif');
        setAnnounceMsg(`GIF export complete: ${tl.name}.gif`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAnnounceMsg(`GIF export failed: ${msg}`);
      } finally {
        setVideoExporting(false);
        videoAbortRef.current = null;
      }
    },
    [document, onSaveVideoFile, selectionIds, gifSupport],
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

  const handleSelectDestination = useCallback(async () => {
    if (!onSelectDestination) return;
    const selected = await onSelectDestination();
    if (selected) setDestinationLabel(selected);
  }, [onSelectDestination]);

  if (!isOpen) return null;

  return (
    <FocusTrap>
      <div
        className="export-dialog-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
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
              {batchSummary && (
                <p className="export-dialog__batch-summary">
                  {batchSummary.count} file{batchSummary.count !== 1 ? 's' : ''}
                  {batchSummary.largestW > 0 &&
                    ` · Largest: ${batchSummary.largestW} x ${batchSummary.largestH} px`}
                </p>
              )}
              <BatchJobList
                jobs={displayJobs}
                selectedIds={selectedIds}
                onToggleJob={handleToggleJob}
                onToggleAll={handleToggleAll}
              />
            </section>

            {findings.length > 0 && (
              <section className="export-dialog__section" aria-label="Preflight">
                <h3 className="export-dialog__section-title">Preflight</h3>
                <PreflightFindingsPanel findings={findings} />
              </section>
            )}

            {hasPdfXJobs && (
              <section className="export-dialog__section" aria-label="Print settings">
                <PrintSettingsPanel
                  value={printSettings}
                  onChange={setPrintSettings}
                  standard={
                    selectedJobs.some((job) => job.format === 'pdf-x1a') ? 'pdf-x1a' : 'pdf-x4'
                  }
                  documentBleedMm={
                    document?.activePageId
                      ? pageBleedMm(document, document.activePageId)
                      : document
                        ? documentBleedMm(document)
                        : undefined
                  }
                />
              </section>
            )}

            {hasRasterJobs && document && (
              <section className="export-dialog__section" aria-label="Output resolution">
                <OutputResolutionPanel
                  value={resolutionOverride}
                  onChange={setResolutionOverride}
                />
              </section>
            )}

            <section className="export-dialog__section" aria-label="Destination">
              <h3 className="export-dialog__section-title">Destination</h3>
              <DestinationPicker
                template={template}
                folderRule={folderRule}
                jobs={jobs}
                onTemplateChange={setTemplate}
                onFolderRuleChange={setFolderRule}
                templateError={templateError}
                onSelectDestination={() => void handleSelectDestination()}
                destinationLabel={destinationLabel}
                folderSelectionAvailable={!!onSelectDestination}
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
                  <Select
                    label="Background removal method for export"
                    value={bgMethod}
                    options={[
                      { value: 'quick', label: 'Quick' },
                      { value: 'ai-balanced', label: 'Balanced' },
                      { value: 'ai-quality', label: 'High quality' },
                    ]}
                    onChange={(next) => {
                      setBgMethod(next as BackgroundRemovalMethod);
                      void (async () => {
                        if (next === 'quick') {
                          setAiAvailable(true);
                          return;
                        }
                        const modelId = workerModelIdForMethod(next as BackgroundRemovalMethod);
                        if (!modelId) {
                          setAiAvailable(true);
                          return;
                        }
                        const loader = await getModelLoaderReady();
                        setAiAvailable(await loader.isModelAvailable(modelId));
                      })();
                    }}
                  />
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
                    <p className="export-dialog__note">
                      All images already have background removal
                    </p>
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
                            disabled={videoExporting || running || !gifSupport.supported}
                            aria-label={`Export ${tl.name} as GIF`}
                            onClick={() => void handleGifExport(tl)}
                          >
                            GIF
                          </button>
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
                  stage={progressDetail.stage}
                  currentFile={progressDetail.currentFile}
                  onCancel={handleCancel}
                />
              </section>
            )}

            {lastReport && !running && (
              <section className="export-dialog__section" aria-label="Results">
                <h3 className="export-dialog__section-title">Results</h3>
                <ExportResultsList
                  files={lastReport.files}
                  onRetryFailed={handleRetryFailed}
                  onRevealOutput={onRevealOutput}
                  revealOutputLabel={revealOutputLabel}
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

          <div role="status" aria-live="polite" className="varve-visually-hidden">
            {announceMsg}
          </div>

          {showDownloadDialog && (
            <ModelDownloadDialog
              modelId={requiredModelId ?? 'u2netp'}
              onClose={() => setShowDownloadDialog(false)}
              onComplete={() => {
                setShowDownloadDialog(false);
                void refreshModelStatus();
              }}
            />
          )}
        </div>
      </div>
    </FocusTrap>
  );
}
