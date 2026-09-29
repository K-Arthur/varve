import type { Adjustment } from '@varve/engine';
import {
  type CoordSpace,
  type EffectDispatchRequest,
  type EffectPreviewIdentity,
  getEffectPreviewRunner,
  type LiveEffectKind,
  sameEffectPreviewIdentity,
} from '@varve/engine/liveEffects';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './effectKernelPreview.css';

const WIDTH = 112;
const HEIGHT = 72;
const MAX_SOURCE_DIMENSION = 256;
const SAMPLE_COORD_SPACE: CoordSpace = {
  scale: 1,
  originX: 0,
  originY: 0,
  regionX: 0,
  regionY: 0,
};
const EFFECT_KINDS = new Set<LiveEffectKind>([
  'dither',
  'paletteSnap',
  'bloom',
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
]);
const BASE_FIELDS = new Set(['id', 'kind', 'visible', 'opacity', 'blendMode']);

type PreviewState = 'queued' | 'ready' | 'unavailable' | 'error';

const sourceRevisions = new WeakMap<ImageData, number>();
let nextSourceRevision = 0;

function sourceRevisionFor(source: ImageData): number {
  const existing = sourceRevisions.get(source);
  if (existing !== undefined) return existing;
  const revision = ++nextSourceRevision;
  sourceRevisions.set(source, revision);
  return revision;
}

function isUsableSource(source?: ImageData | null, coordSpace?: CoordSpace): source is ImageData {
  return Boolean(
    source &&
      coordSpace &&
      Number.isSafeInteger(source.width) &&
      Number.isSafeInteger(source.height) &&
      source.width > 0 &&
      source.height > 0 &&
      source.width <= MAX_SOURCE_DIMENSION &&
      source.height <= MAX_SOURCE_DIMENSION &&
      source.data.byteLength === source.width * source.height * 4,
  );
}

export function createEffectKernelSample(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (y * WIDTH + x) * 4;
      const inset = Math.min(x, y, WIDTH - 1 - x, HEIGHT - 1 - y);
      const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      const highlight = Math.max(0, 1 - Math.hypot(x - 39, y - 25) / 45);
      pixels[index] = Math.round((checker ? 44 : 82) + highlight * 165);
      pixels[index + 1] = Math.round((checker ? 74 : 48) + highlight * 112);
      pixels[index + 2] = Math.round((checker ? 132 : 96) + highlight * 72);
      pixels[index + 3] = inset < 5 ? Math.round((inset / 5) * 255) : checker ? 255 : 208;
      if ((x % 17 === 0 && y > 12 && y < 59) || (y % 13 === 0 && x > 67 && x < 105)) {
        pixels[index] = 248;
        pixels[index + 1] = 218;
        pixels[index + 2] = 114;
        pixels[index + 3] = Math.max(pixels[index + 3]!, 232);
      }
    }
  }
  return pixels;
}

function requestFor(
  adjustment: Adjustment,
  width: number,
  height: number,
  coordSpace: CoordSpace,
): EffectDispatchRequest | null {
  if (!EFFECT_KINDS.has(adjustment.kind as LiveEffectKind)) return null;
  const params = Object.fromEntries(
    Object.entries(adjustment).filter(([key]) => !BASE_FIELDS.has(key)),
  );
  return {
    effect: adjustment.kind as LiveEffectKind,
    width,
    height,
    quality: 'interactive',
    coordSpace,
    params,
  };
}

export interface EffectKernelPreviewProps {
  adjustment: Adjustment;
  documentId?: string;
  sourceImageData?: ImageData | null;
  sourceCoordSpace?: CoordSpace;
}

