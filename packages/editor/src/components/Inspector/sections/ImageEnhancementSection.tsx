/**
 * Image enlargement and raster-to-vector inspector controls.
 *
 * Worker-first CPU dispatch shared by the browser and desktop webview.
 */
import type { RasterTraceMode, UpscaleMethod } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { useState } from 'react';
import { useEditor } from '../../../context';

export function ImageEnhancementSection({ nodes }: { nodes: SceneNode[] }) {
  const { upscaleSelectedImage, traceSelectedImage, cancelImageProcessing } = useEditor();
  const node = nodes[0];
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
    <section className="insp-section" aria-label="Image and vector enhancement">
      <h3 className="insp-section__title">Image and Vector</h3>
      <div className="insp-field">
        <label className="insp-field__label" htmlFor="image-upscale-factor">
          Scale
        </label>
        <div className="insp-field__control">
          <select
            id="image-upscale-factor"
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
        </div>
      </div>
      <div className="insp-field">
        <label className="insp-field__label" htmlFor="image-upscale-method">
          Method
        </label>
        <div className="insp-field__control">
          <select
            id="image-upscale-method"
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
        </div>
      </div>
      <p className="bg-removal__hint">
        Processing runs locally. Real-ESRGAN uses the bundled offline model in a worker.
      </p>
      <div className="bg-removal__actions">
        <button
          type="button"
          className="button--primary"
          disabled={pending !== null}
          onClick={() => void run('upscale')}
        >
          {pending === 'upscale' ? 'Upscaling...' : 'Upscale image'}
        </button>
      </div>
      <hr className="insp-section__divider" />
      <div className="insp-field">
        <label className="insp-field__label" htmlFor="image-trace-mode">
          Trace mode
        </label>
        <div className="insp-field__control">
          <select
            id="image-trace-mode"
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
        </div>
      </div>
      {traceMode === 'monochrome' ? (
        <div className="insp-field">
          <label className="insp-field__label" htmlFor="image-trace-threshold">
            Threshold
          </label>
          <div className="insp-field__control">
            <input
              id="image-trace-threshold"
              type="range"
              min={0}
              max={255}
              value={threshold}
              disabled={pending !== null}
              aria-label="Trace threshold"
              onChange={(event) => setThreshold(Number(event.target.value))}
            />
            <output htmlFor="image-trace-threshold">{threshold}</output>
          </div>
        </div>
      ) : (
        <div className="insp-field">
          <label className="insp-field__label" htmlFor="image-trace-colors">
            Colors
          </label>
          <div className="insp-field__control">
            <input
              id="image-trace-colors"
              type="number"
              min={2}
              max={32}
              value={maxColors}
              disabled={pending !== null}
              aria-label="Trace color count"
              onChange={(event) =>
                setMaxColors(Math.max(2, Math.min(32, Number(event.target.value) || 2)))
              }
            />
          </div>
        </div>
      )}
      <div className="insp-field">
        <label className="insp-field__label" htmlFor="image-trace-area">
          Minimum area
        </label>
        <div className="insp-field__control">
          <input
            id="image-trace-area"
            type="number"
            min={1}
            max={10000}
            value={minArea}
            disabled={pending !== null}
            aria-label="Minimum trace area"
            onChange={(event) => setMinArea(Math.max(1, Number(event.target.value)))}
          />
        </div>
      </div>
      <div className="bg-removal__actions">
        <button
          type="button"
          className="button--primary"
          disabled={pending !== null}
          onClick={() => void run('trace')}
        >
          {pending === 'trace' ? 'Tracing...' : traceLabel}
        </button>
        {pending !== null && (
          <button type="button" className="button--ghost" onClick={cancel}>
            Cancel
          </button>
        )}
      </div>
      {warning && (
        <p className="bg-removal__hint" role="status">
          {warning}
        </p>
      )}
      {error && (
        <p className="bg-removal__hint" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
