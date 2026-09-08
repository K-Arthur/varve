import { managedColorToRgba } from '@varve/shared';
import {
  type AlphaStrokeOps,
  needsAlphaSilhouetteStroke,
  paintAlphaSilhouetteStroke,
} from './alphaStroke';
import { pathFillRule } from './pathCompound';
import { createGradientStyle } from './replayGradient';
import type { ReplayTarget } from './replayTypes';
import type { EngineColor, FillIR, PathPoint, RenderItem, Stroke } from './types';

export interface StrokeReplayDependencies {
  traceOutline(target: ReplayTarget, primitive: RenderItem['primitive']): void;
  primitiveBounds(primitive: RenderItem['primitive']): {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  alphaStrokeOps: AlphaStrokeOps;
  applyTextCase?(text: string, textCase: string): string;
  effectiveTextWeight?(primitive: Extract<RenderItem['primitive'], { kind: 'text' }>): number;
  measureTextAdvance?(target: ReplayTarget, text: string): number;
  paintTextOnPath?(
    target: ReplayTarget,
    primitive: Extract<RenderItem['primitive'], { kind: 'text' }>,
    stroke: Stroke,
  ): void;
}

export function rgba(
  color: EngineColor | readonly [number, number, number, number],
  opacityOverride?: number,
): string {
  if (color == null) return 'rgba(0, 0, 0, 0)';
  if (Array.isArray(color) || 'length' in color) {
    const tuple = color as readonly [number, number, number, number];
    const alpha = opacityOverride !== undefined ? opacityOverride : tuple[3] / 255;
    return `rgba(${tuple[0]}, ${tuple[1]}, ${tuple[2]}, ${alpha})`;
  }
  const [r, g, b, a] = managedColorToRgba(color as EngineColor);
  const alpha = opacityOverride !== undefined ? opacityOverride : a / 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Convert a stroke gradient to the canonical replay fill form. */
export function gradientStrokeToFill(
  gradient: NonNullable<Stroke['gradient']>,
): Extract<FillIR, { type: 'gradient' }> {
  return {
    type: 'gradient',
    gradientType: gradient.type,
    stops: gradient.stops,
    rotation: gradient.rotation ?? 0,
    interpolationSpace: gradient.interpolationSpace,
    hueInterpolation: gradient.hueInterpolation,
    transform: gradient.transform,
    tilingMode: gradient.tilingMode,
    opacity: 1,
    blendMode: 'normal',
    visible: true,
  };
}

function primitiveHasClosedRegion(primitive: RenderItem['primitive']): boolean {
  if (primitive.kind === 'path') {
    return primitive.closed || (primitive.contours?.length ?? 0) > 0;
  }
  return !['line', 'arrow', 'text', 'table', 'rasterLayer', 'warpedImage'].includes(primitive.kind);
}

function tracePathSegment(target: ReplayTarget, previous: PathPoint, point: PathPoint): void {
  if (previous.handleOut || point.handleIn) {
    const cp1x = previous.handleOut ? previous.x + previous.handleOut[0] : previous.x;
    const cp1y = previous.handleOut ? previous.y + previous.handleOut[1] : previous.y;
    const cp2x = point.handleIn ? point.x + point.handleIn[0] : point.x;
    const cp2y = point.handleIn ? point.y + point.handleIn[1] : point.y;
    target.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, point.x, point.y);
  } else {
    target.lineTo(point.x, point.y);
  }
}

export function tracePathRing(target: ReplayTarget, ring: PathPoint[], closed: boolean): void {
  const first = ring[0];
  if (!first) return;
  target.moveTo(first.x, first.y);
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i];
    const previous = ring[i - 1];
    if (point && previous) tracePathSegment(target, previous, point);
  }
  if (closed && ring.length > 1 && (ring[ring.length - 1]!.handleOut || first.handleIn)) {
    tracePathSegment(target, ring[ring.length - 1]!, first);
  }
  if (closed && ring.length > 1) target.closePath();
}

