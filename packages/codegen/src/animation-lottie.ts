import type { AnimationKeyframe, Document, Timeline } from '@strata/scene';
import type { EasingDefinition } from '@strata/shared';

interface LottieBezierHandle {
  x: number[];
  y: number[];
}

interface LottieKF {
  t: number;
  s: number[];
  i?: LottieBezierHandle;
  o?: LottieBezierHandle;
}

interface LottieProp {
  a: number;
  k: LottieKF[] | number | number[];
}

interface LottieKS {
  o?: LottieProp;
  r?: LottieProp;
  p: LottieProp;
  s: LottieProp;
  a: LottieProp;
}

interface LottieLayer {
  ind: number;
  ty: number;
  nm: string;
  sr: number;
  ks: LottieKS;
  shapes: unknown[];
}

function easingToLottieHandles(easing: EasingDefinition): {
  i: LottieBezierHandle;
  o: LottieBezierHandle;
} {
  switch (easing.kind) {
    case 'linear':
      return { i: { x: [0], y: [0] }, o: { x: [0], y: [0] } };
    case 'ease':
      return { i: { x: [0.25], y: [1] }, o: { x: [0.25], y: [0.1] } };
    case 'easeIn':
      return { i: { x: [1], y: [1] }, o: { x: [0.42], y: [0] } };
    case 'easeOut':
      return { i: { x: [0.58], y: [1] }, o: { x: [0], y: [0] } };
    case 'easeInOut':
      return { i: { x: [0.58], y: [1] }, o: { x: [0.42], y: [0] } };
    case 'cubicBezier':
      return {
        i: { x: [easing.x2], y: [easing.y2] },
        o: { x: [easing.x1], y: [easing.y1] },
      };
    case 'spring':
      return { i: { x: [0.64], y: [1] }, o: { x: [0.34], y: [1.56] } };
    case 'steps':
      return { i: { x: [0], y: [0] }, o: { x: [0], y: [0] } };
    default:
      return { i: { x: [0], y: [0] }, o: { x: [0], y: [0] } };
  }
}

function valueToLottie(value: unknown, property: string): number {
  if (typeof value === 'number') {
    if (property === 'opacity') return value * 100;
    return value;
  }
  return Number(value) ?? 0;
}

function buildLottieKeyframes(
  keyframes: AnimationKeyframe[],
  property: string,
  totalFrames: number,
  defaultEasing: EasingDefinition,
): LottieKF[] {
  const result: LottieKF[] = [];

  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    if (!kf) continue;
    const frameTime = Math.round(kf.progress * totalFrames);
    const val = valueToLottie(kf.value, property);

    const entry: LottieKF = { t: frameTime, s: [val] };

    if (i < keyframes.length - 1) {
      const nextKf = keyframes[i + 1];
      const easing = nextKf ? (nextKf.easing ?? defaultEasing) : defaultEasing;
      const handles = easingToLottieHandles(easing);
      entry.o = handles.o;
    } else {
      entry.o = { x: [0], y: [0] };
    }

    if (i > 0) {
      const easing = kf.easing ?? defaultEasing;
      const handles = easingToLottieHandles(easing);
      entry.i = handles.i;
    } else {
      entry.i = { x: [0], y: [0] };
    }

    result.push(entry);
  }

  return result;
}

export function timelineToLottieJSON(
  timeline: Timeline,
  doc: Document,
  framerate: number = 30,
): string {
  const totalFrames = Math.round((timeline.duration / 1000) * framerate);

  const tracksByNode = new Map<string, typeof timeline.tracks>();
  for (const track of timeline.tracks) {
    if (track.enabled === false) continue;
    if (!track.keyframes || track.keyframes.length < 2) continue;
    const existing = tracksByNode.get(track.nodeId) ?? [];
    existing.push(track);
    tracksByNode.set(track.nodeId, existing);
  }

  const layers: LottieLayer[] = [];
  let layerIndex = 0;

  for (const [nodeId, tracks] of tracksByNode) {
    const node = doc.nodes[nodeId];
    const layerName = node?.name ?? `Layer ${nodeId}`;

    const ks: LottieKS = {
      p: { a: 0, k: [0, 0] },
      s: { a: 0, k: [100, 100] },
      a: { a: 0, k: [0, 0] },
    };

    for (const track of tracks) {
      const propName = track.property;
      if (propName === 'opacity') {
        ks.o = {
          a: 1,
          k: buildLottieKeyframes(
            track.keyframes,
            track.property,
            totalFrames,
            timeline.defaultEasing ?? { kind: 'linear' },
          ),
        };
      } else if (propName === 'rotation') {
        ks.r = {
          a: 1,
          k: buildLottieKeyframes(
            track.keyframes,
            track.property,
            totalFrames,
            timeline.defaultEasing ?? { kind: 'linear' },
          ),
        };
      }
    }

    layers.push({
      ind: layerIndex,
      ty: 4,
      nm: layerName,
      sr: 1,
      ks,
      shapes: [],
    });
    layerIndex++;
  }

  const lottie = {
    v: '5.5.2',
    fr: framerate,
    ip: 0,
    op: totalFrames,
    w: doc.canvasWidth ?? 1920,
    h: doc.canvasHeight ?? 1080,
    layers,
  };

  return JSON.stringify(lottie, null, 2);
}
