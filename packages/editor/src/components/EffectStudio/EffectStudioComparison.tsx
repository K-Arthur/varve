/**
 * Canonical before/after viewport for Effect Studio.
 *
 * The comparison receives an explicit accepted baseline and a current
 * candidate. It never toggles the persisted filter bypass to manufacture an
 * "Original" image: that would remove unrelated effects and could disagree
 * with what Cancel is going to restore.
 */
import type { Document, SceneNode } from '@varve/scene';
import { THUMBNAIL_VARIANTS } from '@varve/shared';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { documentRevisionHash, thumbnailIdentity } from '../../thumbnail/identity';
import type { RenderDocThumbnailOutcome } from '../../thumbnail/thumbnailService';
import { renderDocThumbnail } from '../../thumbnail/thumbnailService';

type ComparisonView = 'original' | 'effects' | 'compare';
type ViewportMode = 'fit' | '100%' | '200%';
type OutcomeStatus = RenderDocThumbnailOutcome['status'];

interface PreviewImage {
  dataUrl?: string;
  status: OutcomeStatus;
  warnings: readonly string[];
  fallbackApplied: boolean;
  error?: string;
}

interface ComparisonImages {
  original?: PreviewImage;
  effects?: PreviewImage;
  targetKey: string;
  stale: boolean;
}

interface PreviewImageLayerProps {
  dataUrl: string;
  alt: string;
  className?: string;
}

function PreviewImageLayer({ dataUrl, alt, className }: PreviewImageLayerProps) {
  return (
    <div className={`effect-studio-comparison__image-layer${className ? ` ${className}` : ''}`}>
      <img alt={alt} src={dataUrl} />
    </div>
  );
}

export interface EffectStudioComparisonProps {
  /** Current candidate document. During a draft this contains preview-owned entries. */
  document: Document;
  /** Accepted document captured at draft/live-edit start, when one exists. */
  baselineDocument?: Document | null;
  node: SceneNode | undefined;
  hasEffects: boolean;
  /** A multi-selection is represented by the first target and disclosed here. */
  targetCount?: number;
  targetLabel?: string;
  isDraftPreview?: boolean;
}

const VARIANT = THUMBNAIL_VARIANTS['effect-studio-preview'];

function targetKey(document: Document, node: SceneNode): string {
  return `${document.id}:${node.id}`;
}

function inferStatus(outcome: RenderDocThumbnailOutcome): OutcomeStatus {
  if (outcome.status) return outcome.status;
  const result = outcome.result;
  if (!result?.dataUrl) return 'error';
  if (result.metadata?.isPlaceholder) return 'empty';
  if (result.metadata?.isProvisional) return 'provisional';
  return 'ready';
}

function imageFromOutcome(outcome: RenderDocThumbnailOutcome): PreviewImage {
  const status = inferStatus(outcome);
  return {
    dataUrl: status === 'ready' || status === 'provisional' ? outcome.result?.dataUrl : undefined,
    status,
    warnings: outcome.warnings ?? outcome.result?.metadata?.warnings ?? [],
    fallbackApplied: outcome.fallbackApplied,
    error: outcome.error,
  };
}

function failedImage(error: unknown): PreviewImage {
  return {
    status: 'error',
    warnings: [],
    fallbackApplied: false,
    error: error instanceof Error ? error.message : 'The preview renderer failed.',
  };
}

function isCacheable(outcome: RenderDocThumbnailOutcome): boolean {
  return inferStatus(outcome) === 'ready' && Boolean(outcome.result?.dataUrl);
}

function cacheKey(document: Document, node: SceneNode): string {
  return thumbnailIdentity({
    doc: document,
    source: { type: 'selection', nodeIds: [node.id] },
    variant: VARIANT,
  }).key;
}

function resultMessage(slot: PreviewImage | undefined, side: string): string | undefined {
  if (!slot) return undefined;
  if (slot.status === 'error')
    return `${side} preview failed${slot.error ? `: ${slot.error}` : '.'}`;
  if (slot.status === 'empty') return `${side} preview is empty or unavailable.`;
  if (slot.status === 'cancelled') return `${side} preview was cancelled.`;
  if (slot.status === 'provisional')
    return `${side} preview is provisional while resources settle.`;
  if (slot.fallbackApplied)
    return `${side} preview used its automatic source because the requested source was missing.`;
  if (slot.warnings.length > 0) return `${side} preview warning: ${slot.warnings.join(', ')}.`;
  return undefined;
}

