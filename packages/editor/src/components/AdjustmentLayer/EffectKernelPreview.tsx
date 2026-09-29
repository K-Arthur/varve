import type { Adjustment } from '@varve/engine';
import {
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

function requestFor(adjustment: Adjustment): EffectDispatchRequest | null {
  if (!EFFECT_KINDS.has(adjustment.kind as LiveEffectKind)) return null;
  const params = Object.fromEntries(
    Object.entries(adjustment).filter(([key]) => !BASE_FIELDS.has(key)),
  );
  return {
    effect: adjustment.kind as LiveEffectKind,
    width: WIDTH,
    height: HEIGHT,
    quality: 'interactive',
    coordSpace: { scale: 1, originX: 0, originY: 0, regionX: 0, regionY: 0 },
    params,
  };
}

export function EffectKernelPreview({ adjustment }: { adjustment: Adjustment }) {
  const previewRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentIdentityRef = useRef<EffectPreviewIdentity | null>(null);
  const [state, setState] = useState<PreviewState>('queued');
  const [isVisible, setIsVisible] = useState(false);
  const request = useMemo(() => requestFor(adjustment), [adjustment]);
  const identity = useMemo<EffectPreviewIdentity>(
    () => ({
      ownerId: `live-effect-sample:${adjustment.id}`,
      documentId: 'canonical-kernel-sample',
      targetId: adjustment.id,
      sourceRevision: 'sample-rgba-v1',
      parameterRevision: JSON.stringify(adjustment),
      maskRevision: 'sample-unmasked',
      timeRevision: 0,
      generation: 0,
    }),
    [adjustment],
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
        captureSource: createEffectKernelSample,
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
        context.putImageData(new ImageData(imageDataPixels, WIDTH, HEIGHT), 0, 0);
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
  }, [identity, isVisible, request]);

  if (!request) return null;

  const statusText =
    state === 'ready'
      ? 'Kernel sample ready'
      : state === 'unavailable'
        ? 'Worker preview unavailable; the canvas remains the artwork preview.'
        : state === 'error'
          ? 'Sample unavailable; the canvas remains the artwork preview.'
          : 'Rendering kernel sample…';

  return (
    <figure
      ref={previewRef}
      className="live-effect-kernel-preview"
      aria-label={`${request.effect} kernel sample`}
    >
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`Sample output for ${request.effect}; not the selected artwork`}
      />
      <figcaption>
        <span>Kernel sample</span>
        <span role="status" aria-live="polite">
          {statusText}
        </span>
      </figcaption>
    </figure>
  );
}
