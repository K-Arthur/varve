/**
 * Digital painting brush model — stroke sampling, smoothing, and dab generation.
 *
 * This module is pure data + math. It does not render; it produces the dab
 * stream that a raster renderer can stamp onto a canvas or GPU texture.
 *
 * Research basis: Procreate stamp brush model, Krita KisPaintOp, MyPaint
 * libmypaint brush engine, and Pointer Events / stylus dynamics.
 */

import type { Document } from './document';

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
  /** Grain rotation in radians. */
  grainRotation: number;
  /** Grain contrast (1 = identity). */
  grainContrast: number;
  /** Invert grain. */
  grainInvert: boolean;
  /** Smudge strength (0-1). How much paint is dragged per dab. */
  smudgeStrength: number;
  /** Wet paint enabled. */
  wetEnabled: boolean;
  /** Wet edge effect enabled. */
  wetEdge: boolean;
  /** Wet edge size as fraction of brush radius. */
  wetEdgeSize: number;
  /** Wet edge darkening amount (0-1). */
  wetEdgeDarken: number;
  /** Wet mix strength (0-1). How much new paint mixes with existing wet paint. */
  wetMixStrength: number;
  /** Wet drying rate per second. */
  wetDryingRate: number;
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
    grainRotation: 0,
    grainContrast: 1,
    grainInvert: false,
    smudgeStrength: 0.5,
    wetEnabled: false,
    wetEdge: false,
    wetEdgeSize: 0.15,
    wetEdgeDarken: 0.3,
    wetMixStrength: 0.5,
    wetDryingRate: 0.05,
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
  /** Brush tip shape (circle, square, etc.). Defaults to 'circle'. */
  shape?: BrushShape;
  /** Blend mode for this dab. Defaults to the preset's blend mode. */
  blendMode?: string;
  /** Optional deterministic grain parameters for textured presets. */
  grain?: {
    grainId: string;
    scale: number;
    rotation: number;
    contrast: number;
    invert: boolean;
    strokeT: number;
  };
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
  // Persisted presets can bypass UI clamps; never let a zero spacing value
  // stall the dab loop.
  const spacingPx = Math.max(0.01, preset.radius * 2 * preset.spacing);
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

/**
 * Mulberry32 — a fast, seedable 32-bit PRNG.
 * Gives deterministic jitter that is reproducible across stroke replays.
 */
let _rngState = 1;

/** Seed the deterministic RNG. Each stroke calls this with a unique seed. */
export function seedJitter(seed: number): void {
  _rngState = seed | 0;
  if (_rngState === 0) _rngState = 1;
}

function deterministicRandom(): number {
  _rngState += 0x6d2b79f5;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeDab(point: StrokePoint, preset: BrushPreset, strokeT: number): BrushDab {
  const sizeMod = evaluateDynamics(preset, point, 'size', strokeT);
  const opacityMod = evaluateDynamics(preset, point, 'opacity', strokeT);
  const flowMod = evaluateDynamics(preset, point, 'flow', strokeT);
  const hardnessMod = evaluateDynamics(preset, point, 'hardness', strokeT);
  const rotationMod = evaluateDynamics(preset, point, 'rotation', strokeT);

  const sizeJitter =
    preset.sizeJitter > 0 ? 1 + (deterministicRandom() * 2 - 1) * preset.sizeJitter : 1;
  const opacityJitter =
    preset.opacityJitter > 0 ? 1 + (deterministicRandom() * 2 - 1) * preset.opacityJitter : 1;
  const rotationJitter =
    preset.rotationJitter > 0
      ? (deterministicRandom() * 2 - 1) * preset.rotationJitter * Math.PI
      : 0;

  const radius = Math.max(0.5, preset.radius * sizeMod * sizeJitter);
  const opacity = Math.max(0, Math.min(1, preset.opacity * opacityMod * opacityJitter));
  const flow = Math.max(0, Math.min(1, preset.flow * flowMod));
  const hardness = Math.max(0, Math.min(1, preset.hardness * hardnessMod));
  const angle = preset.angle + rotationMod * Math.PI + rotationJitter;

  const positionJitter = preset.positionJitter * radius;
  const jx = positionJitter > 0 ? (deterministicRandom() - 0.5) * positionJitter * 2 : 0;
  const jy = positionJitter > 0 ? (deterministicRandom() - 0.5) * positionJitter * 2 : 0;

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
    shape: preset.shape,
    blendMode: preset.blendMode,
    grain: preset.grainId
      ? {
          grainId: preset.grainId,
          scale: Math.max(0.001, preset.grainScale),
          rotation: preset.grainRotation,
          contrast: preset.grainContrast,
          invert: preset.grainInvert,
          strokeT,
        }
      : undefined,
  };
}

