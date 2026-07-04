/**
 * Digital painting brush model — stroke sampling, smoothing, and dab generation.
 *
 * This module is pure data + math. It does not render; it produces the dab
 * stream that a raster renderer can stamp onto a canvas or GPU texture.
 *
 * Research basis: Procreate stamp brush model, Krita KisPaintOp, MyPaint
 * libmypaint brush engine, and Pointer Events / stylus dynamics.
 */

export type BrushShape = 'circle' | 'square' | 'texture' | 'custom';
export type BrushDynamicsInput =
  | 'pressure'
  | 'tilt'
  | 'speed'
  | 'direction'
  | 'random'
  | 'stroke'
  | 'custom';
export type BrushDynamicsTarget = 'size' | 'opacity' | 'flow' | 'hardness' | 'rotation' | 'spacing';

export interface BrushDynamicsMapping {
  input: BrushDynamicsInput;
  target: BrushDynamicsTarget;
  curve: readonly [number, number, number, number]; // cubic bezier 0-1
  min: number;
  max: number;
}

export interface BrushPreset {
  id: string;
  name: string;
  /** Shape of the brush tip. */
  shape: BrushShape;
  /** Base radius in screen pixels. */
  radius: number;
  /** Base opacity (0-1). */
  opacity: number;
  /** Flow controls how overlapping dabs accumulate (0-1). */
  flow: number;
  /** Base hardness (0-1), inner solidity of the brush. */
  hardness: number;
  /** Spacing between dabs as a fraction of brush diameter. */
  spacing: number;
  /** Angle of the brush tip in radians. */
  angle: number;
  /** Roundness ratio (1 = circle, 0.1 = thin ellipse). */
  roundness: number;
  /** Jitter magnitude for position (0-1). */
  positionJitter: number;
  /** Jitter magnitude for size (0-1). */
  sizeJitter: number;
  /** Jitter magnitude for opacity (0-1). */
  opacityJitter: number;
  /** Jitter magnitude for rotation (0-1). */
  rotationJitter: number;
  /** Dynamics mappings. */
  dynamics: BrushDynamicsMapping[];
  /** Smoothing factor (0 = raw, 1 = fully smoothed). */
  smoothing: number;
  /** Minimum speed threshold for speed-based dynamics. */
  minSpeed: number;
  /** Maximum speed threshold for speed-based dynamics. */
  maxSpeed: number;
  /** Optional grain texture id. */
  grainId?: string;
  /** Grain scale relative to brush size. */
  grainScale: number;
  /** Eraser mode. */
  eraser: boolean;
  /** Blend mode for this brush (normal, multiply, screen, etc.). */
  blendMode: string;
}

export function defaultBrushPreset(id: string, name: string): BrushPreset {
  return {
    id,
    name,
    shape: 'circle',
    radius: 10,
    opacity: 1,
    flow: 1,
    hardness: 0.8,
    spacing: 0.25,
    angle: 0,
    roundness: 1,
    positionJitter: 0,
    sizeJitter: 0,
    opacityJitter: 0,
    rotationJitter: 0,
    dynamics: [],
    smoothing: 0.5,
    minSpeed: 0,
    maxSpeed: 500,
    grainScale: 1,
    eraser: false,
    blendMode: 'normal',
  };
}

export interface StrokePoint {
  x: number;
  y: number;
  /** Pressure 0-1. */
  pressure: number;
  /** Tilt in degrees from vertical. */
  tilt: number;
  /** Direction of movement in radians. */
  direction: number;
  /** Speed in pixels per second. */
  speed: number;
  /** Timestamp in milliseconds. */
  time: number;
}

export interface BrushDab {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  flow: number;
  hardness: number;
  angle: number;
  roundness: number;
  /** 0-1 progress along the stroke. */
  strokeT: number;
}

export interface BrushStroke {
  id: string;
  presetId: string;
  /** Color as RGBA 0-255. */
  color: readonly [number, number, number, number];
  /** Raw input samples. */
  points: StrokePoint[];
  /** Generated dabs after smoothing and spacing. */
  dabs: BrushDab[];
  /** Bounding box in scene coordinates. */
  bounds: { x: number; y: number; w: number; h: number };
}

