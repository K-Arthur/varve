/**
 * Image enlargement and raster-to-vector inspector controls.
 *
 * Mirrors other DisclosureSection panels: FieldRow + themed insp-select,
 * @strata/ui Button — not the dead `button--primary` / bare `insp-section` shell.
 *
 * Research basis: Figma image toolbar density; Strata Appearance/Fill sections.
 */
import type { RasterTraceMode, UpscaleMethod } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { Button } from '@strata/ui';
import { useId, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';

export function ImageEnhancementSection({ nodes }: { nodes: SceneNode[] }) {
  const { upscaleSelectedImage, traceSelectedImage, cancelImageProcessing } = useEditor();
  const node = nodes[0];
  const scaleId = useId();
  const methodId = useId();
  const traceModeId = useId();
  const thresholdId = useId();
  const colorsId = useId();
  const areaId = useId();
  const [scale, setScale] = useState(2);
  const [method, setMethod] = useState<UpscaleMethod>('bilinear');
  const [traceMode, setTraceMode] = useState<RasterTraceMode>('monochrome');
  const [threshold, setThreshold] = useState(128);
  const [maxColors, setMaxColors] = useState(8);
  const [minArea, setMinArea] = useState(4);
  const [pending, setPending] = useState<'upscale' | 'trace' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  if (!node || !isImageShape(node)) return null;

  const run = async (operation: 'upscale' | 'trace') => {
    setError(null);
    setWarning(null);
    setPending(operation);
    try {
      if (operation === 'upscale') {
        await upscaleSelectedImage({
          scale: method === 'ai' ? 4 : scale,
          method,
          modelId: method === 'ai' ? 'upscale-realesr-general' : undefined,
        });
      } else {
        await traceSelectedImage({
          mode: traceMode,
          threshold,
          maxColors: traceMode === 'monochrome' ? undefined : maxColors,
          foreground: 'dark',
          minArea,
          simplifyTolerance: 0.75,
        });
      }
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

  const traceLabel =
    traceMode === 'color'
      ? 'Trace color'
      : traceMode === 'grayscale'
        ? 'Trace grayscale'
        : 'Trace monochrome';

  return (
    <DisclosureSection title="Image & Vector">
      <div className="insp-field-group">
        <p className="insp-subsection__label">Upscale</p>
        <FieldRow label="Scale" htmlFor={scaleId}>
          <select
            id={scaleId}
            className="insp-select"
            aria-label="Upscale factor"
            value={scale}
            disabled={pending !== null || method === 'ai'}
            onChange={(event) => setScale(Number(event.target.value))}
          >
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
        </FieldRow>
        <FieldRow label="Method" htmlFor={methodId}>
          <select
            id={methodId}
            className="insp-select"
            aria-label="Upscale method"
            value={method}
            disabled={pending !== null}
            onChange={(event) => {
              const next = event.target.value as UpscaleMethod;
              setMethod(next);
              if (next === 'ai') setScale(4);
            }}
          >
            <option value="bilinear">Smooth (bilinear)</option>
            <option value="bicubic">High quality (bicubic)</option>
            <option value="nearest">Hard edges (nearest)</option>
            <option value="ai">AI detail (Real-ESRGAN, 4x)</option>
          </select>
        </FieldRow>
        <p className="insp-hint">
          Processing runs locally. Real-ESRGAN uses the bundled offline model in a worker.
        </p>
        <div className="insp-actions">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending !== null}
            loading={pending === 'upscale'}
            onClick={() => void run('upscale')}
          >
            Upscale image
          </Button>
        </div>
      </div>

      <hr className="insp-divider" />

      <div className="insp-field-group">
        <p className="insp-subsection__label">Vectorize</p>
        <FieldRow label="Mode" htmlFor={traceModeId}>
          <select
            id={traceModeId}
            className="insp-select"
            aria-label="Trace mode"
            value={traceMode}
            disabled={pending !== null}
            onChange={(event) => setTraceMode(event.target.value as RasterTraceMode)}
          >
            <option value="monochrome">Monochrome</option>
            <option value="grayscale">Grayscale</option>
            <option value="color">Color</option>
          </select>
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
