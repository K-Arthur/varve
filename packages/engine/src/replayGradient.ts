import {
  applyAffine,
  expandGradientStops,
  gradientTransformForBounds,
  linearGradientHandles,
  managedColorToNormalized,
  managedColorToRgba,
  multiplyAffine,
} from '@varve/shared';
import { FrameCache } from './frameCache';
import type { ReplayPattern, ReplayTarget } from './replayTypes';
import type { EngineColor, FillIR, RenderItem } from './types';

type GradientFill = Extract<FillIR, { type: 'gradient' }>;
type GradientBounds = { x: number; y: number; w: number; h: number };

function rgba(c: EngineColor | readonly [number, number, number, number]): string {
  if (c == null) return 'rgba(0, 0, 0, 0)';
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3] / 255})`;
  }
  const [r, g, b, a] = managedColorToRgba(c as EngineColor);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/** Format a working gradient color without rounding channels before Canvas2D. */
function rgbaWorking(c: EngineColor | readonly [number, number, number, number]): string {
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3] / 255})`;
  }
  const [r, g, b, a] = managedColorToNormalized(c as EngineColor);
  return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
}

/** Expand gradient stops for canvas API using perceptually uniform interpolation. */
function expandGradientStopsForFill(
  fill: GradientFill,
): { position: number; color: EngineColor }[] {
  // Missing metadata is a legacy gradient, whose original Canvas2D behavior
  // was encoded-sRGB. New gradients carry an explicit resolved space.
  const space = fill.interpolationSpace ?? 'srgb';
  if (space === 'srgb') {
    return fill.stops.map((s) => ({ position: s.position, color: s.color }));
  }
  const inputs = fill.stops.map((s) => {
    const [r, g, b, a] = managedColorToNormalized(s.color);
    return {
      position: s.position,
      color: { space: 'rgb' as const, r: r * 255, g: g * 255, b: b * 255, a: a * 255 },
      ...(s.midpoint !== undefined ? { midpoint: s.midpoint } : {}),
    };
  });
  return expandGradientStops(inputs, space, 16, {
    precision: 'working',
    hueInterpolation: fill.hueInterpolation ?? 'shorter',
  }).map((s) => ({
    position: s.position,
    color: s.color as EngineColor,
  }));
}

/** Module-level gradient cache: maps target/CTM/fill geometry to CanvasGradient | string. */
const gradientCache = new FrameCache<string, CanvasGradient | string>();
const gradientTargetIds = new WeakMap<object, number>();
let nextGradientTargetId = 1;

export function resetGradientCacheForTest(): void {
  gradientCache.clear();
}

export function advanceGradientCacheFrame(): void {
  gradientCache.nextFrame();
  gradientCache.sweep();
}

function gradientCacheKey(
  target: ReplayTarget,
  fill: GradientFill,
  bounds: GradientBounds,
  itemTransform: RenderItem['transform'],
): string {
  const normalizedRotation = ((fill.rotation % 360) + 360) % 360;
  let targetId = gradientTargetIds.get(target as object);
  if (targetId === undefined) {
    targetId = nextGradientTargetId++;
    gradientTargetIds.set(target as object, targetId);
  }
  const ctm = target.getTransform?.();
  const ctmKey = ctm ? `${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f}` : 'unobservable-ctm';
  // Bounds participate in legacy rotation materialization, so preserve their
  // full numeric precision. Quantizing here can reuse a stale gradient during
  // a sub-pixel pointer drag even though the authored field has changed.
  return `${targetId}|${ctmKey}|${itemTransform.join(',')}|${fill.gradientType}|${fill.interpolationSpace ?? ''}|${fill.hueInterpolation ?? ''}|${normalizedRotation}|${fill.tilingMode ?? ''}|${JSON.stringify(fill.transform)}|${JSON.stringify(fill.stops)}|${bounds.x}|${bounds.y}|${bounds.w}|${bounds.h}`;
}

/** CanvasGradient coordinates are in canvas space, while fill geometry is local. */
function gradientPointInTargetSpace(
  target: ReplayTarget,
  point: readonly [number, number],
): readonly [number, number] {
  const ctm = target.getTransform?.();
  return ctm ? applyAffine([ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f], point) : point;
}