function paintOutsideAlignedStroke(
  target: ReplayTarget,
  stroke: Stroke,
  item: RenderItem,
  deps: StrokeReplayDependencies,
): boolean {
  if (
    !target.drawImage ||
    (typeof OffscreenCanvas === 'undefined' && typeof document === 'undefined')
  ) {
    return false;
  }

  try {
    const bounds = deps.primitiveBounds(item.primitive);
    const pad = Math.max(2, stroke.weight * 2 + 2);
    const width = Math.max(1, Math.ceil(bounds.w + pad * 2));
    const height = Math.max(1, Math.ceil(bounds.h + pad * 2));
    const surface =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const context = surface.getContext('2d');
    if (!context) return false;
    const isolated = context as unknown as ReplayTarget;
    const ox = bounds.x - pad;
    const oy = bounds.y - pad;
    isolated.translate(-ox, -oy);
    isolated.strokeStyle = stroke.gradient
      ? createGradientStyle(isolated, gradientStrokeToFill(stroke.gradient), item, bounds)
      : rgba(stroke.color);
    isolated.lineWidth = stroke.weight * 2;
    isolated.lineCap = stroke.cap as CanvasLineCap;
    isolated.lineJoin = stroke.join as CanvasLineJoin;
    if (isolated.miterLimit !== undefined) {
      isolated.miterLimit = Math.max(1, stroke.miterLimit ?? 4);
    }
    isolated.lineDashOffset = stroke.dashOffset ?? 0;
    isolated.setLineDash(stroke.dashPattern?.length ? stroke.dashPattern : []);
    isolated.beginPath();
    deps.traceOutline(isolated, item.primitive);
    isolated.stroke();

    isolated.globalCompositeOperation = 'destination-out';
    isolated.beginPath();
    deps.traceOutline(isolated, item.primitive);
    isolated.fill(item.primitive.kind === 'path' ? pathFillRule(item.primitive) : undefined);
    isolated.globalCompositeOperation = 'source-over';
    target.drawImage(surface as unknown as CanvasImageSource, ox, oy, width, height);
    return true;
  } catch {
    return false;
  }
}

function paintPerSideRectStroke(
  target: ReplayTarget,
  primitive: Extract<RenderItem['primitive'], { kind: 'rect' }>,
  stroke: Stroke,
): boolean {
  if (primitive.cornerRadius) return false;
  const weights = stroke.perSideWeights;
  if (!weights) return false;

  const edges: Array<[[number, number], [number, number], number]> = [
    [[primitive.x, primitive.y], [primitive.x + primitive.w, primitive.y], weights[0]],
    [
      [primitive.x + primitive.w, primitive.y],
      [primitive.x + primitive.w, primitive.y + primitive.h],
      weights[1],
    ],
    [
      [primitive.x + primitive.w, primitive.y + primitive.h],
      [primitive.x, primitive.y + primitive.h],
      weights[2],
    ],
    [[primitive.x, primitive.y + primitive.h], [primitive.x, primitive.y], weights[3]],
  ];

  target.save();
  target.lineCap = 'butt';
  for (const [from, to, width] of edges) {
    const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    if (safeWidth <= 0) continue;
    target.lineWidth = safeWidth;
    target.beginPath();
    target.moveTo(from[0], from[1]);
    target.lineTo(to[0], to[1]);
    target.stroke();
  }
  target.restore();
  return true;
}

function pressureScale(pressure: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 0.5)) * 2;
}