export function makeBrushStroke(
  id: string,
  presetId: string,
  color: readonly [number, number, number, number],
): BrushStroke {
  return { id, presetId, color, points: [], dabs: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
}

export function strokePoint(x: number, y: number, options: Partial<StrokePoint> = {}): StrokePoint {
  return {
    x,
    y,
    pressure: options.pressure ?? 1,
    tilt: options.tilt ?? 0,
    direction: options.direction ?? 0,
    speed: options.speed ?? 0,
    time: options.time ?? 0,
  };
}

export function pointDistance(a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function strokeDirection(a: StrokePoint, b: StrokePoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function smoothStrokePoints(points: StrokePoint[], factor: number): StrokePoint[] {
  if (points.length === 0 || factor <= 0) return points;
  const smoothed: StrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const current = points[i]!;
    const prev = smoothed[i - 1]!;
    const f = Math.max(0, Math.min(1, factor));
    smoothed.push({
      x: prev.x + (current.x - prev.x) * (1 - f),
      y: prev.y + (current.y - prev.y) * (1 - f),
      pressure: prev.pressure + (current.pressure - prev.pressure) * (1 - f),
      tilt: prev.tilt + (current.tilt - prev.tilt) * (1 - f),
      direction: current.direction,
      speed: current.speed,
      time: current.time,
    });
  }
  return smoothed;
}

export function interpolatePoints(a: StrokePoint, b: StrokePoint, t: number): StrokePoint {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    pressure: a.pressure + (b.pressure - a.pressure) * t,
    tilt: a.tilt + (b.tilt - a.tilt) * t,
    direction: a.direction + (b.direction - a.direction) * t,
    speed: a.speed + (b.speed - a.speed) * t,
    time: a.time + (b.time - a.time) * t,
  };
}

export function generateDabs(points: StrokePoint[], preset: BrushPreset): BrushDab[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const p = points[0]!;
    return [makeDab(p, preset, 0)];
  }

  const dabs: BrushDab[] = [];
  const spacingPx = preset.radius * 2 * preset.spacing;
  let accumulated = 0;
  let lastDabPoint = points[0]!;
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    totalLength += pointDistance(points[i - 1]!, points[i]!);
  }

  let lengthSoFar = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const current = points[i]!;
    const segmentLength = pointDistance(prev, current);
    const direction = strokeDirection(prev, current);
    lengthSoFar += segmentLength;

    if (segmentLength === 0) continue;

    let t = 0;
    while (t < 1) {
      const remaining = spacingPx - accumulated;
      const step = remaining / segmentLength;
      t += step;
      if (t > 1) {
        accumulated += segmentLength * (1 - (t - step));
        break;
      }
      const sample = interpolatePoints(prev, current, t);
      sample.direction = direction;
      const strokeT = totalLength > 0 ? lengthSoFar / totalLength : 0;
      dabs.push(makeDab(sample, preset, strokeT));
      accumulated = 0;
      lastDabPoint = sample;
    }
  }

  if (dabs.length === 0) {
    dabs.push(makeDab(lastDabPoint, preset, 1));
  }

  return dabs;
}

function makeDab(point: StrokePoint, preset: BrushPreset, strokeT: number): BrushDab {
  const sizeMod = evaluateDynamics(preset, point, 'size');
  const opacityMod = evaluateDynamics(preset, point, 'opacity');
  const flowMod = evaluateDynamics(preset, point, 'flow');
  const hardnessMod = evaluateDynamics(preset, point, 'hardness');
  const rotationMod = evaluateDynamics(preset, point, 'rotation');

  const radius = Math.max(0.5, preset.radius * sizeMod);
  const opacity = Math.max(0, Math.min(1, preset.opacity * opacityMod));
  const flow = Math.max(0, Math.min(1, preset.flow * flowMod));
  const hardness = Math.max(0, Math.min(1, preset.hardness * hardnessMod));
  const angle = preset.angle + rotationMod * Math.PI;

  const positionJitter = preset.positionJitter * radius;
  const jx = positionJitter > 0 ? (Math.random() - 0.5) * positionJitter * 2 : 0;
  const jy = positionJitter > 0 ? (Math.random() - 0.5) * positionJitter * 2 : 0;

  return {
    x: point.x + jx,
    y: point.y + jy,
    radius,
    opacity,
    flow,
    hardness,
    angle,
    roundness: preset.roundness,
    strokeT,
  };
}

function evaluateDynamics(
  preset: BrushPreset,
  point: StrokePoint,
  target: BrushDynamicsTarget,
): number {
  let product = 1;
  for (const mapping of preset.dynamics) {
    if (mapping.target !== target) continue;
    const inputValue = getInputValue(preset, point, mapping.input);
    const curveValue = evaluateBezier(mapping.curve, inputValue);
    const mapped = mapping.min + (mapping.max - mapping.min) * curveValue;
    product *= mapped;
  }
  return product;
}

function getInputValue(preset: BrushPreset, point: StrokePoint, input: BrushDynamicsInput): number {
  switch (input) {
    case 'pressure':
      return point.pressure;
    case 'tilt':
      return point.tilt / 90;
    case 'speed':
      if (preset.maxSpeed <= preset.minSpeed) return 0;
      return Math.max(
        0,
        Math.min(1, (point.speed - preset.minSpeed) / (preset.maxSpeed - preset.minSpeed)),
      );
    case 'direction':
      return (point.direction + Math.PI) / (2 * Math.PI);
    case 'random':
      return Math.random();
    case 'stroke':
      return 0; // Requires external stroke progress
    case 'custom':
      return 0;
    default:
      return 0;
  }
}

function evaluateBezier(curve: readonly [number, number, number, number], t: number): number {
  const [x1, y1, x2, y2] = curve;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = ax * t * t * t + bx * t * t + cx * t;
  return ay * x * x * x + by * x * x + cy * x;
}

export function strokeBounds(dabs: BrushDab[]): { x: number; y: number; w: number; h: number } {
  if (dabs.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = dabs[0]!.x - dabs[0]!.radius;
  let minY = dabs[0]!.y - dabs[0]!.radius;
  let maxX = dabs[0]!.x + dabs[0]!.radius;
  let maxY = dabs[0]!.y + dabs[0]!.radius;
  for (const d of dabs) {
    minX = Math.min(minX, d.x - d.radius);
    minY = Math.min(minY, d.y - d.radius);
    maxX = Math.max(maxX, d.x + d.radius);
    maxY = Math.max(maxY, d.y + d.radius);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rebuildStrokeDabs(stroke: BrushStroke, preset: BrushPreset): BrushStroke {
  const smoothed = smoothStrokePoints(stroke.points, preset.smoothing);
  const dabs = generateDabs(smoothed, preset);
  return { ...stroke, dabs, bounds: strokeBounds(dabs) };
}