/** Create a gradient fillStyle from a FillIR gradient. */
export function createGradientStyle(
  target: ReplayTarget,
  fill: GradientFill,
  item: RenderItem,
  bounds: GradientBounds,
): CanvasGradient | string {
  const stops = fill.stops;
  if (stops.length === 0) return 'rgba(0,0,0,0)';
  if (bounds.w === 0 && bounds.h === 0) {
    const last = stops[stops.length - 1];
    return last ? rgba(last.color) : 'rgba(0,0,0,0)';
  }

  const key = gradientCacheKey(target, fill, bounds, item.transform);
  const cached = gradientCache.get(key);
  if (cached !== undefined) return cached;

  let result: CanvasGradient | string | undefined;
  // Canvas2D gradient coordinates are expressed in the current user space;
  // materialize the canonical field into local coordinates before creating it.
  const transform = gradientTransformForBounds(fill, bounds);
  const [a, b, c, d] = transform;
  const linearLength = Math.hypot(a, b);
  const radialU = Math.hypot(a, b);
  const radialV = Math.hypot(c, d);
  const radialArea = Math.abs(a * d - b * c);
  const canPaint =
    fill.gradientType === 'linear'
      ? linearLength > 0
      : fill.gradientType === 'radial' || fill.gradientType === 'diamond'
        ? radialU > 0 && radialV > 0 && radialArea > 0
        : radialArea > 0;
  if (!canPaint) {
    const last = stops[stops.length - 1];
    result = last ? rgba(last.color) : 'rgba(0,0,0,0)';
  } else {
    const expanded = expandGradientStopsForFill(fill);
    if (fill.gradientType === 'linear' && target.createLinearGradient) {
      const handles = linearGradientHandles(fill, bounds);
      const start = gradientPointInTargetSpace(target, handles.start);
      const end = gradientPointInTargetSpace(target, handles.end);
      const grad = target.createLinearGradient(start[0], start[1], end[0], end[1]);
      for (const s of expanded) grad.addColorStop(s.position, rgbaWorking(s.color));
      result = grad;
    } else if (fill.gradientType === 'radial' && target.createRadialGradient) {
      const center = gradientPointInTargetSpace(target, applyAffine(transform, [0.5, 0.5]));
      const radiusPoint = gradientPointInTargetSpace(target, applyAffine(transform, [1, 0.5]));
      const radius = Math.hypot(radiusPoint[0] - center[0], radiusPoint[1] - center[1]);
      const grad = target.createRadialGradient(
        center[0],
        center[1],
        0,
        center[0],
        center[1],
        radius,
      );
      for (const s of expanded) grad.addColorStop(s.position, rgbaWorking(s.color));
      result = grad;
    } else if (fill.gradientType === 'angular' && target.createConicGradient) {
      const center = gradientPointInTargetSpace(target, applyAffine(transform, [0.5, 0.5]));
      const grad = target.createConicGradient(Math.atan2(b, a), center[0], center[1]);
      for (const s of expanded) grad.addColorStop(s.position, rgbaWorking(s.color));
      result = grad;
    } else if (fill.gradientType === 'diamond' && target.createRadialGradient) {
      const center = gradientPointInTargetSpace(target, applyAffine(transform, [0.5, 0.5]));
      const radiusPoint = gradientPointInTargetSpace(target, applyAffine(transform, [1, 0.5]));
      const radius = Math.hypot(radiusPoint[0] - center[0], radiusPoint[1] - center[1]);
      const grad = target.createRadialGradient(
        center[0],
        center[1],
        0,
        center[0],
        center[1],
        radius,
      );
      for (const s of expanded) grad.addColorStop(s.position, rgbaWorking(s.color));
      result = grad;
    } else {
      result = rgba(stops[0]?.color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 });
    }
  }

  gradientCache.set(key, result);
  return result;
}

/** Paint a tiled (repeat/reflect) gradient fill using an offscreen canvas pattern. */
export function paintTiledGradientFill(
  target: ReplayTarget,
  fill: GradientFill,
  item: RenderItem,
  bounds: GradientBounds,
  tilingMode: 'repeat' | 'reflect',
  paintShapeFill: (target: ReplayTarget, item: RenderItem) => void,
): void {
  if (bounds.w <= 0 || bounds.h <= 0) return;
  // Render one canonical unit-space tile, then map its pixels through the
  // complete fill affine. Reducing this field to centre + angle would discard
  // radial scale and skew, causing tiled fills to drift from normal replay.
  const unitSize = 256;
  const periodUnits = tilingMode === 'reflect' ? 2 : 1;
  const tileWidth = unitSize * periodUnits;
  const expanded = expandGradientStopsForFill(fill);
  const canvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tileWidth, unitSize) : null;

  if (!canvas) {
    target.fillStyle = createGradientStyle(target, fill, item, bounds);
    paintShapeFill(target, item);
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    target.fillStyle = createGradientStyle(target, fill, item, bounds);
    paintShapeFill(target, item);
    return;
  }

  const center = unitSize / 2;
  const grad =
    fill.gradientType === 'radial' || fill.gradientType === 'diamond'
      ? ctx.createRadialGradient(center, center, 0, center, center, center)
      : fill.gradientType === 'angular' && ctx.createConicGradient
        ? ctx.createConicGradient(0, center, center)
        : ctx.createLinearGradient(0, center, unitSize, center);
  for (const s of expanded) grad.addColorStop(s.position, rgbaWorking(s.color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, unitSize, unitSize);

  if (tilingMode === 'reflect') {
    ctx.save();
    ctx.translate(tileWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0, unitSize, unitSize, 0, 0, unitSize, unitSize);
    ctx.restore();
  }

  if (target.createPattern) {
    const pattern = target.createPattern(canvas as unknown as CanvasImageSource, 'repeat');
    if (pattern) {
      const transform = gradientTransformForBounds(fill, bounds);
      const patternTransform = multiplyAffine(transform, [1 / unitSize, 0, 0, 1 / unitSize, 0, 0]);
      if (typeof (pattern as unknown as ReplayPattern).setTransform === 'function') {
        try {
          (pattern as unknown as ReplayPattern).setTransform({
            a: patternTransform[0],
            b: patternTransform[1],
            c: patternTransform[2],
            d: patternTransform[3],
            e: patternTransform[4],
            f: patternTransform[5],
          });
          target.fillStyle = pattern as unknown as CanvasPattern;
          paintShapeFill(target, item);
          return;
        } catch {
          // Use the historical repeat behaviour when a target rejects the
          // pattern transform object.
        }
      }
      target.fillStyle = pattern as unknown as CanvasPattern;
      paintShapeFill(target, item);
      return;
    }
  }
  target.fillStyle = createGradientStyle(target, fill, item, bounds);
  paintShapeFill(target, item);
}