function paintVariableWidthPathStroke(
  target: ReplayTarget,
  points: PathPoint[],
  closed: boolean,
  baseWeight: number,
  cap: Stroke['cap'],
  join: Stroke['join'],
): void {
  if (points.length < 2) return;
  target.save();
  target.lineCap = (cap || 'round') as CanvasLineCap;
  target.lineJoin = (join || 'round') as CanvasLineJoin;

  const samples: { x: number; y: number; width: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    const previous = i > 0 ? points[i - 1] : null;
    if (!previous) {
      samples.push({
        x: point.x,
        y: point.y,
        width: Math.max(0, baseWeight * pressureScale(point.pressure ?? 0.5)),
      });
      continue;
    }
    const isBezier = !!(previous.handleOut || point.handleIn);
    const p0x = previous.x;
    const p0y = previous.y;
    const p3x = point.x;
    const p3y = point.y;
    const cp1x = previous.handleOut ? previous.x + previous.handleOut[0] : previous.x;
    const cp1y = previous.handleOut ? previous.y + previous.handleOut[1] : previous.y;
    const cp2x = point.handleIn ? point.x + point.handleIn[0] : point.x;
    const cp2y = point.handleIn ? point.y + point.handleIn[1] : point.y;
    const pStart = previous.pressure ?? 0.5;
    const pEnd = point.pressure ?? 0.5;
    const steps = isBezier ? 12 : Math.max(1, Math.ceil(Math.hypot(p3x - p0x, p3y - p0y) / 3));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const oneMinusT = 1 - t;
      const x = isBezier
        ? oneMinusT * oneMinusT * oneMinusT * p0x +
          3 * oneMinusT * oneMinusT * t * cp1x +
          3 * oneMinusT * t * t * cp2x +
          t * t * t * p3x
        : p0x + (p3x - p0x) * t;
      const y = isBezier
        ? oneMinusT * oneMinusT * oneMinusT * p0y +
          3 * oneMinusT * oneMinusT * t * cp1y +
          3 * oneMinusT * t * t * cp2y +
          t * t * t * p3y
        : p0y + (p3y - p0y) * t;
      const pressure = pStart + (pEnd - pStart) * t;
      samples.push({ x, y, width: Math.max(0, baseWeight * pressureScale(pressure)) });
    }
  }

  if (samples.length < 2) {
    target.restore();
    return;
  }
  target.lineCap = 'round';
  target.lineJoin = 'round';
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!;
    const point = samples[i]!;
    const width = (previous.width + point.width) / 2;
    if (width <= 0) continue;
    target.lineWidth = width;
    target.beginPath();
    target.moveTo(previous.x, previous.y);
    target.lineTo(point.x, point.y);
    target.stroke();
  }
  if (closed && samples.length > 2) {
    const last = samples[samples.length - 1]!;
    const first = samples[0]!;
    const width = (last.width + first.width) / 2;
    if (width > 0) {
      target.lineWidth = width;
      target.beginPath();
      target.moveTo(last.x, last.y);
      target.lineTo(first.x, first.y);
      target.stroke();
    }
  }
  target.restore();
}

function arrowheadSize(primitiveSize: number | undefined, strokeWeight: number): number {
  const fromWeight = Math.max(strokeWeight * 3, 4);
  if (primitiveSize && primitiveSize > 0) {
    return Math.min(Math.max(primitiveSize, fromWeight), Math.max(strokeWeight * 6, fromWeight));
  }
  return fromWeight;
}

function drawArrowhead(
  target: ReplayTarget,
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
  style: NonNullable<Stroke['arrowStart']>,
  isStart: boolean,
): void {
  if (style === 'none') return;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
  const tip = isStart ? from : to;
  const tail = isStart ? to : from;
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const spread = Math.PI / 9;
  const safeSize = Math.max(size, 1);
  target.save();
  target.translate(tip[0], tip[1]);
  target.rotate(angle);
  switch (style) {
    case 'arrow': {
      const baseX = -safeSize;
      const halfW = safeSize * Math.sin(spread);
      target.beginPath();
      target.moveTo(0, 0);
      target.lineTo(baseX, -halfW);
      target.lineTo(baseX, halfW);
      target.closePath();
      target.fill();
      break;
    }
    case 'circle': {
      const radius = safeSize * 0.5;
      target.beginPath();
      target.arc(-radius, 0, radius, 0, Math.PI * 2);
      target.fill();
      break;
    }
    case 'square': {
      const side = safeSize * 0.7;
      target.beginPath();
      target.rect(-side, -side * 0.5, side, side);
      target.fill();
      break;
    }
    case 'diamond': {
      const side = safeSize * 0.6;
      target.beginPath();
      target.moveTo(0, 0);
      target.lineTo(-side, -side * 0.5);
      target.lineTo(-side * 2, 0);
      target.lineTo(-side, side * 0.5);
      target.closePath();
      target.fill();
      break;
    }
  }
  target.restore();
}