function evaluateDynamics(
  preset: BrushPreset,
  point: StrokePoint,
  target: BrushDynamicsTarget,
  strokeT: number,
): number {
  let product = 1;
  for (const mapping of preset.dynamics) {
    if (mapping.target !== target) continue;
    const inputValue = getInputValue(preset, point, mapping.input, strokeT);
    const curveValue = evaluateBezier(mapping.curve, inputValue);
    const mapped = mapping.min + (mapping.max - mapping.min) * curveValue;
    product *= mapped;
  }
  return product;
}

function getInputValue(
  preset: BrushPreset,
  point: StrokePoint,
  input: BrushDynamicsInput,
  strokeT: number,
): number {
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
      return deterministicRandom();
    case 'stroke':
      return Math.max(0, Math.min(1, strokeT));
    case 'custom':
      return 0;
    default:
      return 0;
  }
}

function evaluateBezier(curve: readonly [number, number, number, number], t: number): number {
  const input = Math.max(0, Math.min(1, t));
  const [x1, y1, x2, y2] = curve;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ax * u * u * u + bx * u * u + cx * u;
  const sampleY = (u: number) => ay * u * u * u + by * u * u + cy * u;

  // Invert x(t) before evaluating y(t): the curve maps input (x) to output
  // (y), so the input is not generally the Bezier parameter.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (sampleX(mid) < input) lo = mid;
    else hi = mid;
  }
  return sampleY((lo + hi) / 2);
}

