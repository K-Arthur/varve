import { managedColorToRgba } from '@varve/shared';
import { isVerticalWritingMode } from '@varve/shared/verticalText';
import {
  type AlphaStrokeOps,
  needsAlphaSilhouetteStroke,
  paintAlphaSilhouetteStroke,
} from './alphaStroke';
import { pathFillRule } from './pathCompound';
import { createGradientStyle } from './replayGradient';
import type { ReplayTarget } from './replayTypes';
import type { EngineColor, FillIR, PathPoint, RenderItem, Stroke } from './types';
import { buildVerticalTextSnapshot, paintVerticalCanonicalTextStroke } from './verticalTextReplay';

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

type WidthSample = { x: number; y: number; width: number };

function pointAtDistance(
  samples: WidthSample[],
  distances: number[],
  distance: number,
): WidthSample {
  if (distance <= 0) return samples[0]!;
  const total = distances[distances.length - 1] ?? 0;
  if (distance >= total) return samples[samples.length - 1]!;
  for (let index = 1; index < distances.length; index++) {
    const end = distances[index]!;
    if (distance > end) continue;
    const start = distances[index - 1]!;
    const span = end - start;
    const t = span > 0 ? (distance - start) / span : 0;
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    return {
      x: previous.x + (current.x - previous.x) * t,
      y: previous.y + (current.y - previous.y) * t,
      width: previous.width + (current.width - previous.width) * t,
    };
  }
  return samples[samples.length - 1]!;
}

function splitDashedWidthSamples(
  samples: WidthSample[],
  dashPattern: number[],
  dashOffset: number,
  closed: boolean,
): Array<{ samples: WidthSample[]; closed: boolean }> {
  const positivePattern = dashPattern.filter((value) => Number.isFinite(value) && value >= 0);
  if (positivePattern.length === 0 || !positivePattern.some((value) => value > 0)) {
    return [{ samples, closed }];
  }
  const pattern =
    positivePattern.length % 2 === 1 ? [...positivePattern, ...positivePattern] : positivePattern;
  const totalPattern = pattern.reduce((sum, value) => sum + value, 0);
  if (totalPattern <= 0) return [{ samples, closed }];

  const distances = [0];
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    distances.push(
      distances[index - 1]! + Math.hypot(current.x - previous.x, current.y - previous.y),
    );
  }
  const totalLength = distances[distances.length - 1] ?? 0;
  if (totalLength <= 0) return [];

  const phase = ((-dashOffset % totalPattern) + totalPattern) % totalPattern;
  const stateAt = (distance: number) => {
    let remainingPhase = (phase + distance) % totalPattern;
    for (let index = 0; index < pattern.length; index++) {
      const length = pattern[index]!;
      if (length <= 0) continue;
      if (remainingPhase < length) {
        return { index, remaining: length - remainingPhase };
      }
      remainingPhase -= length;
    }
    return { index: 0, remaining: pattern[0] || totalPattern };
  };

  const runs: Array<{ samples: WidthSample[]; closed: boolean }> = [];
  let distance = 0;
  while (distance < totalLength - 0.0001) {
    const state = stateAt(distance);
    const end = Math.min(totalLength, distance + Math.max(state.remaining, 0.0001));
    if (state.index % 2 === 0 && end - distance > 0.0001) {
      const runSamples = [pointAtDistance(samples, distances, distance)];
      for (let index = 1; index < distances.length - 1; index++) {
        if (distances[index]! > distance && distances[index]! < end) {
          runSamples.push(samples[index]!);
        }
      }
      runSamples.push(pointAtDistance(samples, distances, end));
      if (runSamples.length > 1) runs.push({ samples: runSamples, closed: false });
    }
    distance = end;
  }
  return runs;
}

