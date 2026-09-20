/**
 * FrequencySeparationDialog — create or re-split a tone/detail decomposition.
 *
 * The dialog previews the split on a bounded proxy (never the full-resolution
 * layer) and commits the real decomposition to the document in one undo
 * transaction. It targets either a raster layer (create) or an existing
 * separation group (re-split); "never silently discard retouching" is
 * implemented by re-splitting the current recombined state, not the original.
 */

import {
  decomposeFrequencyBands,
  type FrequencySeparationMethod,
  measureReconstruction,
  rasterTilesToImageData,
  reconstructFrequencyBands,
} from '@varve/engine';
import {
  createFrequencySeparation,
  type Document,
  decodeFrequencySeparationTiles,
  frequencySeparationBandNames,
  getFrequencySeparationState,
  type NodeId,
  regenerateFrequencySeparation,
  resolveFrequencySeparation,
  TILE_SIZE,
} from '@varve/scene';
import { Icon, Select } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import './frequencySeparation.css';

type PreviewMode = 'source' | 'combined' | 'tone' | 'detail';

const PREVIEW_MAX_DIMENSION = 420;
const DEFAULT_RADIUS = 8;

interface SourceView {
  nodeId: NodeId;
  name: string;
  width: number;
  height: number;
  mode: 'create' | 're-split';
  existingRadius?: number;
}

function sourceViewFor(doc: Document, targetId: NodeId | null): SourceView | null {
  if (!targetId) return null;
  const node = doc.nodes[targetId];
  if (!node) return null;
  if (node.kind === 'rasterLayer') {
    return {
      nodeId: node.id,
      name: node.name,
      width: node.width,
      height: node.height,
      mode: 'create',
    };
  }
  const state = getFrequencySeparationState(node);
  const resolved = resolveFrequencySeparation(doc, node.id);
  if (state && resolved) {
    const low = doc.nodes[state.lowNodeId];
    if (low?.kind !== 'rasterLayer') return null;
    return {
      nodeId: node.id,
      name: node.name,
      width: low.width,
      height: low.height,
      mode: 're-split',
      existingRadius: state.radius,
    };
  }
  return null;
}

/** Downscaled source pixels for a bounded interactive preview. */
function proxyImage(doc: Document, view: SourceView): ImageData | null {
  let width = view.width;
  let height = view.height;
  let pixels: ImageData | null = null;
  if (view.mode === 'create') {
    const node = doc.nodes[view.nodeId];
    if (node?.kind !== 'rasterLayer') return null;
    pixels = rasterTilesToImageData(node.tiles, width, height, TILE_SIZE);
  } else {
    const decoded = decodeFrequencySeparationTiles(doc, view.nodeId);
    if (!decoded) return null;
    pixels = rasterTilesToImageData(decoded.tiles, decoded.width, decoded.height, TILE_SIZE);
  }
  if (!pixels) return null;
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1) return pixels;
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const small = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(pixels.height - 1, Math.round(((y + 0.5) / height) * pixels.height - 0.5));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(pixels.width - 1, Math.round(((x + 0.5) / width) * pixels.width - 0.5));
      const si = (sy * pixels.width + sx) * 4;
      const di = (y * width + x) * 4;
      small[di] = pixels.data[si]!;
      small[di + 1] = pixels.data[si + 1]!;
      small[di + 2] = pixels.data[si + 2]!;
      small[di + 3] = pixels.data[si + 3]!;
    }
  }
  return new ImageData(small, width, height);
}

