import type { RasterTraceMode, UpscaleMethod, UpscaleProgressFn } from '@strata/engine';
import type { LiveTraceParams, SceneNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { Button, Select } from '@strata/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

/**
 * Upper bound on output memory (4 bytes/px) before we warn the user. Real-ESRGAN
 * tiles add transient per-tile buffers on top, so this is a conservative
 * headline figure; the real peak is ~2× for very large jobs.
 */
const MEMORY_WARNING_BYTES = 256 * 1024 * 1024;
const MEMORY_MAX_BYTES = 1024 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function ImageEnhancementSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    upscaleSelectedImage,
    traceSelectedImage,
    cancelImageProcessing,
    setSelectedLiveTraceParams,
    flattenSelectedLiveTrace,
    clearSelectedLiveTrace,
  } = useEditor();
  const node = nodes[0];
  const thresholdId = useId();
  const colorsId = useId();
  const areaId = useId();
  const simplifyId = useId();
  const maxPathsId = useId();
  const alphaThresholdId = useId();

  const [scale, setScale] = useState(2);
  const [method, setMethod] = useState<UpscaleMethod>('bilinear');
  const [traceMode, setTraceMode] = useState<RasterTraceMode>('monochrome');
  const [threshold, setThreshold] = useState(128);
  const [maxColors, setMaxColors] = useState(8);
  const [minArea, setMinArea] = useState(4);
  const [foreground, setForeground] = useState<'dark' | 'light'>('dark');
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.75);
  const [maxPaths, setMaxPaths] = useState(1000);
  const [alphaThreshold, setAlphaThreshold] = useState(1);
  const [compoundHoles, setCompoundHoles] = useState(true);
  const [pending, setPending] = useState<'upscale' | 'trace' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [replaceSource, setReplaceSource] = useState(false);
  const liveTraceState = node?.kind === 'shape' && 'liveTrace' in node ? node.liveTrace : undefined;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [replaceSource, setReplaceSource] = useState(false);
  const [liveTrace, setLiveTrace] = useState(() => liveTraceState != null);

  // Source image natural dimensions drive the memory + output estimates.
  const imageFill = node && isImageShape(node) ? getImageFill(node) : undefined;
  const naturalWidth = imageFill?.imageWidth ?? (node?.kind === 'shape' ? node.shape.w : 0);
  const naturalHeight = imageFill?.imageHeight ?? (node?.kind === 'shape' ? node.shape.h : 0);
  const aiScale = 4;
  const outW = method === 'ai' ? naturalWidth * aiScale : Math.round(naturalWidth * scale);
  const outH = method === 'ai' ? naturalHeight * aiScale : Math.round(naturalHeight * scale);
  const outputBytes = outW > 0 && outH > 0 ? outW * outH * 4 : 0;
  const memoryWarning = outputBytes > MEMORY_WARNING_BYTES;
  const memoryExceeded = outputBytes > MEMORY_MAX_BYTES;
  const onProgress: UpscaleProgressFn = useMemo(
    () => (done, total) => setProgress({ done, total }),
    [],
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Source image natural dimensions drive the memory + output estimates.
  const imageFill = node && isImageShape(node) ? getImageFill(node) : undefined;
  const naturalWidth = imageFill?.imageWidth ?? (node?.kind === 'shape' ? node.shape.w : 0);
  const naturalHeight = imageFill?.imageHeight ?? (node?.kind === 'shape' ? node.shape.h : 0);
  const aiScale = 4;
  const outW = method === 'ai' ? naturalWidth * aiScale : Math.round(naturalWidth * scale);
  const outH = method === 'ai' ? naturalHeight * aiScale : Math.round(naturalHeight * scale);
  const outputBytes = outW > 0 && outH > 0 ? outW * outH * 4 : 0;
  const memoryWarning = outputBytes > MEMORY_WARNING_BYTES;
  const memoryExceeded = outputBytes > MEMORY_MAX_BYTES;
  const onProgress: UpscaleProgressFn = useMemo(
    () => (done, total) => setProgress({ done, total }),
    [],
  );
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (liveTrace && liveTraceState) {
      const p = liveTraceState.params;
      setTraceMode(p.mode);
      setThreshold(p.threshold);
      setMaxColors(p.maxColors);
      setMinArea(p.minArea);
      setForeground(p.foreground);
      setSimplifyTolerance(p.simplifyTolerance);
      setMaxPaths(p.maxPaths);
      setAlphaThreshold(p.alphaThreshold);
      setCompoundHoles(p.compoundHoles);
    }
  }, [liveTrace, liveTraceState]);

  const liveParams: LiveTraceParams = {
    mode: traceMode,
    threshold,
    foreground,
    alphaThreshold,
    minArea,
    simplifyTolerance,
    maxPaths,
    maxColors,
    compoundHoles,
  };
  const debouncedParams = useDebounce(liveParams, 300);
  const prevParamsRef = useRef<string>('');

  useEffect(() => {
    if (!liveTrace) return;
    const serialized = JSON.stringify(debouncedParams);
    if (serialized === prevParamsRef.current) return;
    prevParamsRef.current = serialized;
    const reqId = ++requestIdRef.current;
    setSelectedLiveTraceParams(debouncedParams);
    const currentParams = { ...debouncedParams };
    (async () => {
      try {
        await traceSelectedImage({ ...currentParams, liveTrace: true });
      } catch {
        // ignore — errors are recorded on the node
      }
      if (reqId !== requestIdRef.current) return;
      setPending(null);
    })();
    setPending('trace');
  }, [debouncedParams, liveTrace, traceSelectedImage, setSelectedLiveTraceParams]);

  if (!node || !isImageShape(node)) return null;

  const run = async (operation: 'upscale' | 'trace') => {
    setError(null);
    setWarning(null);
    setProgress(null);
    setPending(operation);
    try {
      if (operation === 'upscale') {
        await upscaleSelectedImage({
          scale: method === 'ai' ? aiScale : scale,
          method,
          modelId: method === 'ai' ? 'upscale-realesr-general' : undefined,
          onProgress,
          replaceSource,
        });
      } else {
        await traceSelectedImage({
          mode: traceMode,
          threshold,
          maxColors: traceMode === 'monochrome' ? undefined : maxColors,
          foreground,
          minArea,
          simplifyTolerance,
          liveTrace: false,
        });
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Processing failed';
      setError(message === 'cancelled' ? 'Cancelled' : message);
    } finally {
      setPending(null);
      setProgress(null);
    }
  };

  const cancel = () => {
    cancelImageProcessing();
    setPending(null);
    setProgress(null);
    setError('Cancelled');
  };

  const handleRetrace = () => {
    ++requestIdRef.current;
    setError(null);
    prevParamsRef.current = '';
    setPending('trace');
    (async () => {
      try {
        await traceSelectedImage({ ...liveParams, liveTrace: true });
      } catch {
        // errors recorded on node
      }
      setPending(null);
    })();
  };

  const handleFlatten = () => {
    flattenSelectedLiveTrace();
  };

  const traceLabel =
    traceMode === 'color'
      ? 'Trace color'
      : traceMode === 'grayscale'
        ? 'Trace grayscale'
        : 'Trace monochrome';

  const isLiveResolved = liveTraceState?.resolvedAt != null;
  const isLiveError = liveTraceState?.lastError != null;
  const isLiveLoading =
    liveTraceState && liveTraceState.resolvedAt == null && !liveTraceState.lastError;

  const processing = pending === 'upscale';
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <DisclosureSection title="Image & Vector">
      <div className="insp-field-group">
        <p className="insp-subsection__label">Upscale</p>
        <FieldRow label="Scale">
          <Select
            label="Upscale factor"
            value={String(scale)}
            disabled={pending !== null || method === 'ai'}
            options={[
              { value: '2', label: '2x' },
              { value: '3', label: '3x' },
              { value: '4', label: '4x' },
            ]}
            onChange={(v) => setScale(Number(v))}
          />
        </FieldRow>
        <FieldRow label="Method">
          <Select
            label="Upscale method"
            value={method}
            disabled={pending !== null}
            options={[
              { value: 'bilinear', label: 'Smooth (bilinear)' },
              { value: 'bicubic', label: 'High quality (bicubic)' },
              { value: 'nearest', label: 'Hard edges (nearest)' },
              { value: 'ai', label: 'AI detail (Real-ESRGAN, 4x)' },
            ]}
            onChange={(v) => {
              const next = v as UpscaleMethod;
              setMethod(next);
              if (next === 'ai') setScale(4);
            }}
          />
        </FieldRow>
        {naturalWidth > 0 && naturalHeight > 0 && (
          <p className="insp-hint">
            Output {outW}by{outH}px
            {outputBytes > 0 && ` · ~${formatBytes(outputBytes)}`}
            {method === 'ai' && ' · slow, runs locally'}.
          </p>
        )}
        {memoryWarning && (
          <p className="insp-hint insp-hint--warn" role="status">
            {memoryExceeded
              ? `Output exceeds the safe memory limit (${formatBytes(outputBytes)}). Choose a smaller scale.`
              : `Large output (~${formatBytes(outputBytes)}). Processing may be slow or exhaust memory on low-RAM systems.`}
          </p>
        )}
        <FieldRow label="Result">
          <Select
            label="What to do with the upscaled result"
            value={replaceSource ? 'replace' : 'new'}
            disabled={processing}
            options={[
              { value: 'new', label: 'Create new layer' },
              { value: 'replace', label: 'Replace source image' },
            ]}
            onChange={(v) => setReplaceSource(v === 'replace')}
          />
        </FieldRow>
        {processing && progress && progress.total > 0 && (
          <div
            className="insp-progress"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upscaling progress"
          >
            <div className="insp-progress__bar" style={{ width: `${progressPct}%` }} />
            <span className="insp-progress__label">
              Tile {progress.done}/{progress.total}
            </span>
          </div>
        )}
        <p className="insp-hint">
          {method === 'ai'
            ? 'Real-ESRGAN restores detail using the bundled offline model.'
            : 'Processing runs locally on the CPU.'}
        </p>
        <div className="insp-actions">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={processing || memoryExceeded}
            loading={processing}
            onClick={() => void run('upscale')}
          >
            {method === 'ai' ? 'Upscale with AI' : 'Upscale image'}
          </Button>
          {processing && (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <hr className="insp-divider" />

      <div className="insp-field-group">
        <p className="insp-subsection__label">Vectorize</p>

        <FieldRow label="Auto trace">
          <label className="insp-field__control insp-field__control--inline">
            <input
              type="checkbox"
              checked={liveTrace}
              aria-label="Enable auto trace"
              onChange={(event) => {
                setLiveTrace(event.target.checked);
                if (!event.target.checked) {
                  ++requestIdRef.current;
                  cancelImageProcessing();
                  clearSelectedLiveTrace();
                }
              }}
            />
          </label>
        </FieldRow>

        {liveTrace && (
          <>
            {isLiveLoading && (
              <p className="insp-hint" role="status">
                Tracing...
              </p>
            )}
            {isLiveResolved && (
              <p className="insp-hint" role="status">
                Auto trace active
              </p>
            )}
            {isLiveError && (
              <p className="insp-hint insp-hint--error" role="alert">
                {liveTraceState.lastError}
              </p>
            )}
          </>
        )}

        <FieldRow label="Mode">
          <Select
            label="Trace mode"
            value={traceMode}
            disabled={pending !== null}
            options={[
              { value: 'monochrome', label: 'Monochrome' },
              { value: 'grayscale', label: 'Grayscale' },
              { value: 'color', label: 'Color' },
            ]}
            onChange={(v) => setTraceMode(v as RasterTraceMode)}
          />
        </FieldRow>
        {traceMode === 'monochrome' ? (
          <FieldRow label="Threshold" htmlFor={thresholdId}>
            <input
              id={thresholdId}
              type="range"
              className="insp-range"
              min={0}
              max={255}
              value={threshold}
              disabled={pending !== null}
              aria-label="Trace threshold"
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <output htmlFor={thresholdId}>{threshold}</output>
          </FieldRow>
        ) : (
          <FieldRow label="Colors" htmlFor={colorsId}>
            <input
              id={colorsId}
              type="number"
              className="insp-num__input"
              min={2}
              max={32}
              value={maxColors}
              disabled={pending !== null}
              aria-label="Trace color count"
              onChange={(event) =>
                setMaxColors(Math.max(2, Math.min(32, Number(event.target.value) || 2)))
              }
            />
          </FieldRow>
        )}
        <FieldRow label="Min area" htmlFor={areaId}>
          <input
            id={areaId}
            type="number"
            className="insp-num__input"
            min={1}
            max={10000}
            value={minArea}
            disabled={pending !== null}
            aria-label="Minimum trace area"
            onChange={(event) => setMinArea(Math.max(1, Number(event.target.value)))}
          />
        </FieldRow>

        {liveTrace && (
          <button
            type="button"
            className="insp-link-btn"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced'}
          </button>
        )}

        {liveTrace && showAdvanced && (
          <div className="insp-field-group">
            <FieldRow label="Foreground">
              <Select
                label="Foreground extraction"
                value={foreground}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
                onChange={(v) => setForeground(v as 'dark' | 'light')}
              />
            </FieldRow>
            <FieldRow label="Simplify" htmlFor={simplifyId}>
              <input
                id={simplifyId}
                type="range"
                className="insp-range"
                min={0}
                max={5}
                step={0.25}
                value={simplifyTolerance}
                aria-label="Simplify tolerance"
                onChange={(event) => setSimplifyTolerance(Number(event.target.value))}
              />
              <output htmlFor={simplifyId}>{simplifyTolerance.toFixed(2)}</output>
            </FieldRow>
            <FieldRow label="Max paths" htmlFor={maxPathsId}>
              <input
                id={maxPathsId}
                type="number"
                className="insp-num__input"
                min={100}
                max={10000}
                step={100}
                value={maxPaths}
                aria-label="Maximum paths"
                onChange={(event) =>
                  setMaxPaths(Math.max(100, Math.min(10000, Number(event.target.value) || 100)))
                }
              />
            </FieldRow>
            <FieldRow label="Alpha threshold" htmlFor={alphaThresholdId}>
              <input
                id={alphaThresholdId}
                type="number"
                className="insp-num__input"
                min={0}
                max={255}
                value={alphaThreshold}
                aria-label="Alpha threshold"
                onChange={(event) =>
                  setAlphaThreshold(Math.max(0, Math.min(255, Number(event.target.value) || 0)))
                }
              />
            </FieldRow>
            <FieldRow label="Compound holes">
              <label className="insp-field__control insp-field__control--inline">
                <input
                  type="checkbox"
                  checked={compoundHoles}
                  aria-label="Compound holes"
                  onChange={(event) => setCompoundHoles(event.target.checked)}
                />
              </label>
            </FieldRow>
          </div>
        )}

        {liveTrace ? (
          <div className="insp-actions">
            {isLiveResolved && (
              <Button type="button" variant="secondary" size="sm" onClick={handleRetrace}>
                Retrace
              </Button>
            )}
            <Button type="button" variant="primary" size="sm" onClick={handleFlatten}>
              Flatten
            </Button>
            {pending === 'trace' && (
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="insp-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pending !== null}
              loading={pending === 'trace'}
              onClick={() => void run('trace')}
            >
              {traceLabel}
            </Button>
            {pending !== null && (
              <Button type="button" variant="ghost" size="sm" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>

      {warning && (
        <p className="insp-hint" role="status">
          {warning}
        </p>
      )}
      {error && (
        <p className="insp-hint insp-hint--error" role="alert">
          {error}
        </p>
      )}
    </DisclosureSection>
  );
}