export function strokeBounds(dabs: BrushDab[]): { x: number; y: number; w: number; h: number } {
  if (dabs.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  const first = dabs[0]!;
  let minX = first.x - first.radius;
  let minY = first.y - first.radius;
  let maxX = first.x + first.radius;
  let maxY = first.y + first.radius;
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

// ── One Euro Filter (1€ filter) ──────────────────────────────────────────────

function computeAlpha(cutoff: number, dt: number): number {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (1 + r);
}

/**
 * 1€ filter for real-time pointer smoothing (Casiez et al., 2012).
 *
 * Adaptive low-pass filter whose cutoff frequency increases with velocity,
 * reducing latency during fast movements while smoothing jitter at rest.
 */
export class OneEuroFilter {
  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevDx: number = 0;
  private prevDy: number = 0;
  private prevTime: number | null = null;

  constructor(
    private minCutoff: number = 1.0,
    private beta: number = 0.007,
    private dCutoff: number = 1.0,
  ) {}

  reset(): void {
    this.prevX = null;
    this.prevY = null;
    this.prevDx = 0;
    this.prevDy = 0;
    this.prevTime = null;
  }

  filter(x: number, y: number, time?: number): { x: number; y: number; dx: number; dy: number } {
    const t = time ?? performance.now();

    // First sample: initialize state, return identity
    if (this.prevX === null || this.prevY === null || this.prevTime === null) {
      this.prevX = x;
      this.prevY = y;
      this.prevTime = t;
      this.prevDx = 0;
      this.prevDy = 0;
      return { x, y, dx: 0, dy: 0 };
    }

    let dt = (t - this.prevTime) / 1000;
    if (dt < 0) dt = 0;

    // dt = 0: return current state unchanged
    if (dt === 0) {
      return { x: this.prevX, y: this.prevY, dx: this.prevDx, dy: this.prevDy };
    }

    // Derive dx/dt via exponential smoothing of raw derivative
    const dAlpha = computeAlpha(this.dCutoff, dt);

    const rawDx = (x - this.prevX) / dt;
    const rawDy = (y - this.prevY) / dt;

    const dx = dAlpha * rawDx + (1 - dAlpha) * this.prevDx;
    const dy = dAlpha * rawDy + (1 - dAlpha) * this.prevDy;

    // Adaptive cutoff: higher velocity → higher cutoff → less smoothing
    const cutoffX = this.minCutoff + this.beta * Math.abs(dx);
    const cutoffY = this.minCutoff + this.beta * Math.abs(dy);

    const alphaX = computeAlpha(cutoffX, dt);
    const alphaY = computeAlpha(cutoffY, dt);

    const filteredX = alphaX * x + (1 - alphaX) * this.prevX;
    const filteredY = alphaY * y + (1 - alphaY) * this.prevY;

    this.prevX = filteredX;
    this.prevY = filteredY;
    this.prevDx = dx;
    this.prevDy = dy;
    this.prevTime = t;

    return { x: filteredX, y: filteredY, dx, dy };
  }

  updateConfig(config: { minCutoff?: number; beta?: number; dCutoff?: number }): void {
    if (config.minCutoff !== undefined) this.minCutoff = config.minCutoff;
    if (config.beta !== undefined) this.beta = config.beta;
    if (config.dCutoff !== undefined) this.dCutoff = config.dCutoff;
  }
}

export function oneEuroFilterPoint(point: StrokePoint, filter: OneEuroFilter): StrokePoint {
  const result = filter.filter(point.x, point.y, point.time);
  return { ...point, x: result.x, y: result.y };
}

// ── Brush Preset Registry ────────────────────────────────────────────────────

export const BUILT_IN_BRUSH_PRESETS: Record<string, BrushPreset> = {
  'built-in-round': { ...defaultBrushPreset('built-in-round', 'Round'), id: 'built-in-round' },
  'built-in-soft': {
    ...defaultBrushPreset('built-in-soft', 'Soft'),
    id: 'built-in-soft',
    hardness: 0.3,
    opacity: 0.9,
  },
  'built-in-marker': {
    ...defaultBrushPreset('built-in-marker', 'Marker'),
    id: 'built-in-marker',
    hardness: 0.9,
    flow: 0.8,
    spacing: 0.15,
  },
  'built-in-airbrush': {
    ...defaultBrushPreset('built-in-airbrush', 'Airbrush'),
    id: 'built-in-airbrush',
    hardness: 0.1,
    opacity: 0.5,
    flow: 0.3,
    spacing: 0.1,
  },
  'built-in-textured': {
    ...defaultBrushPreset('built-in-textured', 'Textured'),
    id: 'built-in-textured',
    grainId: 'procedural',
    grainScale: 0.5,
    grainContrast: 1.4,
    hardness: 0.7,
  },
  'built-in-eraser': {
    ...defaultBrushPreset('built-in-eraser', 'Eraser'),
    id: 'built-in-eraser',
    eraser: true,
  },
};

export interface BrushPresetMeta {
  isBuiltIn: boolean;
  isEditable: boolean;
}

export function isBuiltInPreset(presetId: string): boolean {
  return presetId in BUILT_IN_BRUSH_PRESETS;
}

export function validateBrushPreset(preset: unknown): BrushPreset | null {
  if (!preset || typeof preset !== 'object') return null;
  const p = preset as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.name !== 'string' || !p.name) return null;
  if (typeof p.shape !== 'string') return null;
  if (typeof p.radius !== 'number' || p.radius < 0) return null;
  const fallback = defaultBrushPreset(p.id as string, p.name as string);
  const result: BrushPreset = {
    id: p.id as string,
    name: p.name as string,
    shape: (typeof p.shape === 'string' ? p.shape : fallback.shape) as BrushShape,
    radius: Math.max(0.5, Math.min(1000, (p.radius as number) ?? fallback.radius)),
    opacity: clampUnit(p.opacity as number | undefined, fallback.opacity),
    flow: clampUnit(p.flow as number | undefined, fallback.flow),
    hardness: clampUnit(p.hardness as number | undefined, fallback.hardness),
    spacing: Math.max(0.01, clampUnit(p.spacing as number | undefined, fallback.spacing)),
    angle: (p.angle as number) ?? fallback.angle,
    roundness: clampUnit(p.roundness as number | undefined, fallback.roundness),
    positionJitter: clampUnit(p.positionJitter as number | undefined, fallback.positionJitter),
    sizeJitter: clampUnit(p.sizeJitter as number | undefined, fallback.sizeJitter),
    opacityJitter: clampUnit(p.opacityJitter as number | undefined, fallback.opacityJitter),
    rotationJitter: clampUnit(p.rotationJitter as number | undefined, fallback.rotationJitter),
    dynamics: Array.isArray(p.dynamics)
      ? (p.dynamics as BrushDynamicsMapping[])
      : fallback.dynamics,
    smoothing: clampUnit(p.smoothing as number | undefined, fallback.smoothing),
    minSpeed: Math.max(0, (p.minSpeed as number) ?? fallback.minSpeed),
    maxSpeed: Math.max(0, (p.maxSpeed as number) ?? fallback.maxSpeed),
    grainScale: Math.max(0, (p.grainScale as number) ?? fallback.grainScale),
    grainRotation: (p.grainRotation as number) ?? fallback.grainRotation,
    grainContrast: Math.max(0, (p.grainContrast as number) ?? fallback.grainContrast),
    grainInvert: typeof p.grainInvert === 'boolean' ? p.grainInvert : fallback.grainInvert,
    smudgeStrength: clampUnit(p.smudgeStrength as number | undefined, fallback.smudgeStrength),
    wetEnabled: typeof p.wetEnabled === 'boolean' ? p.wetEnabled : fallback.wetEnabled,
    wetEdge: typeof p.wetEdge === 'boolean' ? p.wetEdge : fallback.wetEdge,
    wetEdgeSize: clampUnit(p.wetEdgeSize as number | undefined, fallback.wetEdgeSize),
    wetEdgeDarken: clampUnit(p.wetEdgeDarken as number | undefined, fallback.wetEdgeDarken),
    wetMixStrength: clampUnit(p.wetMixStrength as number | undefined, fallback.wetMixStrength),
    wetDryingRate: clampUnit(p.wetDryingRate as number | undefined, fallback.wetDryingRate),
    eraser: typeof p.eraser === 'boolean' ? p.eraser : fallback.eraser,
    blendMode: typeof p.blendMode === 'string' ? p.blendMode : fallback.blendMode,
  };
  return result;
}

function clampUnit(val: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(1, val ?? fallback));
}