function paintTextStroke(
  target: ReplayTarget,
  primitive: Extract<RenderItem['primitive'], { kind: 'text' }>,
  stroke: Stroke,
  deps: StrokeReplayDependencies,
): void {
  if (!target.strokeText) return;
  if (primitive.textMode === 'path' && primitive.pathTextSettings && deps.paintTextOnPath) {
    deps.paintTextOnPath(target, primitive, stroke);
    return;
  }
  const style = primitive.fontStyle === 'italic' ? 'italic ' : '';
  const weight = deps.effectiveTextWeight?.(primitive) ?? primitive.fontWeight;
  target.font = `${style}${weight} ${primitive.fontSize}px "${primitive.fontFamily}"`;
  target.textBaseline = 'top';
  target.textAlign = primitive.textAlign as CanvasTextAlign;
  const applyCase = deps.applyTextCase ?? ((text: string) => text);
  const displayText = applyCase(primitive.text, primitive.textCase);
  const lines = displayText.split('\n');
  const lineHeight = primitive.fontSize * (primitive.lineHeight ?? 1.4);
  const totalHeight = lines.length * lineHeight;
  const verticalOffset =
    primitive.textAlignVertical === 'middle'
      ? (primitive.h - totalHeight) / 2
      : primitive.textAlignVertical === 'bottom'
        ? primitive.h - totalHeight
        : 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const x =
      primitive.textAlign === 'right'
        ? primitive.x + primitive.w
        : primitive.textAlign === 'center'
          ? primitive.x + primitive.w / 2
          : primitive.x;
    target.strokeText(line, x, primitive.y + verticalOffset + index * lineHeight);
  }
}

