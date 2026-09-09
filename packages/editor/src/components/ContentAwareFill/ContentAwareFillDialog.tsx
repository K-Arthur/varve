import {
  type ContentAwareFillQuality,
  GenerativeEditError,
  type GenerativeEditMode,
  type GenerativeEditResult,
  GenerativeJobController,
  getModelLoader,
  QUALITY_DESCRIPTIONS,
  QUALITY_LABELS,
  runGenerativeEdit,
} from '@varve/engine';
import {
  createEmbeddedAsset,
  decodedDataUrlByteLength,
  hashContent,
  imageShapeSrc,
  isImageShape,
} from '@varve/scene';
import { Button, Switch } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { insertDerivedImageShape } from '../../imageOperations';
import './ContentAwareFillDialog.css';

const MODEL_ID = 'lama-inpainting';
const DEFAULT_BRUSH_SIZE = 28;

function loadImageToImageData(src: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

export interface ContentAwareFillDialogProps {
  nodeId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

export function ContentAwareFillDialog({
  nodeId,
  isOpen,
  onClose,
  onApplied,
}: ContentAwareFillDialogProps) {
  const { state, updateDoc, announce } = useEditor();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const jobControllerRef = useRef(new GenerativeJobController());
  const downloadAbortRef = useRef<AbortController | null>(null);
  const isPaintingRef = useRef(false);
  const generationRef = useRef<{
    sourceSignature: string;
    maskDataUrl: string;
    result: GenerativeEditResult;
  } | null>(null);
  const variationSequenceRef = useRef(0);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewAreaRef = useRef<HTMLDivElement | null>(null);

  const [quality, setQuality] = useState<ContentAwareFillQuality>('fast');
  const [mode, setMode] = useState<GenerativeEditMode>('remove');
  const [prompt, setPrompt] = useState('');
  const [brushSize, setBrushSize] = useState(DEFAULT_BRUSH_SIZE);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  type DialogStatus = 'idle' | 'downloading' | 'generating' | 'applying' | 'error';
  const [status, setStatus] = useState<DialogStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerativeEditResult | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [variations, setVariations] = useState<
    Array<{ id: string; dataUrl: string; result: GenerativeEditResult }>
  >([]);
  const [activeVariationId, setActiveVariationId] = useState<string | null>(null);
  const [hasMaskStrokes, setHasMaskStrokes] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<'fit' | 'custom'>('fit');
  const [customZoomBase, setCustomZoomBase] = useState<'fit' | 'natural'>('fit');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [maskVisible, setMaskVisible] = useState(true);
  const [previewViewport, setPreviewViewport] = useState({ width: 0, height: 0 });
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('Preparing');
  const currentRevisionRef = useRef(state.revision);
  currentRevisionRef.current = state.revision;

  const isProcessing = status === 'generating' || status === 'applying';
  const hasResult = previewDataUrl != null && result != null;
  const modeMissingModel = quality === 'ai' && !modelAvailable;
  const modeAvailable = mode === 'fill' || mode === 'remove';

  const node = nodeId ? state.document.nodes[nodeId] : undefined;
  const isImage = Boolean(node && isImageShape(node));
  const typedNode = isImage ? (node as import('@varve/scene').ShapeNode) : null;
  const imageSrc = typedNode ? imageShapeSrc(typedNode) : '';

  const sourceSignature = typedNode
    ? JSON.stringify({
        src: imageSrc,
        assetId: typedNode.fills?.find((fill) => fill.type === 'image')?.image?.assetId,
        shape: typedNode.shape,
        transform: typedNode.transform,
      })
    : '';

  useEffect(() => {
    if (!isOpen) return;
    const area = previewAreaRef.current;
    if (!area) return;
    const measure = () =>
      setPreviewViewport({ width: area.clientWidth, height: area.clientHeight });
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(area);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (isOpen && !el.open) {
      el.showModal();
    } else if (!isOpen && el.open) {
      el.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    jobControllerRef.current.cancel();
    setQuality('fast');
    setMode('remove');
    setPrompt('');
    setBrushSize(DEFAULT_BRUSH_SIZE);
    setStatus('idle');
    setErrorMessage(null);
    setResult(null);
    setPreviewDataUrl(null);
    setVariations([]);
    setActiveVariationId(null);
    generationRef.current = null;
    setHasMaskStrokes(false);
    setShowOriginal(false);
    setPreviewZoom('fit');
    setCustomZoomBase('fit');
    setZoomPercent(100);
    setMaskVisible(true);
    setDownloadProgress(0);
    setGenerationProgress(0);
    setGenerationStage('Preparing');
    setNaturalSize({ w: 0, h: 0 });
  }, [isOpen]);

  useEffect(() => {
    return () => jobControllerRef.current.cancel();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const loader = getModelLoader();
      const available = await loader.isModelAvailable(MODEL_ID);
      if (!cancelled) setModelAvailable(available);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !imageSrc) return;
    let cancelled = false;
    (async () => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = imageSrc;
        });
        if (cancelled) return;

        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        setNaturalSize({ w: nw, h: nh });

        const previewCanvas = previewCanvasRef.current;
        const maskCanvas = maskCanvasRef.current;
        if (previewCanvas) {
          previewCanvas.width = nw;
          previewCanvas.height = nh;
          const ctx = previewCanvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
        }
        if (maskCanvas) {
          maskCanvas.width = nw;
          maskCanvas.height = nh;
          const mctx = maskCanvas.getContext('2d');
          if (mctx) {
            mctx.fillStyle = 'black';
            mctx.fillRect(0, 0, nw, nh);
          }
        }
        setHasMaskStrokes(false);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, imageSrc]);

  const centerPreview = useCallback(() => {
    const area = previewAreaRef.current;
    if (!area) return;
    area.scrollLeft = Math.max(0, (area.scrollWidth - area.clientWidth) / 2);
    area.scrollTop = Math.max(0, (area.scrollHeight - area.clientHeight) / 2);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(centerPreview);
    return () => cancelAnimationFrame(frame);
  }, [centerPreview, naturalSize, previewZoom, zoomPercent, previewViewport]);

  const fitScale =
    naturalSize.w > 0 &&
    naturalSize.h > 0 &&
    previewViewport.width > 0 &&
    previewViewport.height > 0
      ? Math.min(previewViewport.width / naturalSize.w, previewViewport.height / naturalSize.h)
      : 1;
  const displayScale =
    previewZoom === 'fit'
      ? fitScale
      : customZoomBase === 'fit'
        ? fitScale * (zoomPercent / 100)
        : zoomPercent / 100;
  const displayWidth =
    naturalSize.w > 0 ? Math.max(1, Math.round(naturalSize.w * displayScale)) : 0;
  const displayHeight =
    naturalSize.h > 0 ? Math.max(1, Math.round(naturalSize.h * displayScale)) : 0;

  const selectFitZoom = useCallback(() => {
    setCustomZoomBase('fit');
    setPreviewZoom('fit');
  }, []);

  const selectOneToOneZoom = useCallback(() => {
    setCustomZoomBase('natural');
    setZoomPercent(100);
    setPreviewZoom('custom');
  }, []);

  const adjustZoom = useCallback(
    (delta: number) => {
      if (previewZoom === 'fit') setCustomZoomBase('fit');
      setZoomPercent((current) => Math.max(25, Math.min(400, current + delta)));
      setPreviewZoom('custom');
    },
    [previewZoom],
  );

  const paintAt = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = maskCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
      if (!hasMaskStrokes) setHasMaskStrokes(true);
    },
    [brushSize, hasMaskStrokes],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isPaintingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      paintAt(e.clientX, e.clientY);
    },
    [paintAt],
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    isPaintingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const handleClearMask = useCallback(() => {
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasMaskStrokes(false);
  }, []);

  const handleDownload = useCallback(async () => {
    setStatus('downloading');
    setErrorMessage(null);
    setDownloadProgress(0);
    const controller = new AbortController();
    downloadAbortRef.current = controller;
    try {
      const loader = getModelLoader();
      await loader.downloadModel(
        MODEL_ID,
        (loaded, total) => {
          setDownloadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        },
        controller.signal,
      );
      setModelAvailable(true);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Download failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, []);

  const handleCancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!imageSrc || !modeAvailable) return;
    const sourceRevision = currentRevisionRef.current;
    const token = jobControllerRef.current.start(sourceRevision);
    setStatus('generating');
    setErrorMessage(null);
    setGenerationProgress(0);
    setGenerationStage('Preparing');

    try {
      const fullData = await loadImageToImageData(imageSrc);
      if (!jobControllerRef.current.isCurrent(token, currentRevisionRef.current)) {
        throw new GenerativeEditError('stale', 'The source changed before generation completed.');
      }

      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) throw new GenerativeEditError('invalid-mask', 'The mask is unavailable.');

      const fullMaskCanvas = new OffscreenCanvas(fullData.width, fullData.height);
      const fullMaskCtx = fullMaskCanvas.getContext('2d');
      if (!fullMaskCtx) throw new Error('Canvas unavailable');
      fullMaskCtx.imageSmoothingEnabled = false;
      fullMaskCtx.drawImage(maskCanvas, 0, 0, fullData.width, fullData.height);
      const maskImageData = fullMaskCtx.getImageData(0, 0, fullData.width, fullData.height);
      const mask = new Uint8Array(fullData.width * fullData.height);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = maskImageData.data[i * 4]!;
      }
      const maskDataUrl = maskCanvas.toDataURL('image/png');
      let modelPath: string | undefined;
      if (quality === 'ai') {
        const loader = getModelLoader();
        modelPath = (await loader.getModelPath(MODEL_ID, token.signal)) ?? undefined;
        if (!modelPath) {
          throw new GenerativeEditError(
            'missing-model',
            'AI model not found. Download it or choose Draft quality.',
          );
        }
      }

      const generated = await runGenerativeEdit({
        mode,
        imageData: fullData,
        mask,
        maskWidth: fullData.width,
        maskHeight: fullData.height,
        quality: quality === 'fast' ? 'draft' : 'quality',
        prompt,
        seed: sourceRevision,
        signal: token.signal,
        isCurrent: () => jobControllerRef.current.isCurrent(token, currentRevisionRef.current),
        onProgress: ({ stage, progress }) => {
          jobControllerRef.current.update(progress, stage);
          setGenerationProgress(progress);
          setGenerationStage(stage[0]?.toUpperCase() + stage.slice(1));
        },
        modelPath,
      });
      if (!jobControllerRef.current.complete(token, currentRevisionRef.current)) {
        throw new GenerativeEditError('stale', 'The source changed while generation was running.');
      }

      const outCanvas = document.createElement('canvas');
      outCanvas.width = generated.imageData.width;
      outCanvas.height = generated.imageData.height;
      const rctx = outCanvas.getContext('2d');
      if (!rctx) throw new Error('Canvas unavailable');
      rctx.putImageData(generated.imageData, 0, 0);
      const dataUrl = outCanvas.toDataURL('image/png');
      const variationId = `variation-${++variationSequenceRef.current}`;

      generationRef.current = { sourceSignature, maskDataUrl, result: generated };
      setVariations((current) =>
        [...current, { id: variationId, dataUrl, result: generated }].slice(-4),
      );
      setActiveVariationId(variationId);
      setResult(generated);
      setPreviewDataUrl(dataUrl);
      setShowOriginal(false);
      setStatus('idle');
    } catch (err) {
      if (token.signal.aborted) {
        setStatus('idle');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Generative edit failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [imageSrc, modeAvailable, quality, mode, prompt, sourceSignature]);

  const handleApply = useCallback(async () => {
    if (!nodeId || !previewDataUrl || !result) return;
    setStatus('applying');
    setErrorMessage(null);

    try {
      const currentDoc = state.document;
      const sourceNode = currentDoc.nodes[nodeId];
      if (!sourceNode) throw new Error('Source node no longer exists');
      if (!generationRef.current || generationRef.current.sourceSignature !== sourceSignature) {
        throw new GenerativeEditError(
          'stale',
          'The source changed. Generate a fresh result first.',
        );
      }

      const sourceFill =
        sourceNode.kind === 'shape'
          ? sourceNode.fills?.find((fill) => fill.type === 'image')?.image
          : undefined;
      const editId = `generative-edit-${Date.now()}-${++variationSequenceRef.current}`;
      const maskAssetId = `generative-mask-${editId}`;
      const maskDataUrl = generationRef.current.maskDataUrl;
      const maskAsset = {
        id: maskAssetId,
        mimeType: 'image/png' as const,
        dataUrl: maskDataUrl,
        width: result.width,
        height: result.height,
        byteLength: decodedDataUrlByteLength(maskDataUrl),
        checksum: hashContent(maskDataUrl),
      };
      const variationEntries =
        variations.length > 0
          ? variations
          : [{ id: 'variation-1', dataUrl: previewDataUrl, result }];
      const variationAssets = variationEntries.map((variation) =>
        createEmbeddedAsset({
          dataUrl: variation.dataUrl,
          mimeType: 'image/png',
          naturalWidth: variation.result.width,
          naturalHeight: variation.result.height,
        }),
      );
      const activeVariation =
        variationEntries.find((variation) => variation.id === activeVariationId) ??
        variationEntries[variationEntries.length - 1]!;
      const activeAsset = variationAssets[variationEntries.indexOf(activeVariation)]!;
      const now = Date.now();
      const recordBase = {
        schemaVersion: 1 as const,
        id: editId,
        mode,
        sourceNodeId: nodeId,
        ...(sourceFill?.assetId ? { sourceAssetId: sourceFill.assetId } : {}),
        sourceLocator: sourceFill?.assetId
          ? `asset:${sourceFill.assetId}`
          : `inline:${hashContent(imageSrc)}`,
        sourceRevision: state.revision,
        placementRevision: sourceSignature,
        maskAssetId,
        maskWidth: result.width,
        maskHeight: result.height,
        maskCoordinateSpace: 'source-image-pixels' as const,
        settings: {
          quality: result.quality,
          contextPadding: 32,
          maskExpansion: 0,
          feather: 0,
        },
        provider: result.provider,
        variations: variationEntries.map((variation, index) => ({
          id: variation.id,
          assetId: variationAssets[index]!.id,
          width: variation.result.width,
          height: variation.result.height,
          createdAt: now,
          provider: variation.result.provider,
        })),
        activeVariationId: activeVariation.id,
        acceptedVariationId: activeVariation.id,
        createdAt: now,
        updatedAt: now,
      };

      const docWithAssets = {
        ...currentDoc,
        assets: {
          ...currentDoc.assets,
          ...Object.fromEntries(variationAssets.map((asset) => [asset.id, asset])),
        },
        rasterMaskAssets: { ...currentDoc.rasterMaskAssets, [maskAsset.id]: maskAsset },
      };
      const inserted = insertDerivedImageShape(docWithAssets, nodeId, {
        dataUrl: previewDataUrl,
        width: result.width,
        height: result.height,
        suffix: 'filled',
        assetId: activeAsset.id,
        generativeEditId: editId,
      });
      const record = { ...recordBase, resultNodeId: inserted.nodeId };
      updateDoc(() => ({
        ...inserted.doc,
        generativeEdits: { ...inserted.doc.generativeEdits, [editId]: record },
      }));
      announce(
        `${mode[0]?.toUpperCase()}${mode.slice(1)} created (${result.width} x ${result.height})`,
      );
      onApplied?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [
    nodeId,
    previewDataUrl,
    result,
    variations,
    activeVariationId,
    mode,
    sourceSignature,
    imageSrc,
    state.document,
    state.revision,
    updateDoc,
    announce,
    onApplied,
    onClose,
  ]);

  if (!isOpen && !dialogRef.current?.open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="varve-dialog varve-dialog--caf"
      aria-labelledby="caf-dialog-title"
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        if (!isProcessing) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isProcessing) onClose();
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === '+' || e.key === '=') adjustZoom(25);
        if (e.key === '-') adjustZoom(-25);
        if (e.key === '0') selectFitZoom();
        if (e.key === '1') selectOneToOneZoom();
      }}
    >
      <div className="varve-dialog__header">
        <h2 id="caf-dialog-title" className="varve-dialog__title">
          Content-Aware Fill
        </h2>
        <button
          type="button"
          className="varve-dialog__close"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={isProcessing}
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

      <div className="caf-dialog__body">
        <div className="caf-dialog__left">
          <div className="caf-dialog__section">
            <span className="caf-dialog__label">Mode</span>
            <div
              className="caf-dialog__mode-options"
              role="tablist"
              aria-label="Generative edit mode"
            >
              {(['fill', 'remove', 'replace', 'expand'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={mode === candidate}
                  className={`caf-dialog__mode-btn${mode === candidate ? ' caf-dialog__mode-btn--active' : ''}`}
                  onClick={() => {
                    setMode(candidate);
                    setResult(null);
                    setPreviewDataUrl(null);
                    setVariations([]);
                    setActiveVariationId(null);
                    generationRef.current = null;
                  }}
                >
                  {candidate[0]?.toUpperCase()}
                  {candidate.slice(1)}
                </button>
              ))}
            </div>
            <p className="caf-dialog__hint">
              {modeAvailable
                ? 'Paint the pixels to regenerate. The source layer stays untouched.'
                : 'This mode is staged in the workflow, but needs a verified prompt-capable provider.'}
            </p>
          </div>

          {(mode === 'fill' || mode === 'replace') && (
            <div className="caf-dialog__section">
              <label className="caf-dialog__label" htmlFor="caf-dialog-prompt">
                Prompt <span className="caf-dialog__optional">optional</span>
              </label>
              <textarea
                id="caf-dialog-prompt"
                className="caf-dialog__prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe what should appear here"
                rows={3}
                aria-describedby="caf-dialog-provider-note"
              />
            </div>
          )}

          <div className="caf-dialog__provider" id="caf-dialog-provider-note">
            <span className="caf-dialog__provider-dot" aria-hidden="true" />
            <span>
              <strong>Local processing</strong>
              <small>
                {quality === 'fast' ? 'PatchMatch · no download' : 'LaMa · stored on this device'}
              </small>
            </span>
          </div>

          <div className="caf-dialog__section">
            <span className="caf-dialog__label">Quality</span>
            <div className="caf-dialog__quality-options">
              {(['fast', 'ai'] as const).map((q) => (
                <label
                  key={q}
                  className={`caf-dialog__quality-btn${quality === q ? ' caf-dialog__quality-btn--active' : ''}`}
                >
                  <input
                    type="radio"
                    name="caf-quality"
                    value={q}
                    checked={quality === q}
                    onChange={() => setQuality(q)}
                    className="caf-dialog__quality-input"
                  />
                  <span className="caf-dialog__quality-label">{QUALITY_LABELS[q]}</span>
                  <span className="caf-dialog__quality-desc">{QUALITY_DESCRIPTIONS[q]}</span>
                </label>
              ))}
            </div>
          </div>

          {quality === 'ai' && !modelAvailable && status !== 'downloading' && (
            <div className="caf-dialog__section">
              <Button type="button" variant="default" size="sm" onClick={handleDownload}>
                Download AI Model (~208 MB)
              </Button>
              <p className="caf-dialog__hint">One-time download required. Stored locally.</p>
            </div>
          )}

          {status === 'downloading' && (
            <div className="caf-dialog__section">
              <div
                className="caf-dialog__progress"
                role="progressbar"
                aria-valuenow={downloadProgress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="caf-dialog__progress-fill"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
              <p className="caf-dialog__hint" aria-live="polite">
                Downloading… {downloadProgress}%
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={handleCancelDownload}>
                Cancel
              </Button>
            </div>
          )}

          <div className="caf-dialog__section">
            <label className="caf-dialog__label" htmlFor="caf-dialog-brush">
              Brush: {brushSize}px
            </label>
            <input
              id="caf-dialog-brush"
              type="range"
              className="varve-native-range caf-dialog__range"
              min={8}
              max={80}
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </div>

          {!hasResult && (
            <div className="caf-dialog__section">
              <Switch
                className="caf-dialog__checkbox"
                label="Show mask overlay"
                checked={maskVisible}
                onChange={(e) => setMaskVisible(e.target.checked)}
              />
            </div>
          )}

          <div className="caf-dialog__section">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearMask}
              disabled={!hasMaskStrokes || isProcessing}
            >
              Clear Paint
            </Button>
          </div>

          <div className="caf-dialog__section caf-dialog__section--grow">
            {isProcessing ? (
              <div className="caf-dialog__status">
                <span aria-live="polite">
                  {status === 'generating'
                    ? `${generationStage}… ${Math.round(generationProgress * 100)}%`
                    : 'Applying…'}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    jobControllerRef.current.cancel();
                    setStatus('idle');
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!modeAvailable || modeMissingModel || !hasMaskStrokes}
                onClick={handleGenerate}
              >
                {hasResult
                  ? 'Regenerate'
                  : mode === 'remove'
                    ? 'Remove && Fill'
                    : `${mode[0]?.toUpperCase()}${mode.slice(1)}`}
              </Button>
            )}
          </div>

          {status === 'error' && errorMessage && (
            <p className="caf-dialog__error" role="alert">
              {errorMessage}
            </p>
          )}

          {variations.length > 0 && (
            <fieldset className="caf-dialog__section caf-dialog__variations-fieldset">
              <legend className="caf-dialog__label">Variations</legend>
              <div className="caf-dialog__variations">
                {variations.map((variation, index) => (
                  <button
                    type="button"
                    key={variation.id}
                    className={`caf-dialog__variation${activeVariationId === variation.id ? ' caf-dialog__variation--active' : ''}`}
                    onClick={() => {
                      setActiveVariationId(variation.id);
                      setResult(variation.result);
                      setPreviewDataUrl(variation.dataUrl);
                      if (generationRef.current) generationRef.current.result = variation.result;
                    }}
                    aria-label={`Variation ${index + 1}`}
                    aria-pressed={activeVariationId === variation.id}
                  >
                    <img src={variation.dataUrl} alt="" />
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </div>

        <div className="caf-dialog__right">
          <div className="caf-dialog__preview-toolbar">
            <div className="caf-dialog__preview-toggles">
              {hasResult && (
                <button
                  type="button"
                  className={`caf-dialog__toggle-btn${showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
                  onClick={() => setShowOriginal(true)}
                >
                  Original
                </button>
              )}
              {hasResult && (
                <button
                  type="button"
                  className={`caf-dialog__toggle-btn${!showOriginal ? ' caf-dialog__toggle-btn--active' : ''}`}
                  onClick={() => setShowOriginal(false)}
                >
                  Result
                </button>
              )}
              {!hasResult && <span className="caf-dialog__preview-label">Source</span>}
            </div>
            <div className="caf-dialog__preview-zoom">
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Zoom out"
                onClick={() => adjustZoom(-25)}
                disabled={previewZoom === 'custom' && zoomPercent <= 25}
              >
                −
              </button>
              <span className="caf-dialog__zoom-value" aria-live="polite">
                {previewZoom === 'fit' ? 'Fit' : `${zoomPercent}%`}
              </span>
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Zoom in"
                onClick={() => adjustZoom(25)}
                disabled={previewZoom === 'custom' && zoomPercent >= 400}
              >
                +
              </button>
              <button
                type="button"
                className={`caf-dialog__zoom-btn${previewZoom === 'fit' ? ' caf-dialog__zoom-btn--active' : ''}`}
                onClick={selectFitZoom}
              >
                Fit
              </button>
              <button
                type="button"
                className={`caf-dialog__zoom-btn${previewZoom === 'custom' && zoomPercent === 100 ? ' caf-dialog__zoom-btn--active' : ''}`}
                onClick={selectOneToOneZoom}
              >
                1:1
              </button>
              <button
                type="button"
                className="caf-dialog__zoom-btn"
                aria-label="Center preview"
                onClick={centerPreview}
              >
                Center
              </button>
            </div>
          </div>

          <div
            ref={previewAreaRef}
            className={`caf-dialog__preview-area${previewZoom === 'custom' ? ' caf-dialog__preview-area--zoom' : ''}`}
          >
            <div
              className="caf-dialog__preview-stage"
              style={
                displayWidth > 0 && displayHeight > 0
                  ? { width: `${displayWidth}px`, height: `${displayHeight}px` }
                  : undefined
              }
            >
              <canvas
                ref={previewCanvasRef}
                className={`caf-dialog__preview-canvas${showOriginal || !hasResult ? ' caf-dialog__preview-canvas--visible' : ''}`}
              />

              {hasResult && previewDataUrl && (
                <img
                  src={previewDataUrl}
                  alt="Fill result"
                  className={`caf-dialog__preview-canvas${!showOriginal ? ' caf-dialog__preview-canvas--visible' : ''}`}
                />
              )}

              {!hasResult && (
                <canvas
                  ref={maskCanvasRef}
                  className="caf-dialog__mask-canvas"
                  style={{ opacity: maskVisible ? 0.45 : 0 }}
                  aria-label="Paint removal mask"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="caf-dialog__footer">
        <div className="caf-dialog__footer-info">
          {status === 'generating' && (
            <span className="caf-dialog__footer-text" aria-live="polite">
              Running fill…
            </span>
          )}
          {status === 'error' && errorMessage && (
            <span className="caf-dialog__footer-text caf-dialog__footer-text--error" role="alert">
              {errorMessage}
            </span>
          )}
          {status === 'idle' && hasResult && result?.warnings[0] && (
            <span className="caf-dialog__footer-text" title={result.warnings.join(' ')}>
              {result.provider.kind === 'local' ? 'Local result' : 'Provider result'} ·{' '}
              {result.warnings[0]}
            </span>
          )}
        </div>
        <div className="caf-dialog__footer-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!hasResult || isProcessing}
            loading={status === 'applying'}
            onClick={handleApply}
          >
            Apply
          </Button>
        </div>
      </div>
    </dialog>
  );
}