export function FrequencySeparationDialog({
  open,
  targetNodeId,
  onClose,
}: {
  open: boolean;
  targetNodeId: NodeId | null;
  onClose: () => void;
}) {
  const {
    state,
    updateDoc,
    announce,
    beginTransaction,
    commitTransaction,
    abortTransaction,
    setSelection,
  } = useEditor();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [method, setMethod] = useState<FrequencySeparationMethod>('gaussian');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('combined');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyFrameRef = useRef<number | null>(null);
  const operationGenerationRef = useRef(0);
  const documentRef = useRef(state.document);
  documentRef.current = state.document;

  const view = useMemo(
    () => sourceViewFor(state.document, targetNodeId),
    [state.document, targetNodeId],
  );

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      titleRef.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setRadius(view?.existingRadius ?? DEFAULT_RADIUS);
      setPreviewMode('combined');
      setError(null);
      setBusy(false);
    }
  }, [open, view?.existingRadius]);

  useEffect(() => {
    if (open) return;
    operationGenerationRef.current += 1;
    if (applyFrameRef.current !== null) {
      cancelAnimationFrame(applyFrameRef.current);
      applyFrameRef.current = null;
    }
    setBusy(false);
  }, [open]);

  useEffect(
    () => () => {
      operationGenerationRef.current += 1;
      if (applyFrameRef.current !== null) cancelAnimationFrame(applyFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open || !view) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setError(null);
    const proxy = proxyImage(state.document, view);
    if (!proxy) {
      setError('This layer has no pixels to separate.');
      return;
    }
    const bands = decomposeFrequencyBands(proxy, { radius, method });
    const image =
      previewMode === 'source'
        ? proxy
        : previewMode === 'tone'
          ? bands.low
          : previewMode === 'detail'
            ? bands.high
            : reconstructFrequencyBands(bands.low, bands.high);
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = image.width;
    offscreen.height = image.height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;
    offCtx.putImageData(image, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(offscreen, 0, 0);
  }, [open, view, state.document, radius, method, previewMode]);

  const stats = useMemo(() => {
    if (!open || !view) return null;
    const proxy = proxyImage(state.document, view);
    if (!proxy) return null;
    const bands = decomposeFrequencyBands(proxy, { radius, method });
    if (previewMode !== 'combined') return null;
    return measureReconstruction(proxy, bands.low, bands.high);
  }, [open, view, state.document, radius, method, previewMode]);

  const cancelPendingApply = useCallback(() => {
    operationGenerationRef.current += 1;
    if (applyFrameRef.current !== null) {
      cancelAnimationFrame(applyFrameRef.current);
      applyFrameRef.current = null;
    }
    setBusy(false);
  }, []);

  const handleClose = useCallback(() => {
    cancelPendingApply();
    onClose();
  }, [cancelPendingApply, onClose]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      // Affinity-style band comparison without leaving the dialog.
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        setPreviewMode((current) =>
          current === 'tone' ? 'detail' : current === 'detail' ? 'combined' : 'tone',
        );
      }
    },
    [handleClose],
  );

  const handleApply = useCallback(() => {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    const generation = ++operationGenerationRef.current;
    const documentAtStart = state.document;
    const targetAtStart = view.nodeId;
    // Yield one frame so the busy state paints before the decomposition.
    applyFrameRef.current = requestAnimationFrame(() => {
      applyFrameRef.current = null;
      if (
        generation !== operationGenerationRef.current ||
        documentRef.current !== documentAtStart ||
        view.nodeId !== targetAtStart
      ) {
        setBusy(false);
        return;
      }
      try {
        if (view.mode === 'create') {
          const result = createFrequencySeparation(state.document, view.nodeId, {
            radius,
            method,
          });
          if (!result) {
            setError('Frequency separation could not be created for this layer.');
            setBusy(false);
            return;
          }
          if (documentRef.current !== documentAtStart) {
            setError('The document changed while preparing the separation. Nothing was applied.');
            setBusy(false);
            return;
          }
          beginTransaction();
          try {
            updateDoc(() => result.doc);
            commitTransaction();
          } catch (applyError) {
            abortTransaction();
            throw applyError;
          }
          setSelection(result.groupId);
          announce(
            `Frequency separation created at ${Math.round(radius)} px (${frequencySeparationBandNames(view.name).tone} / ${frequencySeparationBandNames(view.name).detail})`,
          );
        } else {
          const result = regenerateFrequencySeparation(state.document, view.nodeId, {
            radius,
            method,
          });
          if (!result) {
            setError('Frequency separation could not be re-split.');
            setBusy(false);
            return;
          }
          if (documentRef.current !== documentAtStart) {
            setError('The document changed while preparing the re-split. Nothing was applied.');
            setBusy(false);
            return;
          }
          beginTransaction();
          try {
            updateDoc(() => result.doc);
            commitTransaction();
          } catch (applyError) {
            abortTransaction();
            throw applyError;
          }
          announce(`Frequency separation re-split at ${Math.round(radius)} px`);
        }
        onClose();
      } catch {
        setError('Frequency separation failed. The document was not changed.');
        setBusy(false);
      }
    });
  }, [
    view,
    busy,
    state.document,
    radius,
    method,
    beginTransaction,
    updateDoc,
    commitTransaction,
    abortTransaction,
    setSelection,
    announce,
    onClose,
  ]);

  if (!open) return null;

  const title = view
    ? view.mode === 'create'
      ? `Frequency Separation — ${view.name}`
      : `Re-split — ${view.name}`
    : 'Frequency Separation';

  return (
    <dialog
      ref={dialogRef}
      className="fs-dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleKeyDown}
      onClose={onClose}
    >
      <div className="fs-dialog__header">
        <h2 ref={titleRef} className="fs-dialog__title" tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="fs-dialog__close" aria-label="Close" onClick={handleClose}>
          <Icon name="X" size={14} />
        </button>
      </div>

      {!view ? (
        <div className="fs-dialog__empty" role="status">
          <p>
            Select a raster layer (or an existing separation group) to use frequency separation.
          </p>
        </div>
      ) : (
        <>
          <p className="fs-dialog__target" role="status">
            Target: <strong>{view.name}</strong> · {view.width} x {view.height} layer pixels ·{' '}
            {view.mode === 'create' ? 'new linked Tone / Detail group' : 'existing linked group'}
          </p>
          <div className="fs-dialog__body">
            <div className="fs-dialog__preview-wrap">
              <canvas
                ref={canvasRef}
                className="fs-dialog__preview"
                aria-label="Separation preview"
              />
              <fieldset className="fs-dialog__preview-modes" aria-label="Preview band">
                {(
                  [
                    ['source', 'Before'],
                    ['combined', 'Combined'],
                    ['tone', 'Tone'],
                    ['detail', 'Detail'],
                  ] as [PreviewMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`fs-dialog__mode${previewMode === mode ? ' fs-dialog__mode--active' : ''}`}
                    aria-pressed={previewMode === mode}
                    onClick={() => setPreviewMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
              <p className="fs-dialog__hint">
                Before shows the untouched source. Press F to cycle Tone / Detail / Combined. Detail
                is shown as the stored signed residual (neutral gray = no texture change), not a
                contrast-boosted preview.
              </p>
            </div>

            <div className="fs-dialog__controls">
              <label className="fs-dialog__field" htmlFor="fs-radius">
                <span className="fs-dialog__field-label">Radius</span>
                <span className="fs-dialog__field-value">{Math.round(radius)} px</span>
              </label>
              <input
                id="fs-radius"
                type="range"
                min={1}
                max={64}
                step={1}
                value={radius}
                onChange={(event) => setRadius(Number(event.target.value))}
                className="varve-native-range fs-dialog__slider"
              />
              <p className="fs-dialog__hint">
                Radius is Gaussian sigma in layer pixels — independent of canvas zoom, device pixel
                ratio, and preview scale.
              </p>

              <div className="fs-dialog__field-block">
                <span className="fs-dialog__field-label">Method</span>
                <Select
                  value={method}
                  label="Method"
                  onChange={(value) => setMethod(value as FrequencySeparationMethod)}
                  options={[{ value: 'gaussian', label: 'Gaussian' }]}
                />
              </div>

              {stats && (
                <p className="fs-dialog__stats" role="status">
                  Reconstruction error: max {stats.max} / mean {stats.mean.toFixed(2)} LSB
                </p>
              )}

              {error && (
                <p className="fs-dialog__error" role="alert">
                  {error}
                </p>
              )}

              <p className="fs-dialog__hint">
                {view.mode === 'create'
                  ? 'Creates a Tone layer and a Detail layer in one group. Tone and texture can then be retouched independently; the composite decodes exactly (max 1 LSB).'
                  : 'Re-splits the CURRENT recombined state at the new radius. Existing retouching is preserved as pixels; only the split point moves.'}
              </p>
            </div>
          </div>

          <div className="fs-dialog__footer">
            <button type="button" className="fs-dialog__btn" onClick={handleClose}>
              {busy ? 'Cancel work' : 'Cancel'}
            </button>
            <button
              type="button"
              className="fs-dialog__btn fs-dialog__btn--primary"
              onClick={handleApply}
              disabled={busy}
            >
              {busy ? 'Working…' : view.mode === 'create' ? 'Create Separation' : 'Re-split'}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