export function paintStroke(
  target: ReplayTarget,
  stroke: Stroke,
  item: RenderItem,
  deps: StrokeReplayDependencies,
): void {
  target.save();
  target.strokeStyle = stroke.gradient
    ? createGradientStyle(
        target,
        gradientStrokeToFill(stroke.gradient),
        item,
        deps.primitiveBounds(item.primitive),
      )
    : rgba(stroke.color);
  const weight = Number.isFinite(stroke.weight) ? Math.max(0, stroke.weight) : 0;
  const hasPerSideWeight = stroke.perSideWeights?.some((side) => Number.isFinite(side) && side > 0);
  if (weight <= 0 && !hasPerSideWeight) {
    target.restore();
    return;
  }
  target.lineWidth = weight;
  target.lineCap = stroke.cap as CanvasLineCap;
  target.lineJoin = stroke.join as CanvasLineJoin;
  if (target.miterLimit !== undefined) target.miterLimit = Math.max(1, stroke.miterLimit ?? 4);
  target.lineDashOffset = stroke.dashOffset ?? 0;
  target.setLineDash(stroke.dashPattern?.length ? stroke.dashPattern : []);

  if (item.primitive.kind === 'text' && stroke.align === 'center' && target.strokeText) {
    paintTextStroke(target, item.primitive, stroke, deps);
    target.restore();
    return;
  }
  if (needsAlphaSilhouetteStroke(item)) {
    paintAlphaSilhouetteStroke(target, stroke, item, deps.alphaStrokeOps);
    target.restore();
    return;
  }

  const supportsRegionAlignment =
    primitiveHasClosedRegion(item.primitive) && stroke.perSideWeights === undefined;
  if (supportsRegionAlignment && stroke.align === 'inside') {
    target.beginPath();
    deps.traceOutline(target, item.primitive);
    target.clip(item.primitive.kind === 'path' ? pathFillRule(item.primitive) : undefined);
  } else if (supportsRegionAlignment && stroke.align === 'outside') {
    if (paintOutsideAlignedStroke(target, stroke, item, deps)) {
      target.restore();
      return;
    }
  }

  const primitive = item.primitive;
  switch (primitive.kind) {
    case 'rect':
      if (stroke.perSideWeights && paintPerSideRectStroke(target, primitive, stroke)) break;
      if (primitive.cornerRadius && primitive.cornerSmoothing && primitive.cornerSmoothing > 0) {
        deps.traceOutline(target, primitive);
        target.stroke();
      } else if (primitive.cornerRadius && target.roundRect) {
        target.beginPath();
        target.roundRect(
          primitive.x,
          primitive.y,
          primitive.w,
          primitive.h,
          primitive.cornerRadius,
        );
        target.stroke();
      } else {
        target.strokeRect(primitive.x, primitive.y, primitive.w, primitive.h);
      }
      break;
    case 'ellipse':
    case 'circle':
    case 'polygon':
    case 'star':
      target.beginPath();
      deps.traceOutline(target, primitive);
      target.stroke();
      break;
    case 'line': {
      const arrowStart = stroke.arrowStart ?? 'none';
      const arrowEnd = stroke.arrowEnd ?? 'none';
      const hasArrowheads = arrowStart !== 'none' || arrowEnd !== 'none';
      if (hasArrowheads) target.lineCap = 'butt';
      target.beginPath();
      target.moveTo(primitive.from[0], primitive.from[1]);
      target.lineTo(primitive.to[0], primitive.to[1]);
      target.stroke();
      if (hasArrowheads) {
        const size = arrowheadSize(undefined, stroke.weight);
        target.fillStyle = target.strokeStyle;
        if (arrowStart !== 'none')
          drawArrowhead(target, primitive.from, primitive.to, size, arrowStart, true);
        if (arrowEnd !== 'none')
          drawArrowhead(target, primitive.from, primitive.to, size, arrowEnd, false);
      }
      break;
    }
    case 'arrow': {
      const arrowStart = stroke.arrowStart ?? 'none';
      const arrowEnd = stroke.arrowEnd ?? 'arrow';
      const hasArrowheads = arrowStart !== 'none' || arrowEnd !== 'none';
      if (hasArrowheads) target.lineCap = 'butt';
      target.beginPath();
      target.moveTo(primitive.from[0], primitive.from[1]);
      target.lineTo(primitive.to[0], primitive.to[1]);
      target.stroke();
      const size = arrowheadSize(primitive.arrowheadSize, stroke.weight);
      target.fillStyle = target.strokeStyle;
      if (arrowStart !== 'none')
        drawArrowhead(target, primitive.from, primitive.to, size, arrowStart, true);
      if (arrowEnd !== 'none')
        drawArrowhead(target, primitive.from, primitive.to, size, arrowEnd, false);
      break;
    }
    case 'path': {
      const pressures = primitive.points
        .map((point) => point.pressure)
        .filter(
          (pressure): pressure is number => pressure !== undefined && Number.isFinite(pressure),
        );
      const hasPressureVariation =
        pressures.length > 1 && Math.max(...pressures) - Math.min(...pressures) > 0.001;
      if (hasPressureVariation && stroke.weight > 0) {
        paintVariableWidthPathStroke(
          target,
          primitive.points,
          primitive.closed,
          stroke.weight,
          stroke.cap,
          stroke.join,
        );
      } else {
        if (pressures.length > 0 && Math.abs(pressures[0]! - 0.5) > 0.001) {
          target.lineWidth = stroke.weight * pressureScale(pressures[0]!);
        }
        if (target.lineWidth > 0) {
          target.beginPath();
          deps.traceOutline(target, primitive);
          target.stroke();
        }
      }
      break;
    }
    case 'text':
      paintTextStroke(target, primitive, stroke, deps);
      break;
    default:
      break;
  }
  target.restore();
}
