/**
 * An honest Original / Effects preview for Effect Studio.
 *
 * Effect Studio is object-local, so the comparison deliberately renders only
 * the current selection. Both variants pass through the canonical thumbnail
 * renderer: scene conversion, the engine IR, and live Object Filters. The
 * Studio therefore previews the result it will actually place on the canvas,
 * rather than a decorative gallery thumbnail.
 */
import type { Document, SceneNode } from '@varve/scene';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import { type CSSProperties, useEffect, useState } from 'react';

interface ComparisonImages {
  original?: string;
  effects?: string;
}

type ComparisonView = 'original' | 'effects' | 'compare';

export interface EffectStudioComparisonProps {
  document: Document;
  node: SceneNode | undefined;
  hasEffects: boolean;
}

function documentWithNode(document: Document, node: SceneNode): Document {
  return {
    ...document,
    nodes: {
      ...document.nodes,
      [node.id]: node,
    },
  };
}

/**
 * The two variants differ only in the selected object's Object Filter stack.
 * Parent and adjustment-layer compositing are deliberately outside this small
 * object-local comparison; they remain visible and editable on the canvas.
 */
function comparisonDocuments(
  document: Document,
  node: SceneNode,
): {
  original: Document;
  effects: Document;
} {
  return {
    original: documentWithNode(document, { ...node, smartFiltersEnabled: false }),
    effects: documentWithNode(document, { ...node, smartFiltersEnabled: true }),
  };
}

function previewError(images: ComparisonImages, hasEffects: boolean): string | undefined {
  if (!images.original && !images.effects) {
    return 'The selected object cannot be rendered in this preview yet. Its live result remains available on the canvas.';
  }
  if (!images.original) {
    return 'The original could not be rendered for comparison. The effects render is still shown.';
  }
  if (hasEffects && !images.effects) {
    return 'The effects render could not be generated yet. The original is still shown.';
  }
  return undefined;
}

export function EffectStudioComparison({
  document,
  node,
  hasEffects,
}: EffectStudioComparisonProps) {
  const [images, setImages] = useState<ComparisonImages | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ComparisonView>('compare');
  const [split, setSplit] = useState(50);

  useEffect(() => {
    if (!node) {
      setImages(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setImages(null);
    setLoading(true);

    void (async () => {
      const { renderDocThumbnail } = await import('../../thumbnail/thumbnailService');
      const documents = comparisonDocuments(document, node);
      const source = { type: 'selection' as const, nodeIds: [node.id] };
      const options = {
        source,
        variant: THUMBNAIL_VARIANTS['picker-preview'],
        signal: controller.signal,
      };
      const results = await Promise.allSettled([
        renderDocThumbnail(documents.original, options),
        ...(hasEffects ? [renderDocThumbnail(documents.effects, options)] : []),
      ]);
      if (cancelled) return;

      const original = results[0];
      const effects = results[1];
      const nextImages: ComparisonImages = {
        original: original?.status === 'fulfilled' ? original.value.result?.dataUrl : undefined,
        effects: effects?.status === 'fulfilled' ? effects.value.result?.dataUrl : undefined,
      };
      setImages(nextImages.original || nextImages.effects ? nextImages : null);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) {
        setImages(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [document, hasEffects, node]);

  const canShowOriginal = Boolean(images?.original);
  const canShowEffects = hasEffects && Boolean(images?.effects);
  const activeView: ComparisonView = !canShowEffects
    ? canShowOriginal
      ? 'original'
      : 'effects'
    : !canShowOriginal
      ? 'effects'
      : view;
  const error = images ? previewError(images, hasEffects) : undefined;
  const stageStyle = { '--effect-studio-split': `${split}%` } as CSSProperties;

  return (
    <section
      className="effect-studio-comparison"
      aria-label="With and without object effects"
      data-testid="effect-studio-comparison"
    >
      <div className="effect-studio-comparison__header">
        <div>
          <h3>Live preview</h3>
          <p>Rendered from the selected object’s actual Object Filter stack.</p>
        </div>
        {loading && <span role="status">Rendering preview</span>}
      </div>

      <fieldset className="effect-studio-comparison__modes">
        <legend className="sr-only">Preview mode</legend>
        <button
          type="button"
          aria-pressed={activeView === 'original'}
          disabled={!canShowOriginal}
          onClick={() => setView('original')}
        >
          Original
        </button>
        <button
          type="button"
          aria-pressed={activeView === 'effects'}
          disabled={!canShowEffects}
          onClick={() => setView('effects')}
        >
          Effects
        </button>
        <button
          type="button"
          aria-pressed={activeView === 'compare'}
          disabled={!canShowOriginal || !canShowEffects}
          onClick={() => setView('compare')}
          aria-label="Compare before and after"
        >
          Compare
        </button>
      </fieldset>

      {images ? (
        <>
          <div
            className="effect-studio-comparison__stage"
            data-testid="effect-studio-preview-stage"
            data-view={activeView}
            style={stageStyle}
          >
            {activeView === 'original' && images.original && (
              <img alt="Original selected object without Object Filters" src={images.original} />
            )}
            {activeView === 'effects' && images.effects && (
              <img alt="Selected object with its Object Filters" src={images.effects} />
            )}
            {activeView === 'compare' && images.original && images.effects && (
              <>
                <img
                  alt="Selected object with its Object Filters"
                  className="effect-studio-comparison__effects-image"
                  src={images.effects}
                />
                <img
                  alt="Original selected object without Object Filters"
                  className="effect-studio-comparison__original-image"
                  src={images.original}
                />
                <span className="effect-studio-comparison__divider" aria-hidden="true" />
                <span className="effect-studio-comparison__label effect-studio-comparison__label--before">
                  Original
                </span>
                <span className="effect-studio-comparison__label effect-studio-comparison__label--after">
                  Effects
                </span>
              </>
            )}
          </div>
          {activeView === 'compare' && (
            <label className="effect-studio-comparison__split-control">
              <span>Before and after split</span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={split}
                onChange={(event) => setSplit(Number(event.target.value))}
                aria-label="Before and after split"
              />
              <output>{split}% original</output>
            </label>
          )}
          {error && <p className="effect-studio-comparison__notice">{error}</p>}
        </>
      ) : (
        <p className="effect-studio-comparison__empty">
          {loading
            ? 'Rendering the selected object…'
            : 'Select an object to render its original and effect result here.'}
        </p>
      )}
    </section>
  );
}
