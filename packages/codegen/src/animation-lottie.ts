import type { AnimationKeyframe, Document, Timeline } from '@varve/scene';
import type { EasingDefinition } from '@varve/shared';

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

interface LottieSeparateProp {
  s: number;
  x: LottieProp;
  y: LottieProp;
}

interface LottieKS {
  o?: LottieProp;
  r?: LottieProp;
  p: LottieProp | LottieSeparateProp;
  s: LottieProp;
  a: LottieProp;
  sw?: LottieProp;
  rd?: LottieProp;
  fc?: LottieProp;
  sc?: LottieProp;
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
    if (property === 'scaleX' || property === 'scaleY') return value * 100;
    return value;
  }
  return Number(value) ?? 0;
}

function colorToLottieRgb(color: unknown): [number, number, number] {
  if (!color || typeof color !== 'object') return [0, 0, 0];
  const c = color as Record<string, unknown>;
  if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
    return [c.r / 255, c.g / 255, c.b / 255];
  }
  return [0, 0, 0];
}

function buildColorKeyframes(
  keyframes: AnimationKeyframe[],
  _property: string,
  totalFrames: number,
  defaultEasing: EasingDefinition,
): LottieKF[] {
  const result: LottieKF[] = [];
  for (let i = 0; i < keyframes.length; i++) {
    const kf = keyframes[i];
    if (!kf) continue;
    const frameTime = Math.round(kf.progress * totalFrames);
    const rgb = colorToLottieRgb(kf.value);
    const entry: LottieKF = { t: frameTime, s: rgb };

    if (i < keyframes.length - 1) {
      const nextKf = keyframes[i + 1];
      const easing = nextKf ? (nextKf.easing ?? defaultEasing) : defaultEasing;
      entry.o = easingToLottieHandles(easing).o;
    } else {
      entry.o = { x: [0], y: [0] };
    }

    if (i > 0) {
      const easing = kf.easing ?? defaultEasing;
      entry.i = easingToLottieHandles(easing).i;
    } else {
      entry.i = { x: [0], y: [0] };
    }

    result.push(entry);
  }
  return result;
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

function buildSeparatePositionKeyframes(
  xTrack: { keyframes: AnimationKeyframe[]; property: string },
  yTrack: { keyframes: AnimationKeyframe[]; property: string },
  totalFrames: number,
  defaultEasing: EasingDefinition,
): LottieSeparateProp {
  const xKeyframes = buildLottieKeyframes(
    xTrack.keyframes,
    xTrack.property,
    totalFrames,
    defaultEasing,
  );
  const yKeyframes = buildLottieKeyframes(
    yTrack.keyframes,
    yTrack.property,
    totalFrames,
    defaultEasing,
  );

  return {
    s: 1,
    x: { a: 1, k: xKeyframes },
    y: { a: 1, k: yKeyframes },
  };
}

function buildMultiDimKeyframes(
  tracks: { keyframes: AnimationKeyframe[]; property: string }[],
  totalFrames: number,
  _defaultEasing: EasingDefinition,
): LottieProp {
  const dimCount = tracks.length;
  if (dimCount === 0) {
    return { a: 0, k: [100, 100] };
  }

  const allKeyframeTimes = new Set<number>();
  for (const track of tracks) {
    for (const kf of track.keyframes) {
      allKeyframeTimes.add(Math.round(kf.progress * totalFrames));
    }
  }
  const sortedTimes = [...allKeyframeTimes].sort((a, b) => a - b);

  const k: LottieKF[] = [];
  for (const t of sortedTimes) {
    const s: number[] = [];
    for (const track of tracks) {
      let val = 0;
      for (const kf of track.keyframes) {
        const kfTime = Math.round(kf.progress * totalFrames);
        if (kfTime === t) {
          val = valueToLottie(kf.value, track.property);
          break;
        }
      }
      s.push(val);
    }

    const entry: LottieKF = { t, s };

    const idx = sortedTimes.indexOf(t);
    if (idx < sortedTimes.length - 1) {
      entry.o = { x: [0], y: [0] };
    } else {
      entry.o = { x: [0], y: [0] };
    }
    if (idx > 0) {
      entry.i = { x: [0], y: [0] };
    } else {
      entry.i = { x: [0], y: [0] };
    }

    k.push(entry);
  }

  return { a: 1, k };
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

    const posXTrack = tracks.find((t) => t.property === 'transform[4]');
    const posYTrack = tracks.find((t) => t.property === 'transform[5]');
    const scaleXTrack = tracks.find((t) => t.property === 'scaleX');
    const scaleYTrack = tracks.find((t) => t.property === 'scaleY');
    const strokeWidthTrack = tracks.find((t) => t.property === 'strokeWidth');
    const cornerRadiusTrack = tracks.find((t) => t.property === 'cornerRadius');

    if (posXTrack || posYTrack) {
      if (posXTrack && posYTrack) {
        ks.p = buildSeparatePositionKeyframes(
          { keyframes: posXTrack.keyframes, property: posXTrack.property },
          { keyframes: posYTrack.keyframes, property: posYTrack.property },
          totalFrames,
          timeline.defaultEasing ?? { kind: 'linear' },
        );
      } else if (posXTrack) {
        ks.p = {
          s: 1,
          x: {
            a: 1,
            k: buildLottieKeyframes(
              posXTrack.keyframes,
              posXTrack.property,
              totalFrames,
              timeline.defaultEasing ?? { kind: 'linear' },
            ),
          },
          y: { a: 0, k: [0, 0] },
        };
      } else if (posYTrack) {
        ks.p = {
          s: 1,
          x: { a: 0, k: [0, 0] },
          y: {
            a: 1,
            k: buildLottieKeyframes(
              posYTrack.keyframes,
              posYTrack.property,
              totalFrames,
              timeline.defaultEasing ?? { kind: 'linear' },
            ),
          },
        };
      }
    }

    if (scaleXTrack || scaleYTrack) {
      const scaleTracks: { keyframes: AnimationKeyframe[]; property: string }[] = [];
      if (scaleXTrack) {
        scaleTracks.push({ keyframes: scaleXTrack.keyframes, property: 'scaleX' });
      }
      if (scaleYTrack) {
        scaleTracks.push({ keyframes: scaleYTrack.keyframes, property: 'scaleY' });
      }
      if (scaleTracks.length === 2) {
        ks.s = buildMultiDimKeyframes(
          scaleTracks,
          totalFrames,
          timeline.defaultEasing ?? { kind: 'linear' },
        );
      } else if (scaleTracks[0]) {
        const singleTrack = scaleTracks[0];
        ks.s = {
          a: 1,
          k: buildLottieKeyframes(
            singleTrack.keyframes,
            singleTrack.property,
            totalFrames,
            timeline.defaultEasing ?? { kind: 'linear' },
          ),
        };
      }
    }

    if (strokeWidthTrack) {
      ks.sw = {
        a: 1,
        k: buildLottieKeyframes(
          strokeWidthTrack.keyframes,
          strokeWidthTrack.property,
          totalFrames,
          timeline.defaultEasing ?? { kind: 'linear' },
        ),
      };
    }

    if (cornerRadiusTrack) {
      ks.rd = {
        a: 1,
        k: buildLottieKeyframes(
          cornerRadiusTrack.keyframes,
          cornerRadiusTrack.property,
          totalFrames,
          timeline.defaultEasing ?? { kind: 'linear' },
        ),
      };
    }

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
      } else if (propName === 'fill' || propName.startsWith('fill.')) {
        ks.fc = {
          a: 1,
          k: buildColorKeyframes(
            track.keyframes,
            track.property,
            totalFrames,
            timeline.defaultEasing ?? { kind: 'linear' },
          ),
        };
      } else if (propName === 'stroke' || propName.startsWith('stroke.')) {
        ks.sc = {
          a: 1,
          k: buildColorKeyframes(
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