function appendWidthOutline(
  target: ReplayTarget,
  samples: WidthSample[],
  cap: Stroke['cap'],
  closed: boolean,
): void {
  if (samples.length < 2) return;
  const left: Array<readonly [number, number]> = [];
  const right: Array<readonly [number, number]> = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const previous = samples[Math.max(0, index - 1)]!;
    const next = samples[Math.min(samples.length - 1, index + 1)]!;
    let dx = next.x - previous.x;
    let dy = next.y - previous.y;
    if (Math.hypot(dx, dy) <= 0.001) {
      dx = 1;
      dy = 0;
    }
    const length = Math.hypot(dx, dy);
    const radius = sample.width / 2;
    left.push([sample.x - (dy / length) * radius, sample.y + (dx / length) * radius]);
    right.push([sample.x + (dy / length) * radius, sample.y - (dx / length) * radius]);
  }

  target.moveTo(left[0]![0], left[0]![1]);
  for (let index = 1; index < left.length; index++) {
    target.lineTo(left[index]![0], left[index]![1]);
  }

  if (!closed) {
    const end = samples[samples.length - 1]!;
    const beforeEnd = samples[samples.length - 2]!;
    let dx = end.x - beforeEnd.x;
    let dy = end.y - beforeEnd.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const radius = end.width / 2;
    if (cap === 'square') {
      target.lineTo(right.at(-1)![0] + dx * radius, right.at(-1)![1] + dy * radius);
      target.lineTo(left.at(-1)![0] + dx * radius, left.at(-1)![1] + dy * radius);
    } else if (cap === 'round') {
      const angle = Math.atan2(dy, dx);
      target.arc(end.x, end.y, radius, angle + Math.PI / 2, angle - Math.PI / 2);
    } else {
      target.lineTo(right.at(-1)![0], right.at(-1)![1]);
    }
  }

  for (let index = right.length - 1; index >= 0; index--) {
    target.lineTo(right[index]![0], right[index]![1]);
  }

  if (!closed) {
    const start = samples[0]!;
    const afterStart = samples[1]!;
    let dx = afterStart.x - start.x;
    let dy = afterStart.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    dx /= length;
    dy /= length;
    const radius = start.width / 2;
    if (cap === 'square') {
      target.lineTo(right[0]![0] - dx * radius, right[0]![1] - dy * radius);
      target.lineTo(left[0]![0] - dx * radius, left[0]![1] - dy * radius);
    } else if (cap === 'round') {
      const angle = Math.atan2(dy, dx);
      target.arc(start.x, start.y, radius, angle - Math.PI / 2, angle + Math.PI / 2);
    }
  }
  target.closePath();
}

function paintVariableWidthPathStroke(
  target: ReplayTarget,
  points: PathPoint[],
  closed: boolean,
  baseWeight: number,
  cap: Stroke['cap'],
  _join: Stroke['join'],
  dashPattern: number[],
  dashOffset: number,
): void {
  if (points.length < 2) return;
  const samples: WidthSample[] = [
    {
      x: points[0]!.x,
      y: points[0]!.y,
      width: Math.max(0, baseWeight * pressureScale(points[0]!.pressure ?? 0.5)),
    },
  ];

  const appendSegment = (from: PathPoint, to: PathPoint) => {
    const isBezier = !!(from.handleOut || to.handleIn);
    const cp1x = from.x + (from.handleOut?.[0] ?? 0);
    const cp1y = from.y + (from.handleOut?.[1] ?? 0);
    const cp2x = to.x + (to.handleIn?.[0] ?? 0);
    const cp2y = to.y + (to.handleIn?.[1] ?? 0);
    const pStart = from.pressure ?? 0.5;
    const pEnd = to.pressure ?? 0.5;
    const steps = isBezier
      ? 12
      : Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 3));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const oneMinusT = 1 - t;
      const x = isBezier
        ? oneMinusT * oneMinusT * oneMinusT * from.x +
          3 * oneMinusT * oneMinusT * t * cp1x +
          3 * oneMinusT * t * t * cp2x +
          t * t * t * to.x
        : from.x + (to.x - from.x) * t;
      const y = isBezier
        ? oneMinusT * oneMinusT * oneMinusT * from.y +
          3 * oneMinusT * oneMinusT * t * cp1y +
          3 * oneMinusT * t * t * cp2y +
          t * t * t * to.y
        : from.y + (to.y - from.y) * t;
      const pressure = pStart + (pEnd - pStart) * t;
      samples.push({ x, y, width: Math.max(0, baseWeight * pressureScale(pressure)) });
    }
  };

  for (let index = 1; index < points.length; index++) {
    appendSegment(points[index - 1]!, points[index]!);
  }
  if (closed) appendSegment(points[points.length - 1]!, points[0]!);
  if (samples.length < 2) return;

  const runs =
    dashPattern.length > 0
      ? splitDashedWidthSamples(samples, dashPattern, dashOffset, closed)
      : [{ samples, closed }];
  target.save();
  target.fillStyle = target.strokeStyle;
  target.beginPath();
  for (const run of runs) appendWidthOutline(target, run.samples, cap, run.closed);
  target.fill();
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