export function EffectKernelPreview({
  adjustment,
  documentId,
  sourceImageData,
  sourceCoordSpace,
}: EffectKernelPreviewProps) {
  const previewRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentIdentityRef = useRef<EffectPreviewIdentity | null>(null);
  const [state, setState] = useState<PreviewState>('queued');
  const [isVisible, setIsVisible] = useState(false);
  const hasSource = isUsableSource(sourceImageData, sourceCoordSpace);
  const previewWidth = hasSource ? sourceImageData.width : WIDTH;
  const previewHeight = hasSource ? sourceImageData.height : HEIGHT;
  const coordSpace = hasSource ? sourceCoordSpace! : SAMPLE_COORD_SPACE;
  const sourceRevision = hasSource ? sourceRevisionFor(sourceImageData) : 'sample-rgba-v1';
  const effectiveDocumentId = hasSource
    ? (documentId ?? 'unknown-document')
    : 'canonical-kernel-sample';
  const request = useMemo(
    () => requestFor(adjustment, previewWidth, previewHeight, coordSpace),
    [adjustment, coordSpace, previewHeight, previewWidth],
  );
  const identity = useMemo<EffectPreviewIdentity>(
    () => ({
      ownerId: `live-effect-preview:${effectiveDocumentId}:${adjustment.id}`,
      documentId: effectiveDocumentId,
      targetId: adjustment.id,
      sourceRevision,
      parameterRevision: JSON.stringify(adjustment),
      maskRevision: hasSource ? sourceRevision : 'sample-unmasked',
      timeRevision: 0,
      generation: 0,
    }),
    [adjustment, effectiveDocumentId, hasSource, sourceRevision],
  );

  useLayoutEffect(() => {
    currentIdentityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    let intersects = typeof IntersectionObserver !== 'function';
    const updateVisibility = () => setIsVisible(!document.hidden && intersects);
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            intersects = entries.some(
              (entry) =>
                entry.target === target && entry.isIntersecting && entry.intersectionRatio > 0,
            );
            updateVisibility();
          })
        : null;
    observer?.observe(target);
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      setIsVisible(false);
    };
  }, []);

  useEffect(() => {
    if (!request || !isVisible) return;
    let visible = true;
    const controller = new AbortController();
    const runner = getEffectPreviewRunner();
    setState('queued');

    void runner
      .submit({
        identity,
        request,
        priority: 'visible',
        signal: controller.signal,
        captureSource: () =>
          hasSource ? new Uint8ClampedArray(sourceImageData.data) : createEffectKernelSample(),
        isCurrent: (candidate) =>
          sameEffectPreviewIdentity(candidate, currentIdentityRef.current ?? identity),
      })
      .then((pixels) => {
        if (!visible) return;
        const context = canvasRef.current?.getContext('2d');
        if (!context) {
          setState('error');
          return;
        }
        const imageDataPixels = new Uint8ClampedArray(pixels.length);
        imageDataPixels.set(pixels);
        context.putImageData(new ImageData(imageDataPixels, previewWidth, previewHeight), 0, 0);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!visible || controller.signal.aborted) return;
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        setState(
          code === 'worker-unavailable' || code === 'memory-limit' ? 'unavailable' : 'error',
        );
      });

    return () => {
      visible = false;
      controller.abort();
      runner.cancelOwner(identity.ownerId);
    };
  }, [hasSource, identity, isVisible, previewHeight, previewWidth, request, sourceImageData]);

  if (!request) return null;

  const previewKind = hasSource ? 'upstream adjustment input' : 'kernel sample';
  const previewLabel = hasSource ? 'Upstream source · reduced preview' : 'Kernel sample';
  const statusText =
    state === 'ready'
      ? hasSource
        ? 'Source preview ready; canvas rendering is unchanged.'
        : 'Kernel sample ready'
      : state === 'unavailable'
        ? hasSource
          ? 'Worker preview unavailable; canvas rendering is unchanged.'
          : 'Worker preview unavailable; the canvas remains the artwork preview.'
        : state === 'error'
          ? hasSource
            ? 'Source preview unavailable; canvas rendering is unchanged.'
            : 'Sample unavailable; the canvas remains the artwork preview.'
          : hasSource
            ? 'Rendering the upstream adjustment input…'
            : 'Rendering kernel sample…';

  return (
    <figure
      ref={previewRef}
      className="live-effect-kernel-preview"
      aria-label={`${request.effect} preview of ${previewKind}`}
    >
      <canvas
        ref={canvasRef}
        width={previewWidth}
        height={previewHeight}
        role="img"
        aria-label={
          hasSource
            ? `Reduced worker preview for ${request.effect} on the selected adjustment input; canvas output remains authoritative`
            : `Sample output for ${request.effect}; not the selected artwork`
        }
      />
      <figcaption>
        <span>{previewLabel}</span>
        <span role="status" aria-live="polite">
          {statusText}
        </span>
      </figcaption>
    </figure>
  );
}
