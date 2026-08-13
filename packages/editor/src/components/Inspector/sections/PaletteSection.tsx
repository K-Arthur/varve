import type { PaletteAnalysis, PaletteSwatch } from '@varve/engine';
import {
  addSwatches,
  addVariable as addVariableToStore,
  createVariableStore,
  type Document,
  getImageFill,
  type ManagedColor,
} from '@varve/scene';
import { managedColorToCss, managedColorToRgba } from '@varve/shared';
import { Icon, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../../context';
import {
  analyzePaletteInWorker,
  type PaletteAnalysisRequest,
} from '../../../intelligence/paletteAnalysisService';
import { DisclosureSection } from '../controls/DisclosureSection';

type PaletteStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

interface ImageSource {
  src: string;
  assetId?: string;
  contentHash?: string;
  width: number;
  height: number;
  crop?: { x: number; y: number; w: number; h: number };
  colorProfile?: string;
  label: string;
}

function imageSourceForSelection(doc: Document, selection: string[]): ImageSource | null {
  if (selection.length !== 1) return null;
  const node = doc.nodes[selection[0]!];
  if (node?.kind !== 'shape') return null;
  const fill = getImageFill(node);
  if (fill?.type !== 'image' || !fill.image) return null;
  const asset = fill.image.assetId ? doc.assets?.[fill.image.assetId] : undefined;
  const src = fill.image.src || asset?.dataUrl;
  if (!src) return null;
  const width = asset?.naturalWidth ?? fill.image.imageWidth ?? 0;
  const height = asset?.naturalHeight ?? fill.image.imageHeight ?? 0;
  return {
    src,
    ...(fill.image.assetId ? { assetId: fill.image.assetId } : {}),
    ...(asset?.hash ? { contentHash: asset.hash } : {}),
    width,
    height,
    ...(fill.image.crop ? { crop: fill.image.crop } : {}),
    ...(asset?.metadata?.iccProfileId ? { colorProfile: asset.metadata.iccProfileId } : {}),
    label: asset?.mimeType ?? 'image asset',
  };
}

function createHex(color: ManagedColor): string {
  const [r, g, b] = managedColorToRgba(color);
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function nextAvailableName(usedNames: Set<string>, base: string): string {
  let candidate = base;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    candidate = `${base} ${suffix}`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function loadBoundedPixels(
  source: ImageSource,
  signal: AbortSignal,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Image decoding is unavailable in this runtime.'));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const onAbort = () => {
      image.onload = null;
      image.onerror = null;
      reject(new Error('Palette analysis was cancelled'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    image.onload = () => {
      cleanup();
      if (signal.aborted) {
        reject(new Error('Palette analysis was cancelled'));
        return;
      }
      try {
        const naturalWidth = image.naturalWidth || source.width;
        const naturalHeight = image.naturalHeight || source.height;
        const crop = source.crop
          ? {
              x: Math.max(0, Math.min(naturalWidth - 1, source.crop.x)),
              y: Math.max(0, Math.min(naturalHeight - 1, source.crop.y)),
              w: Math.max(1, Math.min(naturalWidth, source.crop.w)),
              h: Math.max(1, Math.min(naturalHeight, source.crop.h)),
            }
          : { x: 0, y: 0, w: naturalWidth, h: naturalHeight };
        const width = Math.max(1, Math.min(256, Math.round(crop.w)));
        const height = Math.max(1, Math.min(256, Math.round(crop.h)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create an image analysis surface.');
        context.clearRect(0, 0, width, height);
        context.drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        resolve({ width, height, data: new Uint8ClampedArray(pixels.data) });
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Could not read image pixels.'));
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The image could not be decoded for palette analysis.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    image.src = source.src;
  });
}

function colorLabel(swatch: PaletteSwatch): string {
  return `${swatch.roleCandidate.replace('-', ' ')} ${createHex(swatch.color)}`;
}

export function PaletteSection() {
  const { state, updateDoc, setSelectedFill, announce } = useEditor();
  const source = useMemo(
    () => imageSourceForSelection(state.document, state.selection),
    [state.document, state.selection],
  );
  const sourceKey = source
    ? `${source.assetId ?? source.src}:${source.contentHash ?? ''}:${JSON.stringify(source.crop ?? null)}`
    : 'none';
  const abortRef = useRef<AbortController | null>(null);
  const sourceRef = useRef<ImageSource | null>(source);
  sourceRef.current = source;
  const [status, setStatus] = useState<PaletteStatus>('idle');
  const [result, setResult] = useState<PaletteAnalysis | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [colorCount, setColorCount] = useState(6);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const runAnalysis = useCallback(
    async (force = false) => {
      const currentSource = sourceRef.current;
      if (!currentSource) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus('loading');
      setErrorMessage(null);
      setSavedMessage(null);
      try {
        const pixels = await loadBoundedPixels(currentSource, controller.signal);
        const request: PaletteAnalysisRequest = {
          ...pixels,
          source: {
            assetId: currentSource.assetId,
            contentHash: currentSource.contentHash,
            width: pixels.width,
            height: pixels.height,
            crop: currentSource.crop,
            colorProfile: currentSource.colorProfile,
          },
        };
        const analysis = await analyzePaletteInWorker(
          request,
          { colorCount, force },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setResult(analysis);
        setStatus(analysis.extracted.length > 0 ? 'success' : 'empty');
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Palette analysis failed.');
      }
    },
    [colorCount],
  );

  useEffect(() => {
    if (!source) {
      abortRef.current?.abort();
      setStatus('idle');
      setResult(null);
      setErrorMessage(null);
      return;
    }
    void runAnalysis();
    return () => abortRef.current?.abort();
  }, [runAnalysis, sourceKey]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const copyColor = useCallback(
    async (color: ManagedColor) => {
      const hex = createHex(color);
      try {
        await navigator.clipboard?.writeText(hex);
        announce?.(`Copied ${hex}`);
      } catch {
        announce?.(`Color ${hex}`);
      }
    },
    [announce],
  );

  const saveSwatches = useCallback(
    (swatches: PaletteSwatch[]) => {
      if (swatches.length === 0) return;
      updateDoc((doc) => {
        const usedNames = new Set((doc.swatches ?? []).map((swatch) => swatch.name));
        const entries = swatches.map((swatch) => ({
          name: nextAvailableName(usedNames, `Image ${swatch.roleCandidate}`),
          color: swatch.color,
        }));
        return addSwatches(doc, entries);
      });
      const count = swatches.length;
      setSavedMessage(`${count} swatch${count === 1 ? '' : 'es'} saved as new document colors.`);
      announce?.(`Saved ${count} palette swatch${count === 1 ? '' : 'es'}`);
    },
    [announce, updateDoc],
  );

  const saveTokens = useCallback(
    (swatches: PaletteSwatch[]) => {
      if (swatches.length === 0) return;
      updateDoc((doc) => {
        let store = doc.variableStore ?? createVariableStore();
        const usedNames = new Set(Object.values(store.variables).map((variable) => variable.name));
        for (const swatch of swatches) {
          const name = nextAvailableName(usedNames, `image.${swatch.roleCandidate}`);
          store = addVariableToStore(store, {
            name,
            type: 'color',
            valuesByMode: { default: createHex(swatch.color) },
          }).store;
        }
        return { ...doc, variableStore: store };
      });
      const count = swatches.length;
      setSavedMessage(
        `${count} color token${count === 1 ? '' : 's'} added without replacing existing tokens.`,
      );
      announce?.(`Saved ${count} palette token${count === 1 ? '' : 's'}`);
    },
    [announce, updateDoc],
  );

  if (!source) return null;

  return (
    <DisclosureSection title="Palette" sectionId="palette">
      <div className="palette-section__controls">
        <fieldset className="palette-section__source">
          <legend className="palette-section__source-label">From {source.label}</legend>
          <span className="palette-section__source-detail">
            {source.crop ? 'Visible crop' : 'Full image'}; analysis stays local
          </span>
        </fieldset>

        <div className="palette-section__toolbar">
          <label className="palette-section__field-label">
            Colors
            <input
              className="palette-section__count-input"
              type="number"
              min={3}
              max={12}
              value={colorCount}
              onChange={(event) =>
                setColorCount(Math.max(3, Math.min(12, Number(event.target.value) || 6)))
              }
              aria-label="Number of colors to extract"
            />
          </label>
          <button
            type="button"
            className="intelligence-action-btn"
            onClick={() => void runAnalysis(true)}
            disabled={status === 'loading'}
          >
            <Icon name="Palette" label={undefined} size="0.85em" />
            {status === 'loading' ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {status === 'loading' && (
          <div aria-live="polite" className="palette-section__status">
            Analyzing image colors in the background...
          </div>
        )}
        {status === 'error' && (
          <div role="alert" className="palette-section__error">
            {errorMessage ?? 'Palette analysis failed.'}
            <button
              type="button"
              className="palette-section__retry"
              onClick={() => void runAnalysis(true)}
            >
              Retry
            </button>
          </div>
        )}
        {status === 'empty' && (
          <p className="palette-section__hint">
            No meaningful opaque colors were found. Fully transparent artwork has no palette to
            extract.
          </p>
        )}
        {savedMessage && (
          <div role="status" className="palette-section__saved">
            {savedMessage}
          </div>
        )}

        {status === 'success' && result && (
          <PaletteResultView
            result={result}
            copyColor={copyColor}
            onApply={setSelectedFill}
            onSaveSwatches={saveSwatches}
            onSaveTokens={saveTokens}
          />
        )}
      </div>
    </DisclosureSection>
  );
}

interface PaletteResultViewProps {
  result: PaletteAnalysis;
  copyColor: (color: ManagedColor) => Promise<void>;
  onApply: (color: ManagedColor) => void;
  onSaveSwatches: (swatches: PaletteSwatch[]) => void;
  onSaveTokens: (swatches: PaletteSwatch[]) => void;
}

function PaletteResultView({
  result,
  copyColor,
  onApply,
  onSaveSwatches,
  onSaveTokens,
}: PaletteResultViewProps) {
  return (
    <div className="palette-section__result">
      <section aria-labelledby="palette-extracted-title">
        <div className="palette-section__section-heading">
          <h4 id="palette-extracted-title">Extracted colors</h4>
          <span>{Math.round(result.coverage * 100)}% represented</span>
        </div>
        <ul className="palette-section__swatches" aria-label="Extracted colors">
          {result.extracted.map((swatch) => {
            const hex = createHex(swatch.color);
            return (
              <li className="palette-section__swatch-card" key={swatch.id}>
                <Tooltip label={`${colorLabel(swatch)}; click to copy HEX`}>
                  <button
                    type="button"
                    className="palette-section__swatch"
                    style={{ background: managedColorToCss(swatch.color) }}
                    onClick={() => void copyColor(swatch.color)}
                    aria-label={`Copy ${colorLabel(swatch)}`}
                  />
                </Tooltip>
                <span className="palette-section__swatch-value">{hex}</span>
                <span className="palette-section__swatch-role">{swatch.roleCandidate}</span>
                <div className="palette-section__swatch-actions">
                  <button type="button" onClick={() => onApply(swatch.color)}>
                    Use as fill
                  </button>
                  <button type="button" onClick={() => onSaveSwatches([swatch])}>
                    Save
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-section__actions">
          <button
            type="button"
            className="varve-btn varve-btn--secondary"
            onClick={() => onSaveSwatches(result.extracted)}
          >
            Save extracted swatches
          </button>
          <button
            type="button"
            className="varve-btn varve-btn--secondary"
            onClick={() => onSaveTokens(result.extracted)}
          >
            Save as color tokens
          </button>
        </div>
      </section>

      {result.derived.harmonies.length > 0 && (
        <section className="palette-section__derived" aria-labelledby="palette-harmony-title">
          <div className="palette-section__section-heading">
            <h4 id="palette-harmony-title">Derived harmonies</h4>
            <span>Generated, not sampled</span>
          </div>
          {result.derived.harmonies.map((harmony) => (
            <div className="palette-section__harmony" key={harmony.name}>
              <span>{harmony.name}</span>
              <div className="palette-section__harmony-swatches">
                {harmony.colors.map((color, index) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: harmony positions are stable and have no source id
                    key={`${harmony.name}-${index}`}
                    type="button"
                    className="palette-section__harmony-swatch"
                    style={{ background: managedColorToCss(color) }}
                    onClick={() => void copyColor(color)}
                    aria-label={`Copy ${harmony.name} color ${index + 1} ${createHex(color)}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="palette-contrast-title">
        <div className="palette-section__section-heading">
          <h4 id="palette-contrast-title">Accessible pairs</h4>
          <span>WCAG 2.1</span>
        </div>
        {result.contrastPairs.length === 0 ? (
          <p className="palette-section__hint">
            No extracted pair reaches the large-text AA threshold of 3:1.
          </p>
        ) : (
          <div className="palette-section__pairs">
            {result.contrastPairs.slice(0, 6).map((pair) => (
              <div
                className="palette-section__pair"
                key={`${pair.foregroundId}-${pair.backgroundId}`}
              >
                <span
                  className="palette-section__pair-preview"
                  style={{
                    color: managedColorToCss(pair.foreground),
                    background: managedColorToCss(pair.background),
                  }}
                >
                  Aa
                </span>
                <span className="palette-section__pair-values">
                  {createHex(pair.foreground)} on {createHex(pair.background)}
                </span>
                <span className="palette-section__pair-ratio">{pair.ratio.toFixed(1)}:1</span>
                <span
                  className={
                    pair.passesAA ? 'palette-section__pair-pass' : 'palette-section__pair-fail'
                  }
                >
                  {pair.passesAA
                    ? 'Passes body text AA'
                    : pair.passesLargeTextAA
                      ? 'Passes large text AA'
                      : 'Below AA'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {result.warnings.length > 0 && (
        <p className="palette-section__warning" role="note">
          {result.warnings[0]?.message}
        </p>
      )}
    </div>
  );
}