export function EffectStudioComparison({
  document,
  baselineDocument,
  node,
  hasEffects,
  targetCount = 1,
  targetLabel = 'selected object',
  isDraftPreview = false,
}: EffectStudioComparisonProps) {
  const [images, setImages] = useState<ComparisonImages | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ComparisonView>('compare');
  const [split, setSplit] = useState(50);
  const [viewport, setViewport] = useState<ViewportMode>('fit');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [retryNonce, setRetryNonce] = useState(0);
  const [settledCache] = useState(() => new Map<string, RenderDocThumbnailOutcome>());
  const retryScopeRef = useRef('');
  const panStartRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!node) {
      setImages(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const currentTargetKey = targetKey(document, node);
    const acceptedDocument = baselineDocument ?? document;
    const acceptedNode = acceptedDocument.nodes[node.id] as SceneNode | undefined;
    const candidateNode = document.nodes[node.id] as SceneNode | undefined;
    const nextRetryScope = `${currentTargetKey}:${documentRevisionHash(acceptedDocument)}`;
    const source = { type: 'selection' as const, nodeIds: [node.id] };

    setImages((previous) =>
      previous?.targetKey === currentTargetKey ? { ...previous, stale: true } : null,
    );
    setLoading(true);

    const render = (sourceDocument: Document, sourceNode: SceneNode) => {
      const key = cacheKey(sourceDocument, sourceNode);
      const settled = settledCache.get(key);
      if (settled) return Promise.resolve(settled);
      return renderDocThumbnail(sourceDocument, {
        source,
        variant: VARIANT,
        signal: controller.signal,
      }).then((outcome) => {
        if (isCacheable(outcome)) {
          settledCache.set(key, outcome);
          while (settledCache.size > 8) {
            const first = settledCache.keys().next().value as string | undefined;
            if (first === undefined) break;
            settledCache.delete(first);
          }
        }
        return outcome;
      });
    };

    const originalPromise = acceptedNode
      ? render(acceptedDocument, acceptedNode)
      : Promise.reject(new Error('The accepted target is no longer available.'));
    const effectsPromise = hasEffects
      ? candidateNode
        ? render(document, candidateNode)
        : Promise.reject(new Error('The current target is no longer available.'))
      : null;

    void Promise.allSettled([originalPromise, ...(effectsPromise ? [effectsPromise] : [])]).then(
      (results) => {
        if (cancelled) return;
        const originalResult = results[0];
        const effectsResult = results[1];
        const original =
          originalResult?.status === 'fulfilled'
            ? imageFromOutcome(originalResult.value)
            : failedImage(originalResult?.reason);
        const effects = effectsPromise
          ? effectsResult?.status === 'fulfilled'
            ? imageFromOutcome(effectsResult.value)
            : failedImage(effectsResult?.reason)
          : undefined;
        setImages({ original, effects, targetKey: currentTargetKey, stale: false });
        setLoading(false);

        const provisional = original.status === 'provisional' || effects?.status === 'provisional';
        if (provisional && retryScopeRef.current !== nextRetryScope) {
          retryScopeRef.current = nextRetryScope;
          window.setTimeout(() => {
            if (!cancelled) setRetryNonce((value) => value + 1);
          }, 600);
        }
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [baselineDocument, document, hasEffects, node, retryNonce, settledCache]);

  const canShowOriginal = Boolean(images?.original?.dataUrl);
  const canShowEffects = hasEffects && Boolean(images?.effects?.dataUrl);
  const activeView: ComparisonView = !canShowEffects
    ? canShowOriginal
      ? 'original'
      : 'effects'
    : !canShowOriginal
      ? 'effects'
      : view;
  const beforeLabel = isDraftPreview ? 'Before this edit' : 'Accepted state';
  const afterLabel = isDraftPreview ? 'Current candidate' : 'Accepted result';
  const errorMessages = [
    resultMessage(images?.original, beforeLabel),
    hasEffects ? resultMessage(images?.effects, afterLabel) : undefined,
  ].filter((message): message is string => Boolean(message));

  const selectViewport = (mode: ViewportMode) => {
    setViewport(mode);
    setPan({ x: 0, y: 0 });
  };

  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewport === 'fit' || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const handlePreviewPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({
      x: start.originX + event.clientX - start.clientX,
      y: start.originY + event.clientY - start.clientY,
    });
  };

  const stopPreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    panStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const stageStyle = {
    '--effect-studio-split': `${split}%`,
    '--effect-studio-zoom': viewport === '200%' ? '2' : '1',
    '--effect-studio-pan-x': `${pan.x}px`,
    '--effect-studio-pan-y': `${pan.y}px`,
  } as CSSProperties;

  return (
    <section
      className="effect-studio-comparison"
      aria-label={`${beforeLabel} and ${afterLabel}`}
      data-testid="effect-studio-comparison"
    >
      <div className="effect-studio-comparison__header">
        <div>
          <h3>{isDraftPreview ? 'Draft preview' : 'Effect preview'}</h3>
          <p>
            {beforeLabel} versus {afterLabel} for {targetLabel}.
            {targetCount > 1 &&
              ` Representative preview · Apply affects all ${targetCount} selected objects.`}
          </p>
        </div>
        {loading && <span role="status">Updating preview</span>}
      </div>

      <fieldset className="effect-studio-comparison__modes">
        <legend className="sr-only">Preview mode</legend>
        <button
          type="button"
          aria-pressed={activeView === 'original'}
          disabled={!canShowOriginal}
          onClick={() => setView('original')}
          aria-label={beforeLabel}
        >
          Before
        </button>
        <button
          type="button"
          aria-pressed={activeView === 'effects'}
          disabled={!canShowEffects}
          onClick={() => setView('effects')}
          aria-label={afterLabel}
        >
          After
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

      <fieldset className="effect-studio-comparison__zoom">
        <legend>Preview zoom</legend>
        {(['fit', '100%', '200%'] as const).map((mode) => (
          <button
            type="button"
            key={mode}
            aria-pressed={viewport === mode}
            onClick={() => selectViewport(mode)}
            title={
              mode === 'fit'
                ? 'Fit the complete preview bitmap in the viewport'
                : `${mode} uses the preview bitmap at ${mode === '100%' ? '1:1' : '2:1'} pixel scale`
            }
          >
            {mode === 'fit' ? 'Fit' : mode}
          </button>
        ))}
        <button
          type="button"
          aria-label="Center preview"
          disabled={viewport === 'fit' || (pan.x === 0 && pan.y === 0)}
          onClick={() => setPan({ x: 0, y: 0 })}
          title="Center the zoomed preview"
        >
          Center
        </button>
      </fieldset>

      {images ? (
        <>
          <div
            className="effect-studio-comparison__stage"
            data-testid="effect-studio-preview-stage"
            data-view={activeView}
            data-zoom={viewport}
            data-pan-x={pan.x}
            data-pan-y={pan.y}
            style={stageStyle}
            onPointerDown={handlePreviewPointerDown}
            onPointerMove={handlePreviewPointerMove}
            onPointerUp={stopPreviewPan}
            onPointerCancel={stopPreviewPan}
          >
            {activeView === 'original' && images.original?.dataUrl && (
              <PreviewImageLayer
                alt="Original selected object without Object Filters"
                dataUrl={images.original.dataUrl}
              />
            )}
            {activeView === 'effects' && images.effects?.dataUrl && (
              <PreviewImageLayer
                alt="Selected object with its Object Filters"
                dataUrl={images.effects.dataUrl}
              />
            )}
            {activeView === 'compare' && images.original?.dataUrl && images.effects?.dataUrl && (
              <>
                <PreviewImageLayer
                  alt="Selected object with its Object Filters"
                  className="effect-studio-comparison__effects-layer"
                  dataUrl={images.effects.dataUrl}
                />
                <PreviewImageLayer
                  alt="Original selected object without Object Filters"
                  className="effect-studio-comparison__original-layer"
                  dataUrl={images.original.dataUrl}
                />
                <span className="effect-studio-comparison__divider" aria-hidden="true" />
                <span className="effect-studio-comparison__label effect-studio-comparison__label--before">
                  {beforeLabel}
                </span>
                <span className="effect-studio-comparison__label effect-studio-comparison__label--after">
                  {afterLabel}
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
              <output>{split}% before</output>
            </label>
          )}
          {images.stale && (
            <p className="effect-studio-comparison__notice">
              Updating current candidate; showing the last valid frame for this target.
            </p>
          )}
          {errorMessages.map((message) => (
            <p className="effect-studio-comparison__notice" key={message} role="status">
              {message}
            </p>
          ))}
        </>
      ) : (
        <p className="effect-studio-comparison__empty">
          {loading
            ? 'Rendering the selected object…'
            : 'Select an object to render its accepted and candidate states here.'}
        </p>
      )}
    </section>
  );
}
