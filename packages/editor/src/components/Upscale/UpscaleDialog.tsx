/**
 * UpscaleDialog — preview-and-settings modal for image upscaling.
 *
 * Shows a before/after comparison, lets the user pick a mode and scale,
 * previews the output dimensions and estimated memory, and applies the
 * result to the document. Keyboard accessible with FocusTrap and aria-live.
 */

import type {
  DenoiseStrength,
  PixelArtAlgorithm,
  RestorationOperation,
  RestorationRequest,
  UpscaleModeId,
  UpscaleProgressFn,
} from '@varve/engine';
import {
  type AutoAnalysis,
  analyzeImageForRestoration,
  DEFAULT_UPSCALE_MODE,
  detectUpscaleCapabilities,
  estimateRestorationMemory,
  getModelLoader,
  getUpscaleMode,
  isRestorationOperationAvailable,
  type RestorationErrorCode,
  type RestorationStageState,
  recommendationLabel,
  recommendationStrengthLabel,
  runRestoration,
  toRestorationError,
  UPSCALE_MODES,
  upscalePreviewRegion,
} from '@varve/engine';
import { Button, FocusTrap, IconButton, SegmentedControl, Select } from '@varve/ui';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';
import {
  ENHANCEMENT_PRESETS,
  type EnhancementPresetId,
  getEnhancementPreset,
} from './enhancementPresets';

type OutputBehavior = 'new-layer' | 'replace-source' | 'non-destructive';

interface UpscaleDialogProps {
  /** Source image natural width. */
  sourceWidth: number;
  /** Source image natural height. */
  sourceHeight: number;
  /** Source image data URL for preview. */
  sourceDataUrl: string;
  /** Source image data for preview computation. */
  sourceImageData?: ImageData;
  /** Number of selected images to enhance (batch). Preview shows the first. */
  batchCount?: number;
  /** Whether the dialog is open. */
  open: boolean;
  /** Close handler. */
  onClose: () => void;
  /** Apply handler. */
  onApply: (options: {
    operation: RestorationOperation;
    mode: UpscaleModeId;
    scale: number;
    output: OutputBehavior;
    qualityPolicy: 'faithful' | 'balanced';
    denoiseStrength: DenoiseStrength;
    deblurStrength?: number;
    pixelArtAlgorithm?: PixelArtAlgorithm;
    onProgress: UpscaleProgressFn;
    onStageChange: (stages: RestorationStageState[]) => void;
  }) => Promise<void>;
}

const MEMORY_WARNING_BYTES = 256 * 1024 * 1024;
const MEMORY_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Extract a usable message from an unknown throwable.
 *
 * Tauri `invoke` rejects with the command's `Err(String)` payload rather than an
 * Error instance, so an `instanceof Error` check alone collapses every native
 * backend failure into a single uninformative string.
 */
function normalizeThrownMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  if (typeof caught === 'string' && caught.trim() !== '') return caught;
  if (caught && typeof caught === 'object') {
    const message = (caught as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return 'Processing failed';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function errorActionForCode(code: RestorationErrorCode): string | null {
  switch (code) {
    case 'model-not-installed':
      return 'Download the required model to continue.';
    case 'hash-mismatch':
      return 'The downloaded model failed integrity verification. Re-download it.';
    case 'dimension-limit':
      return 'The image is too large for this operation. Try a smaller scale or crop.';
    case 'tensor-allocation':
      return 'Not enough memory. Try a smaller scale, close other documents, or restart the app.';
    case 'runtime-unavailable':
      return 'The AI runtime is not available in this environment. Try a classical (CPU) mode.';
    case 'cancelled':
      return null;
    case 'stale-result':
      return 'The source image changed before processing finished. Re-apply on the current selection.';
    default:
      return null;
  }
}

function operationLabel(operation: RestorationOperation): string {
  switch (operation) {
    case 'denoise':
      return 'Denoise';
    case 'deblur':
      return 'Deblur';
    case 'deblur-upscale':
      return 'Deblur + Upscale';
    case 'restore-upscale':
      return 'Restore + Upscale';
    case 'upscale':
      return 'Upscale';
    case 'compression-restoration':
      return 'Compression cleanup';
    case 'none':
      return 'No change';
    default: {
      const exhaustive: never = operation;
      return exhaustive;
    }
  }
}

export function UpscaleDialog({
  sourceWidth,
  sourceHeight,
  sourceDataUrl,
  sourceImageData,
  batchCount = 1,
  open,
  onClose,
  onApply,
}: UpscaleDialogProps) {
  const { announce } = useEditor();
  const [modeId, setModeId] = useState<UpscaleModeId>(DEFAULT_UPSCALE_MODE);
  const [operation, setOperation] = useState<RestorationOperation | 'auto'>('auto');
  const [presetId, setPresetId] = useState<EnhancementPresetId>('recommended');
  const [scale, setScale] = useState(2);
  const [output, setOutput] = useState<OutputBehavior>('new-layer');
  const [qualityPolicy, setQualityPolicy] = useState<'faithful' | 'balanced'>('faithful');
  const [denoiseStrength, setDenoiseStrength] = useState<DenoiseStrength>('none');
  const [deblurStrength, setDeblurStrength] = useState(0.7);
  const [pixelArtAlgorithm, setPixelArtAlgorithm] = useState<PixelArtAlgorithm>('epx');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stages, setStages] = useState<RestorationStageState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<RestorationErrorCode | null>(null);
  const [capabilities, setCapabilities] = useState<{ pathDescription: string } | null>(null);
  const [previewPosition, setPreviewPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | '100%'>('fit');
  // Fractional center of the preview crop (0–1). Defaults to the image
  // center; the 3x3 picker lets the user inspect edges and corners where
  // defects the center crop would hide often live.
  const [previewFocus, setPreviewFocus] = useState({ x: 0.5, y: 0.5 });
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  // The same region as `previewDataUrl`, straight from the source. Comparing
  // the upscale against the original (rather than against another bicubic
  // upscale) is what makes the slider useful — both halves show the same
  // crop, and the right half is always the actual requested output.
  const [previewBaselineUrl, setPreviewBaselineUrl] = useState<string | null>(null);
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewRequestIdRef = useRef(0);
  const previewTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewSliderRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const denoiseUserEditedRef = useRef(false);

  const mode = useMemo(() => getUpscaleMode(modeId), [modeId]);

  /**
   * Resolve Auto once and reuse that result for preview, model checks, output
   * sizing, and apply. Showing an unchanged preview and then applying a
   * different operation makes restoration especially hard to judge.
   */
  const [autoAnalysis, setAutoAnalysis] = useState<AutoAnalysis | null>(null);
  const resolveAutoOperation = useCallback((): {
    operation: RestorationOperation | null;
    note?: string;
  } => {
    if (!autoAnalysis || autoAnalysis.recommendation[0] === 'none') return { operation: null };
    const { recommendation } = autoAnalysis;

    const notes: string[] = [];
    // Compression restoration has no validated model — drop it from the
    // executable recommendation but keep the limitation visible.
    const hasCompression = recommendation.includes('compression-restoration');
    const filtered = recommendation.filter((r) => r !== 'compression-restoration');
    if (hasCompression) {
      notes.push(
        'Compression-artifact cleanup is not yet available; Auto will apply only the supported part of this recommendation.',
      );
    }
    if (filtered.length === 0 && hasCompression) {
      return {
        operation: null,
        note: `${notes[0]} Denoise can reduce some artifacts but is not a dedicated restoration.`,
      };
    }

    const hasDenoise = filtered.includes('denoise');
    const hasDeblur = filtered.includes('deblur');
    const restore = hasDeblur ? 'deblur' : hasDenoise ? 'denoise' : null;
    if (hasDenoise && hasDeblur) {
      notes.push(
        'Auto selects deblur before upscale when both blur and noise are detected; run Denoise separately if both repairs are needed.',
      );
    }
    const upscale = filtered.includes('upscale');
    if (!restore)
      return { operation: upscale ? 'upscale' : null, note: notes.join(' ') || undefined };
    if (upscale) {
      return {
        operation: restore === 'deblur' ? 'deblur-upscale' : 'restore-upscale',
        note: notes.join(' ') || undefined,
      };
    }
    return { operation: restore, note: notes.join(' ') || undefined };
  }, [autoAnalysis]);

  const effectiveOperation: RestorationOperation | null =
    operation === 'auto' ? resolveAutoOperation().operation : operation;
  const autoResolution = operation === 'auto' ? resolveAutoOperation() : null;
  const autoActionDisabled = operation === 'auto' && (!autoAnalysis || !autoResolution?.operation);
  const autoUsesCustomSettings = operation === 'auto' && presetId === 'custom';

  const markPresetCustom = useCallback(() => {
    setPresetId('custom');
  }, []);

  const applyPreset = useCallback((nextPresetId: EnhancementPresetId) => {
    const preset = getEnhancementPreset(nextPresetId);
    if (!preset) return;
    denoiseUserEditedRef.current = false;
    setPresetId(nextPresetId);
    setOperation(preset.operation);
    setModeId(preset.mode);
    setScale(preset.scale);
    setQualityPolicy(preset.qualityPolicy);
    setDenoiseStrength(preset.denoiseStrength);
    setDeblurStrength(preset.deblurStrength);
    setPixelArtAlgorithm(preset.pixelArtAlgorithm);
  }, []);
  // Availability comes from the validated capability registry, not a
  // hardcoded per-operation rule, so a task lights up the moment its
  // checkpoint passes validation and lands in the manifest.
  const operationAvailable = useMemo(() => {
    if (operation === 'auto') return true;
    return isRestorationOperationAvailable(operation);
  }, [operation]);
  const usesUpscale =
    effectiveOperation === 'upscale' ||
    effectiveOperation === 'restore-upscale' ||
    effectiveOperation === 'deblur-upscale';
  const usesDenoise = effectiveOperation === 'denoise' || effectiveOperation === 'restore-upscale';
  const requiresDenoiseModel = usesDenoise && denoiseStrength !== 'none';

  const buildRestorationRequest = useCallback(
    (preview = true): RestorationRequest => {
      const method = mode?.id === 'pixel-art' ? 'pixel-art' : (mode?.method ?? 'bicubic');
      const activeOperation: RestorationOperation = effectiveOperation ?? 'none';
      return {
        operation: activeOperation,
        denoise: usesDenoise ? { strength: denoiseStrength } : undefined,
        deblur:
          effectiveOperation === 'deblur' || effectiveOperation === 'deblur-upscale'
            ? { strength: deblurStrength }
            : undefined,
        upscale: usesUpscale
          ? {
              method,
              scale,
              modelId:
                mode?.id === 'illustration'
                  ? 'upscale-realesrgan-anime'
                  : mode?.id === 'ai-enhance'
                    ? 'upscale-realesr-general'
                    : undefined,
              pixelArtAlgorithm: mode?.id === 'pixel-art' ? pixelArtAlgorithm : undefined,
            }
          : undefined,
        qualityPolicy,
        preview,
        previewMaxDimension: preview ? 512 : undefined,
      };
    },
    [
      denoiseStrength,
      deblurStrength,
      effectiveOperation,
      mode,
      pixelArtAlgorithm,
      qualityPolicy,
      scale,
      usesDenoise,
      usesUpscale,
    ],
  );

  // Model prerequisites. Denoise needs SCUNet, Deblur needs the NAFNet
  // checkpoint, and the AI modes need their Real-ESRGAN weights; the CPU
  // resampling modes need nothing. Checking here means a missing model is
  // offered as a download up front instead of surfacing as a backend
  // failure after the user commits to the operation.
  // Anime mode uses the validated anime-optimized model; CPU resampling
  // modes need nothing.
  const requiredModelIds = useMemo(() => {
    const ids: string[] = [];
    if (requiresDenoiseModel) ids.push('scunet');
    if (effectiveOperation === 'deblur' || effectiveOperation === 'deblur-upscale') {
      ids.push('nafnet-deblur-gopro');
    }
    if (usesUpscale && mode?.isAi) {
      ids.push(modeId === 'illustration' ? 'upscale-realesrgan-anime' : 'upscale-realesr-general');
    }
    return ids;
  }, [effectiveOperation, mode?.isAi, modeId, requiresDenoiseModel, usesUpscale]);
  const [missingModelIds, setMissingModelIds] = useState<string[]>([]);
  const [modelCheckKey, setModelCheckKey] = useState<string | null>(null);
  const modelMissing = missingModelIds.length > 0;
  const requiredModelKey = requiredModelIds.join('|');
  const modelCheckPending = requiredModelIds.length > 0 && modelCheckKey !== requiredModelKey;
  // The first missing model is the actionable one shown by the download
  // dialog. Combined restoration operations may require two or more models;
  // after one completes, the next remains disabled until it is acquired.
  const requiredModelId = missingModelIds[0] ?? requiredModelIds[0] ?? null;
  const [showModelDownload, setShowModelDownload] = useState(false);

  // Auto mode: run the cheap classical analysis once per open/source change.
  useEffect(() => {
    if (!open || operation !== 'auto' || !sourceImageData) {
      setAutoAnalysis(null);
      return;
    }
    let cancelled = false;
    // Keep analysis off the critical path; it samples at most 64 patches. A
    // plain task-turn timeout is more reliable than waiting indefinitely for
    // an idle callback while the editor is continuously rendering.
    const id = window.setTimeout(() => {
      const analysis = analyzeImageForRestoration(sourceImageData, { lowResolutionShortEdge: 900 });
      if (!cancelled) setAutoAnalysis(analysis);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [open, operation, sourceImageData]);

  // Auto should not report a denoise recommendation while sending an explicit
  // None strength to the planner. The first automatic recommendation gets a
  // real, conservative strength; a user who changes the control keeps that
  // choice for the rest of the dialog session.
  useEffect(() => {
    if (
      operation !== 'auto' ||
      denoiseUserEditedRef.current ||
      !autoAnalysis?.recommendation.includes('denoise')
    ) {
      return;
    }
    setDenoiseStrength((current) => (current === 'none' ? 'medium' : current));
  }, [autoAnalysis, operation]);

  useEffect(() => {
    if (!open || requiredModelIds.length === 0) {
      setMissingModelIds([]);
      setModelCheckKey('');
      return;
    }
    let cancelled = false;
    setModelCheckKey(null);
    void Promise.all(requiredModelIds.map((id) => getModelLoader().isModelAvailable(id)))
      .then((available) => {
        if (!cancelled) {
          setMissingModelIds(requiredModelIds.filter((_id, index) => !available[index]));
          setModelCheckKey(requiredModelKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMissingModelIds(requiredModelIds);
          setModelCheckKey(requiredModelKey);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, requiredModelIds, requiredModelKey]);

  const noOpRequested =
    operation !== 'auto' && effectiveOperation === 'denoise' && denoiseStrength === 'none';

  const memoryEstimate = useMemo(() => {
    try {
      return estimateRestorationMemory(buildRestorationRequest(false), sourceWidth, sourceHeight);
    } catch {
      return null;
    }
  }, [buildRestorationRequest, sourceHeight, sourceWidth]);
  const outW =
    memoryEstimate?.outputWidth ?? (!usesUpscale ? sourceWidth : Math.round(sourceWidth * scale));
  const outH =
    memoryEstimate?.outputHeight ??
    (!usesUpscale ? sourceHeight : Math.round(sourceHeight * scale));
  const outputBytes = memoryEstimate?.outputBytes ?? (outW > 0 && outH > 0 ? outW * outH * 4 : 0);
  const peakMemoryBytes = memoryEstimate?.peakBytes ?? outputBytes;
  const memoryWarning = peakMemoryBytes > MEMORY_WARNING_BYTES;
  const memoryExceeded = peakMemoryBytes > MEMORY_MAX_BYTES;

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    detectUpscaleCapabilities().then((c) => {
      setCapabilities({ pathDescription: c.pathDescription });
    });
    return () => {
      previousFocusRef.current?.focus();
      // Cancel any pending preview on close
      previewAbortRef.current?.abort();
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    if (mode) {
      setScale(mode.defaultScale);
    }
  }, [mode]);

  // Debounced preview generation for CPU modes.
  //
  // Previews must never overlap the real upscale: the native backend keeps a
  // single active job slot, and registering a new job flips the previous job's
  // cancellation flag. A preview landing mid-apply would therefore cancel the
  // user's actual upscale, so previews are suppressed while processing.
  useEffect(() => {
    if (
      !open ||
      !sourceImageData ||
      !mode ||
      !operationAvailable ||
      modelCheckPending ||
      modelMissing ||
      noOpRequested ||
      processing ||
      mode.isAi ||
      (operation === 'auto' && !effectiveOperation)
    ) {
      return;
    }
    // Cancel previous preview
    previewAbortRef.current?.abort();
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }
    // Debounce 250ms
    previewTimeoutRef.current = setTimeout(() => {
      generatePreview();
    }, 250);
    return () => {
      previewRequestIdRef.current += 1;
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
        previewTimeoutRef.current = null;
      }
      previewAbortRef.current?.abort();
    };
  }, [
    modeId,
    scale,
    operation,
    operationAvailable,
    modelCheckPending,
    modelMissing,
    noOpRequested,
    denoiseStrength,
    deblurStrength,
    open,
    sourceImageData,
    mode,
    processing,
    previewFocus,
    pixelArtAlgorithm,
    qualityPolicy,
    effectiveOperation,
  ]);

  // Clear preview when the operation changes or becomes unavailable.
  // Stale preview data from a previous operation must not persist while
  // the new preview is generating (250ms debounce + processing).
  useEffect(() => {
    previewRequestIdRef.current += 1;
    previewAbortRef.current?.abort();
    setPreviewDataUrl(null);
    setPreviewBaselineUrl(null);
    setPreviewGenerating(false);
  }, [
    operation,
    operationAvailable,
    modeId,
    scale,
    denoiseStrength,
    deblurStrength,
    pixelArtAlgorithm,
    qualityPolicy,
    previewFocus,
    effectiveOperation,
  ]);

  async function generatePreview() {
    // Never contend with a running upscale for the native backend's single job
    // slot — registering a preview job there cancels the real one.
    if (
      !sourceImageData ||
      !mode ||
      !operationAvailable ||
      modelCheckPending ||
      modelMissing ||
      noOpRequested ||
      processing ||
      (operation === 'auto' && !effectiveOperation)
    ) {
      return;
    }
    const abort = new AbortController();
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    previewAbortRef.current = abort;
    setPreviewGenerating(true);
    try {
      // User-selected preview region: crop the source to the focused area
      // FIRST, then run the pipeline on that crop. runRestoration's own
      // center-crop becomes a no-op because the focused crop already fits
      // the preview budget, so preview and final share identical math.
      const region = upscalePreviewRegion(sourceImageData, {
        scale: usesUpscale ? scale : 1,
        previewMaxDimension: 512,
        previewFocus,
      });
      const focusedSource = new ImageData(region.width, region.height);
      for (let y = 0; y < region.height; y += 1) {
        for (let x = 0; x < region.width; x += 1) {
          const from = ((region.y + y) * sourceImageData.width + region.x + x) * 4;
          const to = (y * region.width + x) * 4;
          focusedSource.data[to] = sourceImageData.data[from] as number;
          focusedSource.data[to + 1] = sourceImageData.data[from + 1] as number;
          focusedSource.data[to + 2] = sourceImageData.data[from + 2] as number;
          focusedSource.data[to + 3] = sourceImageData.data[from + 3] as number;
        }
      }
      const result = await runRestoration(focusedSource, buildRestorationRequest(true), {
        signal: abort.signal,
      });
      const previewImage = result.imageData;
      const canvas = document.createElement('canvas');
      canvas.width = previewImage.width;
      canvas.height = previewImage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(previewImage, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      // Keep the original crop as the before image. The old implementation
      // ran a second bicubic upscale for the left half, which made the
      // default CPU preview pixel-for-pixel identical to the result.
      const cropped = focusedSource;
      let baselineDataUrl: string | null = null;
      try {
        const bCanvas = document.createElement('canvas');
        bCanvas.width = cropped.width;
        bCanvas.height = cropped.height;
        const bCtx = bCanvas.getContext('2d');
        if (bCtx) {
          bCtx.putImageData(cropped, 0, 0);
          baselineDataUrl = bCanvas.toDataURL('image/png');
        }
      } catch {
        // Fallback to raw crop if classical upscale unavailable
        const fallback = document.createElement('canvas');
        fallback.width = cropped.width;
        fallback.height = cropped.height;
        const fCtx = fallback.getContext('2d');
        if (fCtx) {
          fCtx.putImageData(cropped, 0, 0);
          baselineDataUrl = fallback.toDataURL('image/png');
        }
      }
      if (abort.signal.aborted || previewRequestIdRef.current !== requestId) return;
      setPreviewBaselineUrl(baselineDataUrl);
      setPreviewDataUrl(dataUrl);
    } catch (err) {
      if (normalizeThrownMessage(err) !== 'cancelled') {
        console.error('Preview generation failed:', err);
      }
    } finally {
      if (previewRequestIdRef.current === requestId) setPreviewGenerating(false);
    }
  }

  const onProgress: UpscaleProgressFn = useCallback((done: number, total: number) => {
    setProgress({ done, total });
  }, []);
  const onStageChange = useCallback((nextStages: RestorationStageState[]) => {
    setStages(nextStages);
  }, []);

  const handleApply = useCallback(async () => {
    if (
      !mode ||
      memoryExceeded ||
      processing ||
      !operationAvailable ||
      modelCheckPending ||
      modelMissing ||
      noOpRequested
    )
      return;
    // Auto resolves its recommendation at apply time; nothing to apply when
    // the analysis suggested no restoration.
    const resolved = operation === 'auto' ? resolveAutoOperation() : null;
    if (operation === 'auto' && !resolved?.operation) {
      const message = resolved?.note ?? 'No specific restoration suggested';
      setError(message);
      setErrorCode(null);
      announce(message);
      return;
    }
    if (resolved?.note) {
      setError(resolved.note);
      setErrorCode(null);
    } else {
      setError(null);
      setErrorCode(null);
    }
    // Retire any queued or in-flight preview first. Both share the native
    // backend's single job slot, so a preview starting after this point would
    // cancel the real upscale.
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    setProcessing(true);
    setProgress(null);
    const concreteOp = resolved?.operation ?? effectiveOperation;
    if (!concreteOp) return;
    // The engine reports the actual ordered stages and their status. Do not
    // infer the active stage from a global tile count: restoration and
    // upscaling have different tile totals and some CPU stages have none.
    setStages([]);
    try {
      await onApply({
        // 'auto' is a UI-level selection; the resolver picks the concrete
        // operation. Fall back to plain upscale when it has not resolved.
        operation: concreteOp,
        mode: modeId,
        scale,
        output,
        qualityPolicy,
        denoiseStrength:
          resolved?.operation === 'denoise' ||
          resolved?.operation === 'restore-upscale' ||
          resolved?.operation === 'deblur-upscale'
            ? denoiseStrength
            : usesDenoise
              ? denoiseStrength
              : 'none',
        deblurStrength:
          concreteOp === 'deblur' || concreteOp === 'deblur-upscale' ? deblurStrength : undefined,
        pixelArtAlgorithm: modeId === 'pixel-art' ? pixelArtAlgorithm : undefined,
        onProgress,
        onStageChange,
      });
      onClose();
    } catch (caught) {
      // Tauri commands reject with a bare string, so `instanceof Error` alone
      // would discard the backend's message and report a useless generic.
      const restorationError = toRestorationError(caught);
      const message = restorationError.message;
      console.error(
        'Upscale failed:',
        message,
        'code:',
        restorationError.code,
        '\nthrown value:',
        caught,
        '\nstack:',
        caught instanceof Error ? caught.stack : '(non-Error throw, no stack)',
      );
      if (restorationError.code === 'cancelled') {
        setError('Cancelled');
        setErrorCode('cancelled');
        announce('Enhancement cancelled');
      } else {
        setError(message);
        setErrorCode(restorationError.code);
        announce(`Enhancement failed: ${message}`);
      }
    } finally {
      setProcessing(false);
      setProgress(null);
      setStages([]);
    }
  }, [
    mode,
    operation,
    effectiveOperation,
    modeId,
    scale,
    output,
    denoiseStrength,
    deblurStrength,
    pixelArtAlgorithm,
    memoryExceeded,
    processing,
    onApply,
    onClose,
    onProgress,
    onStageChange,
    announce,
    buildRestorationRequest,
    operationAvailable,
    modelCheckPending,
    modelMissing,
    noOpRequested,
    usesDenoise,
    resolveAutoOperation,
  ]);

  const handleCancel = useCallback(() => {
    if (!processing) {
      onClose();
    }
  }, [processing, onClose]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !previewContainerRef.current) return;
      const rect = previewContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      setPreviewPosition(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    },
    [isDragging],
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleSliderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPreviewPosition((p) => Math.max(0, p - (e.shiftKey ? 10 : 2)));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPreviewPosition((p) => Math.min(100, p + (e.shiftKey ? 10 : 2)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPreviewPosition(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPreviewPosition(100);
    }
  }, []);

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  // A tiny source (favicon, icon, glyph) has a tiny intrinsic <img> box, which
  // makes the comparison technically correct but useless to inspect. Fit the
  // source or selected preview crop into a bounded review area while keeping
  // 100% mode genuinely pixel-sized. Use the rendered output dimensions here,
  // not the source crop dimensions: the preview image is the upscaled result.
  const previewRegion = upscalePreviewRegion(
    { width: Math.max(1, sourceWidth), height: Math.max(1, sourceHeight) },
    {
      scale: usesUpscale ? scale : 1,
      previewMaxDimension: 512,
      previewFocus,
    },
  );
  const previewReferenceWidth = previewBaselineUrl
    ? previewRegion.width * (usesUpscale ? scale : 1)
    : sourceWidth;
  const previewReferenceHeight = previewBaselineUrl
    ? previewRegion.height * (usesUpscale ? scale : 1)
    : sourceHeight;
  const previewFitScale = Math.min(
    720 / Math.max(1, previewReferenceWidth),
    560 / Math.max(1, previewReferenceHeight),
  );
  const previewFitStyle =
    previewZoom === 'fit'
      ? {
          width: `${Math.max(1, Math.round(previewReferenceWidth * previewFitScale))}px`,
          height: `${Math.max(1, Math.round(previewReferenceHeight * previewFitScale))}px`,
          maxWidth: '100%',
          maxHeight: 'min(58vh, 560px)',
        }
      : undefined;
  const previewSurfaceStyle =
    previewZoom === 'fit'
      ? previewFitStyle
      : {
          width: `${Math.max(1, Math.round(previewReferenceWidth))}px`,
          height: `${Math.max(1, Math.round(previewReferenceHeight))}px`,
          maxWidth: 'none',
          maxHeight: 'none',
        };
  const previewComparisonLabel = previewBaselineUrl
    ? `same ${Math.round(previewReferenceWidth)}x${Math.round(previewReferenceHeight)}px review crop`
    : 'source crop';
  const sliderPositionStyle = {
    left: 0,
    width: '100%',
    transform: 'none',
    '--upscale-slider-position': `${previewPosition}%`,
  } as CSSProperties & { '--upscale-slider-position': string };
  const sliderHandleEdgeClass =
    previewPosition <= 0
      ? 'upscale-preview__slider-handle--start'
      : previewPosition >= 100
        ? 'upscale-preview__slider-handle--end'
        : '';

  if (!open) return null;

  const modeOptions = UPSCALE_MODES.map((m) => ({
    value: m.id,
    label: m.label,
  }));

  const scaleOptions = (mode?.scaleOptions ?? [2]).map((s) => ({
    value: String(s),
    label: `${s}x`,
  }));

  return (
    <div
      className="upscale-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Enhance image"
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) handleCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !processing) handleCancel();
      }}
    >
      <FocusTrap active={open}>
        <div className="upscale-dialog">
          <div className="upscale-dialog__header">
            <h2 className="upscale-dialog__title">
              Enhance image{batchCount > 1 ? ` (${batchCount} selected)` : ''}
            </h2>
            <IconButton
              icon="X"
              label="Close upscale dialog"
              size="icon-xs"
              variant="ghost"
              type="button"
              className="upscale-dialog__close"
              onClick={handleCancel}
              disabled={processing}
            />
          </div>

          <div className="upscale-dialog__body">
            {/* Preview */}
            <div className="upscale-preview">
              <div className="upscale-preview__toolbar">
                <div className="upscale-preview__toolbar-heading">
                  <span className="upscale-preview__toolbar-label">Preview</span>
                  <span className="upscale-preview__toolbar-status">
                    {previewBaselineUrl ? 'Live comparison' : 'Source image'}
                  </span>
                </div>
                <div className="upscale-preview__toolbar-controls">
                  <div className="upscale-preview__control-group">
                    <span className="upscale-preview__control-label">Inspect</span>
                    <fieldset
                      className="upscale-preview__focus-picker"
                      aria-label="Preview region (pick the area to inspect)"
                    >
                      {([0, 0.5, 1] as const).flatMap((fy) =>
                        ([0, 0.5, 1] as const).map((fx) => {
                          const active = previewFocus.x === fx && previewFocus.y === fy;
                          return (
                            <button
                              key={`${fx}-${fy}`}
                              type="button"
                              className={`upscale-preview__focus-cell ${active ? 'upscale-preview__focus-cell--active' : ''}`}
                              aria-pressed={active}
                              aria-label={`Preview ${fy === 0 ? 'top' : fy === 1 ? 'bottom' : 'middle'} ${fx === 0 ? 'left' : fx === 1 ? 'right' : 'center'}`}
                              onClick={() => setPreviewFocus({ x: fx, y: fy })}
                            />
                          );
                        }),
                      )}
                    </fieldset>
                  </div>
                  <div className="upscale-preview__control-group">
                    <span className="upscale-preview__control-label">Zoom</span>
                    <fieldset className="upscale-preview__zoom-toggle" aria-label="Preview zoom">
                      <button
                        type="button"
                        className={`upscale-preview__zoom-btn ${previewZoom === 'fit' ? 'upscale-preview__zoom-btn--active' : ''}`}
                        aria-pressed={previewZoom === 'fit'}
                        onClick={() => setPreviewZoom('fit')}
                      >
                        Fit
                      </button>
                      <button
                        type="button"
                        className={`upscale-preview__zoom-btn ${previewZoom === '100%' ? 'upscale-preview__zoom-btn--active' : ''}`}
                        aria-pressed={previewZoom === '100%'}
                        onClick={() => setPreviewZoom('100%')}
                      >
                        100%
                      </button>
                    </fieldset>
                  </div>
                </div>
              </div>
              <div
                className={`upscale-preview__viewport ${previewZoom === '100%' ? 'upscale-preview__viewport--zoom100' : ''}`}
              >
                <div
                  ref={previewContainerRef}
                  className={`upscale-preview__image-container ${previewZoom === '100%' ? 'upscale-preview__image-container--zoom100' : ''}`}
                  style={previewSurfaceStyle}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                >
                  <img
                    src={previewBaselineUrl ?? (sourceDataUrl || undefined)}
                    alt="Original preview — same crop as enhanced output"
                    className="upscale-preview__image upscale-preview__image--original"
                    style={{
                      ...previewSurfaceStyle,
                      imageRendering:
                        mode?.id === 'pixel-art' ? ('pixelated' as const) : ('auto' as const),
                    }}
                  />
                  <div
                    className="upscale-preview__overlay"
                    style={{ clipPath: `inset(0 0 0 ${100 - previewPosition}%)` }}
                  >
                    {previewDataUrl ? (
                      <img
                        src={previewDataUrl}
                        alt="Enhanced preview — same crop and output size as original"
                        className="upscale-preview__image upscale-preview__image--upscaled"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill' as const,
                          imageRendering:
                            mode?.id === 'pixel-art' ? ('pixelated' as const) : undefined,
                        }}
                      />
                    ) : mode?.isAi ? (
                      <img
                        src={sourceDataUrl || undefined}
                        alt="AI upscaled preview placeholder"
                        className="upscale-preview__image upscale-preview__image--upscaled"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill' as const,
                          opacity: 0.45,
                        }}
                      />
                    ) : (
                      <img
                        src={sourceDataUrl || undefined}
                        alt="Preview placeholder"
                        className="upscale-preview__image upscale-preview__image--upscaled"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill' as const,
                          opacity: 0.45,
                        }}
                      />
                    )}
                  </div>
                  <div
                    ref={previewSliderRef}
                    className="upscale-preview__slider"
                    style={sliderPositionStyle}
                    role="slider"
                    aria-label="Before / after comparison"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(previewPosition)}
                    aria-valuetext={`${Math.round(previewPosition)}% enhanced`}
                    tabIndex={0}
                    onKeyDown={handleSliderKeyDown}
                  >
                    <div className="upscale-preview__slider-line" />
                    <div
                      className={`upscale-preview__slider-handle ${sliderHandleEdgeClass}`.trim()}
                      aria-hidden="true"
                    >
                      <span aria-hidden="true">&lt;-&gt;</span>
                    </div>
                  </div>
                  <span className="upscale-preview__label upscale-preview__label--before">
                    Original
                  </span>
                  <span className="upscale-preview__label upscale-preview__label--after">
                    {operation === 'denoise'
                      ? 'Denoised'
                      : operation === 'deblur'
                        ? 'Deblurred'
                        : operation === 'compression-restoration'
                          ? 'Restored'
                          : operation === 'restore-upscale'
                            ? 'Restored + enhanced'
                            : operation === 'deblur-upscale'
                              ? 'Deblurred + enhanced'
                              : 'Enhanced'}
                  </span>
                  {mode?.isAi && !previewDataUrl && (
                    <p className="upscale-preview__ai-hint">
                      AI preview is opt-in — generates a 512 px crop. Tap Generate to see real
                      output.
                    </p>
                  )}
                  {previewGenerating && (
                    <div className="upscale-preview__generating" role="status" aria-live="polite">
                      Generating preview…
                    </div>
                  )}
                </div>
              </div>
              <p className="upscale-preview__hint">
                {previewBaselineUrl
                  ? `Original crop vs enhanced output — ${previewComparisonLabel} (${usesUpscale ? (mode?.isAi ? 'AI' : (mode?.label ?? 'CPU')) : 'source'}). Drag or use left/right keys to compare. ${previewZoom === '100%' ? '100% pixel view.' : 'Fit view.'} Output: ${outW}x${outH}px`
                  : `Drag or use left/right keys to compare. Output: ${outW}x${outH}px`}
              </p>
            </div>

            {/* Settings */}
            <div className="upscale-settings">
              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Preset</span>
                <Select
                  label="Enhancement preset"
                  value={presetId}
                  disabled={processing}
                  options={[
                    ...ENHANCEMENT_PRESETS.map((preset) => ({
                      value: preset.id,
                      label: preset.label,
                      description: preset.description,
                    })),
                    {
                      value: 'custom',
                      label: 'Custom settings',
                      description: 'Keep the individual settings selected below.',
                    },
                  ]}
                  onChange={(value) => {
                    const nextPresetId = value as EnhancementPresetId;
                    if (nextPresetId === 'custom') setPresetId('custom');
                    else applyPreset(nextPresetId);
                  }}
                />
                <p className="insp-hint">
                  {presetId === 'custom'
                    ? 'Individual settings are active. Choosing a preset replaces only processing settings; output behavior stays unchanged.'
                    : (getEnhancementPreset(presetId)?.description ?? '')}
                </p>
              </div>

              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Enhancement</span>
                <Select
                  label="Enhancement operation"
                  value={operation}
                  disabled={processing}
                  options={[
                    { value: 'auto', label: 'Auto / Recommended' },
                    { value: 'upscale', label: 'Upscale' },
                    { value: 'denoise', label: 'Denoise' },
                    { value: 'restore-upscale', label: 'Restore + Upscale' },
                    {
                      value: 'deblur',
                      label: isRestorationOperationAvailable('deblur')
                        ? 'Deblur'
                        : 'Deblur (not available)',
                    },
                    {
                      value: 'deblur-upscale',
                      label: isRestorationOperationAvailable('deblur-upscale')
                        ? 'Deblur + Upscale'
                        : 'Deblur + Upscale (not available)',
                    },
                    {
                      value: 'compression-restoration',
                      label: isRestorationOperationAvailable('compression-restoration')
                        ? 'Remove compression artifacts'
                        : 'Remove compression artifacts (not available)',
                    },
                  ]}
                  onChange={(value) => {
                    const next = value as RestorationOperation | 'auto';
                    denoiseUserEditedRef.current = false;
                    markPresetCustom();
                    setOperation(next);
                    if (next === 'upscale') setDenoiseStrength('none');
                    if (next === 'denoise' || next === 'restore-upscale') {
                      setDenoiseStrength((current) => (current === 'none' ? 'medium' : current));
                    }
                    if (next === 'deblur' || next === 'deblur-upscale') {
                      setDenoiseStrength('none');
                    }
                  }}
                />
                {operation === 'auto' && (
                  <div className="upscale-auto" role="status" aria-live="polite">
                    {autoAnalysis ? (
                      autoAnalysis.recommendation[0] === 'none' ? (
                        <p className="insp-hint">No specific restoration suggested.</p>
                      ) : (
                        <>
                          <p className="insp-hint">
                            <strong>Detected:</strong>{' '}
                            {autoAnalysis.findings.join('; ').toLowerCase()}
                          </p>
                          <p className="insp-hint">
                            <strong>Recommended:</strong>{' '}
                            {recommendationLabel(autoAnalysis.recommendation)} (
                            {recommendationStrengthLabel(autoAnalysis.confidence)})
                          </p>
                          {autoResolution?.operation && (
                            <p className="insp-hint">
                              <strong>Will run:</strong> {operationLabel(autoResolution.operation)}
                            </p>
                          )}
                          {autoResolution?.note && (
                            <p className="insp-hint insp-hint--warn">{autoResolution.note}</p>
                          )}
                        </>
                      )
                    ) : (
                      <p className="insp-hint">Analyzing image…</p>
                    )}
                  </div>
                )}
                {!operationAvailable && operation === 'compression-restoration' && (
                  <p className="insp-hint insp-hint--warn">
                    No JPEG/artifact-removal model has passed the design-content corpus yet. SCUNet
                    denoise damages thin lines and text; the only NAFNet JPEG checkpoint was
                    rejected on provenance. Denoise can reduce some artifacts but is not a dedicated
                    compression restorer. A validated model (e.g. FBCNN) will be added when its ONNX
                    export is verified.
                  </p>
                )}
                {!operationAvailable && operation !== 'compression-restoration' && (
                  <p className="insp-hint insp-hint--warn">
                    No task-specific model is installed and validated for this operation yet.
                  </p>
                )}
              </div>

              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Quality</span>
                <SegmentedControl
                  label="Quality policy"
                  value={qualityPolicy}
                  disabled={processing}
                  options={[
                    { value: 'faithful', label: 'Faithful' },
                    { value: 'balanced', label: 'Balanced' },
                  ]}
                  onChange={(v) => {
                    markPresetCustom();
                    setQualityPolicy(v as 'faithful' | 'balanced');
                  }}
                />
                <p className="insp-hint">
                  {qualityPolicy === 'faithful'
                    ? 'Preserve original detail. Lighter restoration, fewer artifacts.'
                    : 'Allow stronger reconstruction for better perceptual results.'}
                </p>
              </div>

              {usesUpscale && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Mode</span>
                  <Select
                    label="Upscale quality"
                    value={modeId}
                    disabled={processing}
                    options={modeOptions}
                    onChange={(v) => {
                      markPresetCustom();
                      setModeId(v as UpscaleModeId);
                    }}
                  />
                  {mode && <p className="insp-hint">{mode.description}</p>}
                  {modeId === 'illustration' && (
                    <p className="insp-hint">
                      Anime-optimized Real-ESRGAN x4 (6B RRDB blocks) — produces sharper edges and
                      cleaner lines on anime and illustrations than the general model.
                    </p>
                  )}
                  {mode?.isAi && (
                    <div className="upscale-settings__ai-preview">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={previewGenerating || processing}
                        onClick={() => void generatePreview()}
                      >
                        {previewGenerating ? 'Generating…' : 'Generate AI preview'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {(usesDenoise || operation === 'upscale') && operation !== 'deblur-upscale' && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Denoise</span>
                  <SegmentedControl
                    label="Denoise strength"
                    value={denoiseStrength}
                    disabled={processing || operation === 'upscale'}
                    options={[
                      { value: 'none', label: 'None' },
                      { value: 'light', label: 'Light' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'strong', label: 'Strong' },
                    ]}
                    onChange={(v) => {
                      denoiseUserEditedRef.current = true;
                      markPresetCustom();
                      setDenoiseStrength(v as DenoiseStrength);
                    }}
                  />
                  {operation !== 'upscale' && (
                    <p className="insp-hint">
                      {denoiseStrength === 'none'
                        ? 'No denoising'
                        : `${denoiseStrength} denoise before upscale`}
                    </p>
                  )}
                </div>
              )}

              {(operation === 'deblur' || operation === 'deblur-upscale') && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Deblur</span>
                  <SegmentedControl
                    label="Deblur strength"
                    value={String(deblurStrength)}
                    disabled={processing}
                    options={[
                      { value: '0.3', label: 'Light' },
                      { value: '0.5', label: 'Medium' },
                      { value: '0.7', label: 'Strong' },
                      { value: '0.9', label: 'Maximum' },
                    ]}
                    onChange={(v) => {
                      markPresetCustom();
                      setDeblurStrength(Number(v));
                    }}
                  />
                  <p className="insp-hint">
                    {operation === 'deblur-upscale'
                      ? `Deblur strength ${deblurStrength} before upscale`
                      : deblurStrength <= 0.3
                        ? 'Conservative — preserves original detail'
                        : deblurStrength >= 0.9
                          ? 'Maximum — may create ringing on already-sharp images'
                          : `Deblur strength ${deblurStrength}`}
                  </p>
                </div>
              )}

              {usesUpscale && modeId === 'pixel-art' && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Algorithm</span>
                  <Select
                    label="Pixel-art algorithm"
                    value={pixelArtAlgorithm}
                    disabled={processing}
                    options={[
                      { value: 'nearest', label: 'Nearest neighbour' },
                      { value: 'epx', label: 'EPX (smooth diagonals)' },
                      { value: 'scale2x', label: 'Scale2x' },
                      { value: 'scale3x', label: 'Scale3x' },
                      { value: 'scale4x', label: 'Scale4x' },
                      { value: 'hqx', label: 'hqx (high quality)' },
                      { value: 'xbr', label: 'xBR (pattern aware)' },
                    ]}
                    onChange={(v) => {
                      markPresetCustom();
                      setPixelArtAlgorithm(v as PixelArtAlgorithm);
                    }}
                  />
                  <p className="insp-hint">
                    {pixelArtAlgorithm === 'nearest'
                      ? 'Hard edges, no smoothing'
                      : pixelArtAlgorithm === 'epx'
                        ? 'Smooth diagonal lines, preserves pixel grid'
                        : pixelArtAlgorithm === 'hqx'
                          ? 'Area-based interpolation for curved edges'
                          : pixelArtAlgorithm === 'xbr'
                            ? 'Pattern-aware scaling for complex pixel art'
                            : 'Pure integer nearest-neighbour scaling'}
                  </p>
                </div>
              )}

              {usesUpscale && (
                <div className="upscale-settings__group">
                  <span className="upscale-settings__label">Scale</span>
                  <SegmentedControl
                    label="Scale factor"
                    value={String(scale)}
                    disabled={processing || mode?.lockedScale}
                    options={scaleOptions}
                    onChange={(v) => {
                      markPresetCustom();
                      setScale(Number(v));
                    }}
                  />
                </div>
              )}

              <div className="upscale-settings__group">
                <span className="upscale-settings__label">Result</span>
                <SegmentedControl
                  label="Output behavior"
                  value={output}
                  disabled={processing}
                  options={[
                    { value: 'new-layer', label: 'New layer' },
                    { value: 'replace-source', label: 'Replace source' },
                    { value: 'non-destructive', label: 'Non-destructive' },
                  ]}
                  onChange={(v) => setOutput(v as OutputBehavior)}
                />
              </div>

              {/* Output info */}
              <div className="upscale-output-info">
                <span className="insp-hint">
                  Output {outW}x{outH}px
                  {outputBytes > 0 && ` ~${formatBytes(outputBytes)}`}
                  {mode?.isAi && ' slow, runs locally'}
                  {peakMemoryBytes > 0 && ` · estimated peak ~${formatBytes(peakMemoryBytes)}`}
                </span>
                {capabilities && (
                  <span className="insp-hint">Path: {capabilities.pathDescription}</span>
                )}
                {autoAnalysis?.findings.some((f) => f.includes('pixel art')) && (
                  <span className="insp-hint">
                    Hint: limited palette — Pixel Art mode will preserve hard edges (no photographic
                    smoothing).
                  </span>
                )}
                {usesUpscale && mode?.isAi && scale !== 4 && (
                  <span className="insp-hint">
                    AI is fixed 4x — your {scale}x is served as 4x AI then high-quality lanczos3
                    downsample to {outW}x{outH}px.
                  </span>
                )}
              </div>

              {modelCheckPending && (
                <p className="insp-hint" role="status">
                  Checking local model availability…
                </p>
              )}

              {!modelCheckPending && modelMissing && requiredModelId && (
                <div className="upscale-model-missing" role="status">
                  <p className="insp-hint insp-hint--warn">
                    {requiredModelId === 'scunet'
                      ? 'Denoise needs the SCUNet model, which is not installed yet.'
                      : requiredModelId === 'nafnet-deblur-gopro'
                        ? 'Deblur needs the NAFNet model, which is not installed yet.'
                        : 'This mode needs an AI model that is not installed yet.'}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={processing}
                    onClick={() => setShowModelDownload(true)}
                  >
                    Download model
                  </Button>
                </div>
              )}

              {noOpRequested && (
                <p className="insp-hint" role="status">
                  No denoising selected; the source remains unchanged.
                </p>
              )}

              {memoryWarning && (
                <p className="insp-hint insp-hint--warn" role="status">
                  {memoryExceeded
                    ? `Estimated peak memory exceeds the safe limit (${formatBytes(peakMemoryBytes)}). Choose a smaller scale or a lighter operation.`
                    : `Estimated peak memory is ~${formatBytes(peakMemoryBytes)}. Processing may be slow or exhaust memory on low-RAM systems.`}
                </p>
              )}

              {/* Progress — stage-aware */}
              {processing && (
                <div className="upscale-progress" role="status" aria-live="polite">
                  {stages.length > 0 && (
                    <div className="upscale-progress__stages">
                      {stages.map((s) => {
                        const isActive = s.status === 'running';
                        const isDone = s.status === 'completed';
                        const isFailed = s.status === 'failed';
                        return (
                          <span
                            key={s.id}
                            className={`upscale-progress__stage ${isDone ? 'upscale-progress__stage--done' : ''} ${isActive ? 'upscale-progress__stage--active' : ''} ${isFailed ? 'upscale-progress__stage--failed' : ''}`}
                          >
                            <span aria-hidden="true">
                              {isDone
                                ? 'done'
                                : isFailed
                                  ? 'failed'
                                  : isActive
                                    ? 'active'
                                    : 'pending'}
                            </span>{' '}
                            {s.id}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {progress && progress.total > 0 && (
                    <div
                      className="insp-progress"
                      role="progressbar"
                      aria-valuenow={progressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Enhancement progress"
                    >
                      <div className="insp-progress__bar" style={{ width: `${progressPct}%` }} />
                      <span className="insp-progress__label">
                        {(() => {
                          const active = stages.find((s) => s.status === 'running');
                          if (active) return `${active.id} · ${progress.done}/${progress.total}`;
                          const failed = stages.find((s) => s.status === 'failed');
                          return failed
                            ? `${failed.id} failed`
                            : `${progress.done}/${progress.total}`;
                        })()}
                      </span>
                    </div>
                  )}
                  {!progress && <p className="insp-hint">Enhancing image…</p>}
                </div>
              )}

              {error && (
                <div className="upscale-error" role="alert">
                  <p className="insp-hint insp-hint--error">{error}</p>
                  {errorCode && errorActionForCode(errorCode) && (
                    <p className="insp-hint">{errorActionForCode(errorCode)}</p>
                  )}
                  {errorCode === 'model-not-installed' && requiredModelId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModelDownload(true)}
                    >
                      Download model
                    </Button>
                  )}
                  {errorCode === 'hash-mismatch' && requiredModelId && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowModelDownload(true)}
                    >
                      Re-download model
                    </Button>
                  )}
                  {(errorCode === 'dimension-limit' || errorCode === 'tensor-allocation') && (
                    <p className="insp-hint">
                      Try a smaller output scale or a smaller source crop.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="upscale-dialog__footer">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={processing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={
                processing ||
                memoryExceeded ||
                !mode ||
                modelCheckPending ||
                modelMissing ||
                !operationAvailable ||
                noOpRequested ||
                autoActionDisabled
              }
              loading={processing}
              onClick={() => void handleApply()}
            >
              {operation === 'auto'
                ? autoActionDisabled
                  ? autoAnalysis
                    ? 'No supported action'
                    : 'Analyzing…'
                  : autoUsesCustomSettings
                    ? 'Apply custom settings'
                    : 'Apply recommended'
                : operation === 'denoise'
                  ? noOpRequested
                    ? 'No change to apply'
                    : 'Denoise image'
                  : operation === 'deblur'
                    ? 'Deblur image'
                    : operation === 'compression-restoration'
                      ? 'Clean up image'
                      : operation === 'restore-upscale'
                        ? 'Restore and upscale'
                        : operation === 'deblur-upscale'
                          ? 'Deblur and upscale'
                          : mode?.isAi
                            ? 'Upscale with AI'
                            : 'Upscale image'}
            </Button>
          </div>

          {/* Screen-reader announcements */}
          <div role="status" aria-live="polite" className="varve-visually-hidden">
            {processing && progress
              ? `Enhancing: step ${progress.done} of ${progress.total}`
              : (error ?? '')}
          </div>
        </div>
      </FocusTrap>

      {showModelDownload && requiredModelId && (
        <ModelDownloadDialog
          modelId={requiredModelId}
          onClose={() => setShowModelDownload(false)}
          onComplete={() => {
            setShowModelDownload(false);
            setMissingModelIds((ids) => ids.filter((id) => id !== requiredModelId));
          }}
        />
      )}
    </div>
  );
}