function pathEndpointTangent(
  points: PathPoint[],
  fromStart: boolean,
): readonly [number, number] | null {
  if (points.length < 2) return null;
  const endpoint = fromStart ? points[0]! : points[points.length - 1]!;
  const neighbor = fromStart ? points[1]! : points[points.length - 2]!;
  const handle = fromStart ? endpoint.handleOut : endpoint.handleIn;
  const handleVector: readonly [number, number] = fromStart
    ? (handle ?? [0, 0])
    : ([-(handle?.[0] ?? 0), -(handle?.[1] ?? 0)] as const);
  if (Math.hypot(handleVector[0], handleVector[1]) > 0.001) return handleVector;

  const direction: readonly [number, number] = fromStart
    ? [neighbor.x - endpoint.x, neighbor.y - endpoint.y]
    : [endpoint.x - neighbor.x, endpoint.y - neighbor.y];
  if (Math.hypot(direction[0], direction[1]) > 0.001) return direction;

  for (
    let index = fromStart ? 1 : points.length - 2;
    fromStart ? index < points.length : index >= 0;
    index += fromStart ? 1 : -1
  ) {
    const candidate = points[index]!;
    const delta: readonly [number, number] = fromStart
      ? [candidate.x - endpoint.x, candidate.y - endpoint.y]
      : [endpoint.x - candidate.x, endpoint.y - candidate.y];
    if (Math.hypot(delta[0], delta[1]) > 0.001) return delta;
  }
  return null;
}

function paintPathEndpointMarkers(target: ReplayTarget, points: PathPoint[], stroke: Stroke): void {
  if (points.length < 2) return;
  const start = stroke.arrowStart ?? 'none';
  const end = stroke.arrowEnd ?? 'none';
  if (start === 'none' && end === 'none') return;
  const size = arrowheadSize(undefined, stroke.weight);
  target.fillStyle = target.strokeStyle;
  const startTangent = pathEndpointTangent(points, true);
  if (start !== 'none' && startTangent) {
    const first = points[0]!;
    drawArrowhead(
      target,
      [first.x, first.y],
      [first.x + startTangent[0], first.y + startTangent[1]],
      size,
      start,
      true,
    );
  }
  const endTangent = pathEndpointTangent(points, false);
  if (end !== 'none' && endTangent) {
    const last = points[points.length - 1]!;
    drawArrowhead(
      target,
      [last.x - endTangent[0], last.y - endTangent[1]],
      [last.x, last.y],
      size,
      end,
      false,
    );
  }
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
  if (
    isVerticalWritingMode(primitive.writingMode) &&
    primitive.textCase === 'none' &&
    primitive.listStyle === 'none' &&
    primitive.paragraphSpacing === 0 &&
    primitive.firstLineIndent === undefined &&
    !primitive.richText
  ) {
    const snapshot = buildVerticalTextSnapshot(target, primitive);
    if (snapshot) {
      paintVerticalCanonicalTextStroke(target, primitive, snapshot);
      return;
    }
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
      const hasPathMarkers =
        !primitive.closed &&
        ((stroke.arrowStart ?? 'none') !== 'none' || (stroke.arrowEnd ?? 'none') !== 'none');
      if (hasPathMarkers) target.lineCap = 'butt';
      const pressures = primitive.points
        .map((point) => point.pressure)
        .filter(
          (pressure): pressure is number => pressure !== undefined && Number.isFinite(pressure),
        );
      const hasPressureVariation =
        pressures.length > 1 && Math.max(...pressures) - Math.min(...pressures) > Number.EPSILON;
      if (hasPressureVariation && stroke.weight > 0) {
        paintVariableWidthPathStroke(
          target,
          primitive.points,
          primitive.closed,
          stroke.weight,
          stroke.cap,
          stroke.join,
          stroke.dashPattern,
          stroke.dashOffset,
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
      if (hasPathMarkers) paintPathEndpointMarkers(target, primitive.points, stroke);
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