export function clampBrushPreset(preset: BrushPreset): BrushPreset {
  return {
    ...preset,
    radius: Math.max(0.5, Math.min(1000, preset.radius)),
    opacity: Math.max(0, Math.min(1, preset.opacity)),
    flow: Math.max(0, Math.min(1, preset.flow)),
    hardness: Math.max(0, Math.min(1, preset.hardness)),
    spacing: Math.max(0.01, Math.min(1, preset.spacing)),
    roundness: Math.max(0, Math.min(1, preset.roundness)),
    positionJitter: Math.max(0, Math.min(1, preset.positionJitter)),
    sizeJitter: Math.max(0, Math.min(1, preset.sizeJitter)),
    opacityJitter: Math.max(0, Math.min(1, preset.opacityJitter)),
    rotationJitter: Math.max(0, Math.min(1, preset.rotationJitter)),
    smoothing: Math.max(0, Math.min(1, preset.smoothing)),
    minSpeed: Math.max(0, preset.minSpeed),
    maxSpeed: Math.max(0, preset.maxSpeed),
    grainScale: Math.max(0, preset.grainScale),
    grainContrast: Math.max(0, preset.grainContrast),
    smudgeStrength: Math.max(0, Math.min(1, preset.smudgeStrength)),
    wetEdgeSize: Math.max(0, Math.min(1, preset.wetEdgeSize)),
    wetEdgeDarken: Math.max(0, Math.min(1, preset.wetEdgeDarken)),
    wetMixStrength: Math.max(0, Math.min(1, preset.wetMixStrength)),
    wetDryingRate: Math.max(0, preset.wetDryingRate),
  };
}

export function migrateBrushPreset(preset: Record<string, unknown>): BrushPreset | null {
  const id = typeof preset.id === 'string' ? preset.id : '';
  const name = typeof preset.name === 'string' ? preset.name : '';
  if (!id || !name) return null;
  const fallback = defaultBrushPreset(id, name);
  return validateBrushPreset({ ...fallback, ...preset });
}

export function getActivePreset(
  doc: Document,
  presetId?: string,
  fallbackId?: string,
): BrushPreset {
  const id = presetId ?? fallbackId ?? 'built-in-round';
  const docPreset = doc.brushPresets?.[id] as BrushPreset | undefined;
  if (docPreset) {
    return clampBrushPreset(docPreset);
  }
  const builtIn = BUILT_IN_BRUSH_PRESETS[id];
  if (builtIn) return builtIn;
  return BUILT_IN_BRUSH_PRESETS['built-in-round']!;
}
