import type { RasterTraceMode } from '@varve/engine';
import type { LiveTraceParams, SceneNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { Button, Select } from '@varve/ui';
import { useEffect, useId, useRef, useState } from 'react';
import { isCapabilityRestricted } from '../../../capabilities/restrictions';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

export function ImageEnhancementSection({ nodes }: { nodes: SceneNode[] }) {
  const {
    openUpscaleDialog,
    openVectorizeDialog,
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

  const [traceMode, setTraceMode] = useState<RasterTraceMode>('monochrome');
  const [threshold, setThreshold] = useState(128);
  const [maxColors, setMaxColors] = useState(8);
  const [minArea, setMinArea] = useState(4);
  const [foreground, setForeground] = useState<'dark' | 'light'>('dark');
  const [simplifyTolerance, setSimplifyTolerance] = useState(0.75);
  const [maxPaths, setMaxPaths] = useState(1000);
  const [alphaThreshold, setAlphaThreshold] = useState(1);
  const [compoundHoles, setCompoundHoles] = useState(true);
  const [pending, setPending] = useState<'trace' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const liveTraceState = node?.kind === 'shape' && 'liveTrace' in node ? node.liveTrace : undefined;
  const [liveTrace, setLiveTrace] = useState(() => liveTraceState != null);
  const [showAdvanced, setShowAdvanced] = useState(false);
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

  // A deployment may withhold on-device inference; the guard at the context
  // stops it running, and this stops the panel offering a button that would
  // silently do nothing.
  if (isCapabilityRestricted('inference')) return null;
  if (!node || !isImageShape(node)) return null;

  const runTrace = async () => {
    setError(null);
    setWarning(null);
    setPending('trace');
    try {
      await traceSelectedImage({
        mode: traceMode,
        threshold,
        maxColors: traceMode === 'monochrome' ? undefined : maxColors,
        foreground,
        minArea,
        simplifyTolerance,
        liveTrace: false,
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Processing failed';
      setError(message === 'cancelled' ? 'Cancelled' : message);
    } finally {
      setPending(null);
    }
  };

  const cancel = () => {
    cancelImageProcessing();
    setPending(null);
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

  return (
    <DisclosureSection title="Image & Vector" sectionId="image-enhancement">
      <div className="insp-field-group">
        <p className="insp-subsection__label">Image Enhance</p>
        <p className="insp-hint">
          Denoise, restore, or enlarge the image with a bounded local workflow.
        </p>
        <div className="insp-actions">
          <Button type="button" variant="primary" size="sm" onClick={() => openUpscaleDialog()}>
            Enhance image…
          </Button>
        </div>
      </div>

      <hr className="insp-divider" />

      <div className="insp-field-group">
        <p className="insp-subsection__label">Vectorize</p>

        <p className="insp-hint">
          Convert the image to editable vector paths. Use the vectorize dialog for presets, source
          preparation, and a live preview.
        </p>
        <div className="insp-actions">
          <Button type="button" variant="secondary" size="sm" onClick={() => openVectorizeDialog()}>
            Open Vectorize Dialog…
          </Button>
        </div>

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
              onClick={() => void runTrace()}
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

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
