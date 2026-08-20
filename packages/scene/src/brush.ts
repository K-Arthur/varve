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
  /** Grain rotation in radians. */
  grainRotation: number;
  /** Grain contrast (1 = identity). */
  grainContrast: number;
  /** Invert grain. */
  grainInvert: boolean;
  /**
   * Where the grain texture lives. 'layer' keeps it still while the viewport
   * moves; 'brush' makes every dab stamp the same texels; 'stroke' slides it
   * along the stroke.
   */
  grainAnchor: 'brush' | 'canvas' | 'stroke' | 'layer';
  /** Texture offset in layer pixels. */
  grainOffsetX: number;
  grainOffsetY: number;
  /** Rotate the texture with the stroke direction. */
  grainFollowDirection: boolean;
  /** Edge behaviour outside the texture rectangle. */
  grainWrap: 'repeat' | 'mirror' | 'clamp';
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
    grainAnchor: 'layer',
    grainOffsetX: 0,
    grainOffsetY: 0,
    grainFollowDirection: false,
    grainWrap: 'repeat',
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
  /**
   * Normalized progress along the stroke, 0-1.
   *
   * For a completed stroke this is `arcLengthSoFar / totalStrokeLength`. For a
   * live stroke generated incrementally through a `StrokeDabSession` the total
   * length is not yet known, so this is progress against the length seen so far
   * and therefore reaches ~1.0 at the leading dab of every batch. Use
   * `strokeDistance` when absolute arc length is what matters.
   */
  strokeT: number;
  /** Absolute arc length in layer pixels from the stroke origin to this dab. */
  strokeDistance: number;
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
    /**
     * Anchoring context. Optional so a hand-built dab (a test fixture, a
     * replayed stroke) stays cheap to construct; the sampler falls back to
     * layer-anchored, unrotated defaults when they are absent.
     */
    anchor?: 'brush' | 'canvas' | 'stroke' | 'layer';
    offsetX?: number;
    offsetY?: number;
    followDirection?: boolean;
    wrap?: 'repeat' | 'mirror' | 'clamp';
    /** Dab centre and arc length, so anchoring is resolvable per pixel. */
    dabX?: number;
    dabY?: number;
    strokeDistance?: number;
    direction?: number;
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

/**
 * Exponential stroke smoothing.
 *
 * `previous` is the last smoothed point of the preceding batch. Passing it lets
 * an incrementally dispatched stroke smooth continuously instead of snapping
 * back to the raw input at every batch boundary — without it, the first point
 * of each batch passes through unsmoothed and the stroke visibly kinks.
 */
export function smoothStrokePoints(
  points: StrokePoint[],
  factor: number,
  previous?: StrokePoint | null,
): StrokePoint[] {
  if (points.length === 0 || factor <= 0) return points;
  const f0 = Math.max(0, Math.min(1, factor));
  const smoothed: StrokePoint[] = [];
  if (previous) {
    const first = points[0]!;
    smoothed.push({
      x: previous.x + (first.x - previous.x) * (1 - f0),
      y: previous.y + (first.y - previous.y) * (1 - f0),
      pressure: previous.pressure + (first.pressure - previous.pressure) * (1 - f0),
      tilt: previous.tilt + (first.tilt - previous.tilt) * (1 - f0),
      direction: first.direction,
      speed: first.speed,
      time: first.time,
    });
  } else {
    smoothed.push(points[0]!);
  }
  for (let i = 1; i < points.length; i++) {
    const current = points[i]!;
    const prev = smoothed[i - 1]!;
    const f = f0;
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

export interface GenerateDabsOptions {
  /**
   * Stroke session carrying spacing, arc length and jitter across batches.
   * Omit to generate a complete stroke in one shot (legacy behaviour).
   */
  session?: StrokeDabSession;
}

/**
 * Convert stroke samples into evenly spaced dabs.
 *
 * Without a session this treats `points` as a whole stroke: spacing starts
 * fresh, `strokeT` is normalized against the full length, and jitter is drawn
 * from the legacy shared RNG.
 *
 * With a session the call is one batch of a longer stroke. Spacing carries over
 * from the previous batch (so dab density never spikes at batch boundaries),
 * arc length accumulates, and jitter continues the session's own sequence. The
 * concatenation of every batch's dabs is identical to generating the same
 * points in a single call with the same seed.
 */
export function generateDabs(
  points: StrokePoint[],
  preset: BrushPreset,
  options: GenerateDabsOptions = {},
): BrushDab[] {
  const session = options.session;
  const rng = session?.rng ?? _legacyRng;
  if (points.length === 0) return [];

  // Persisted presets can bypass UI clamps; never let a zero spacing value
  // stall the dab loop.
  const spacingPx = Math.max(0.01, preset.radius * 2 * preset.spacing);
  const dabs: BrushDab[] = [];

  // Bridge from the last point of the previous batch so the gap between
  // batches is walked exactly once — never skipped, never painted twice.
  const walk: StrokePoint[] =
    session?.lastPoint && points.length > 0 ? [session.lastPoint, ...points] : points;

  if (walk.length === 1) {
    const p = walk[0]!;
    if (!session?.started) {
      const dab = makeDab(p, preset, 0, session?.arcLength ?? 0, rng);
      dabs.push(dab);
      if (session) {
        session.started = true;
        session.spacingCarry = 0;
      }
    }
    if (session) session.lastPoint = p;
    return dabs;
  }

  let totalLength = 0;
  for (let i = 1; i < walk.length; i++) {
    totalLength += pointDistance(walk[i - 1]!, walk[i]!);
  }

  const baseArc = session?.arcLength ?? 0;
  let accumulated = session?.spacingCarry ?? 0;
  let lengthSoFar = 0;
  let lastDabPoint = walk[0]!;
  let emitted = session?.started ?? false;

  // A fresh stroke stamps its first dab at the origin so a tap leaves ink.
  if (!emitted) {
    dabs.push(makeDab(walk[0]!, preset, 0, baseArc, rng));
    emitted = true;
    accumulated = 0;
  }

  for (let i = 1; i < walk.length; i++) {
    const prev = walk[i - 1]!;
    const current = walk[i]!;
    const segmentLength = pointDistance(prev, current);
    if (segmentLength === 0) continue;
    const direction = strokeDirection(prev, current);

    let travelled = 0;
    while (accumulated + (segmentLength - travelled) >= spacingPx) {
      const step = spacingPx - accumulated;
      travelled += step;
      const t = travelled / segmentLength;
      const sample = interpolatePoints(prev, current, t);
      sample.direction = direction;
      const arc = baseArc + lengthSoFar + travelled;
      const denom = session ? sessionLengthReference(session, preset) : totalLength;
      const strokeT = denom > 0 ? Math.min(1, arc / denom) : 0;
      dabs.push(makeDab(sample, preset, strokeT, arc, rng));
      lastDabPoint = sample;
      accumulated = 0;
    }
    accumulated += segmentLength - travelled;
    lengthSoFar += segmentLength;
  }

  if (dabs.length === 0 && !session) {
    dabs.push(makeDab(lastDabPoint, preset, 1, baseArc + totalLength, rng));
  }

  if (session) {
    session.spacingCarry = accumulated;
    session.arcLength = baseArc + totalLength;
    session.lastPoint = walk[walk.length - 1]!;
    session.started = emitted;
  }

  return dabs;
}

/**
 * Mulberry32 — a fast, seedable 32-bit PRNG.
 *
 * Jitter state is stroke-local, never process-global: two strokes (or a
 * worker job and a synchronous fallback for the same stroke) must not be able
 * to advance each other's jitter sequence. `BrushRng` carries that state
 * explicitly so dab generation stays deterministic under concurrency,
 * cancellation and reordering.
 */
export interface BrushRng {
  next(): number;
  /** Current internal state — lets a caller checkpoint/restore a sequence. */
  state(): number;
}

export function createBrushRng(seed: number): BrushRng {
  let s = seed | 0;
  if (s === 0) s = 1;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state(): number {
      return s;
    },
  };
}

/**
 * Legacy process-global jitter stream.
 *
 * Retained so callers that generate a whole stroke in one shot keep working,
 * but every incremental/worker path threads an explicit `BrushRng` instead.
 */
let _legacyRng: BrushRng = createBrushRng(1);

/** Seed the legacy shared RNG. Prefer `createStrokeDabSession` for new code. */
export function seedJitter(seed: number): void {
  _legacyRng = createBrushRng(seed);
}

/**
 * Per-stroke dab generation state.
 *
 * Threading this through successive `generateDabs` calls is what makes
 * incremental dispatch (`appendPoints`) produce the same dab stream as
 * generating the whole stroke at once: the spacing accumulator, arc length and
 * jitter sequence all continue across batch boundaries instead of restarting.
 */
export interface StrokeDabSession {
  rng: BrushRng;
  /** Distance already travelled since the last emitted dab. */
  spacingCarry: number;
  /** Total arc length consumed by the stroke so far. */
  arcLength: number;
  /** Last point processed, used to bridge the gap between batches. */
  lastPoint: StrokePoint | null;
  /** True once at least one dab has been emitted for this stroke. */
  started: boolean;
  /**
   * Arc length that `strokeT` reaches 1.0 at.
   *
   * A live stroke does not know how long it will end up being, so "fraction of
   * the whole stroke" is not computable while painting. Anchoring `strokeT` to
   * a fixed reference length instead keeps it a deterministic function of
   * distance travelled, which is what makes a `stroke`-input dynamics mapping
   * (taper, fade) produce the same result no matter how the pointer events
   * happened to be chunked. Replaying a stroke whose total length is already
   * known can pass that total instead.
   */
  lengthReference: number;
}

/**
 * Distance, in brush diameters, over which `strokeT` ramps 0→1 for a live
 * stroke. Long enough that a normal stroke shows a gradual fade rather than
 * saturating within the first few dabs.
 */
export const STROKE_FADE_DIAMETERS = 50;

export function createStrokeDabSession(
  seed: number,
  options: { lengthReference?: number } = {},
): StrokeDabSession {
  return {
    rng: createBrushRng(seed),
    spacingCarry: 0,
    arcLength: 0,
    lastPoint: null,
    started: false,
    lengthReference: options.lengthReference ?? 0,
  };
}

/** Reference length for a session, falling back to the preset-derived fade. */
function sessionLengthReference(session: StrokeDabSession, preset: BrushPreset): number {
  if (session.lengthReference > 0) return session.lengthReference;
  return Math.max(1, preset.radius * 2 * STROKE_FADE_DIAMETERS);
}

function makeDab(
  point: StrokePoint,
  preset: BrushPreset,
  strokeT: number,
  strokeDistance: number,
  rng: BrushRng,
): BrushDab {
  const sizeMod = evaluateDynamics(preset, point, 'size', strokeT, rng);
  const opacityMod = evaluateDynamics(preset, point, 'opacity', strokeT, rng);
  const flowMod = evaluateDynamics(preset, point, 'flow', strokeT, rng);
  const hardnessMod = evaluateDynamics(preset, point, 'hardness', strokeT, rng);
  const rotationMod = evaluateDynamics(preset, point, 'rotation', strokeT, rng);

  const sizeJitter = preset.sizeJitter > 0 ? 1 + (rng.next() * 2 - 1) * preset.sizeJitter : 1;
  const opacityJitter =
    preset.opacityJitter > 0 ? 1 + (rng.next() * 2 - 1) * preset.opacityJitter : 1;
  const rotationJitter =
    preset.rotationJitter > 0 ? (rng.next() * 2 - 1) * preset.rotationJitter * Math.PI : 0;

  const radius = Math.max(0.5, preset.radius * sizeMod * sizeJitter);
  const opacity = Math.max(0, Math.min(1, preset.opacity * opacityMod * opacityJitter));
  const flow = Math.max(0, Math.min(1, preset.flow * flowMod));
  const hardness = Math.max(0, Math.min(1, preset.hardness * hardnessMod));
  const angle = preset.angle + rotationMod * Math.PI + rotationJitter;

  const positionJitter = preset.positionJitter * radius;
  const jx = positionJitter > 0 ? (rng.next() - 0.5) * positionJitter * 2 : 0;
  const jy = positionJitter > 0 ? (rng.next() - 0.5) * positionJitter * 2 : 0;

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
    strokeDistance,
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
          anchor: preset.grainAnchor,
          offsetX: preset.grainOffsetX,
          offsetY: preset.grainOffsetY,
          followDirection: preset.grainFollowDirection,
          wrap: preset.grainWrap,
          dabX: point.x + jx,
          dabY: point.y + jy,
          strokeDistance,
          direction: point.direction,
        }
      : undefined,
  };
}

function evaluateDynamics(
  preset: BrushPreset,
  point: StrokePoint,
  target: BrushDynamicsTarget,
  strokeT: number,
  rng: BrushRng,
): number {
  let product = 1;
  for (const mapping of preset.dynamics) {
    if (mapping.target !== target) continue;
    const inputValue = getInputValue(preset, point, mapping.input, strokeT, rng);
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
  rng: BrushRng,
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
      return rng.next();
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
    // Preserve the grain reference. Dropping it here silently unstyled every
    // textured brush that went through validation, import or migration.
    grainId: typeof p.grainId === 'string' && p.grainId ? p.grainId : fallback.grainId,
    grainScale: Math.max(0, (p.grainScale as number) ?? fallback.grainScale),
    grainRotation: (p.grainRotation as number) ?? fallback.grainRotation,
    grainContrast: Math.max(0, (p.grainContrast as number) ?? fallback.grainContrast),
    grainInvert: typeof p.grainInvert === 'boolean' ? p.grainInvert : fallback.grainInvert,
    grainAnchor: isGrainAnchor(p.grainAnchor) ? p.grainAnchor : fallback.grainAnchor,
    grainOffsetX: Number.isFinite(p.grainOffsetX)
      ? (p.grainOffsetX as number)
      : fallback.grainOffsetX,
    grainOffsetY: Number.isFinite(p.grainOffsetY)
      ? (p.grainOffsetY as number)
      : fallback.grainOffsetY,
    grainFollowDirection:
      typeof p.grainFollowDirection === 'boolean'
        ? p.grainFollowDirection
        : fallback.grainFollowDirection,
    grainWrap: isGrainWrap(p.grainWrap) ? p.grainWrap : fallback.grainWrap,
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

function isGrainAnchor(v: unknown): v is BrushPreset['grainAnchor'] {
  return v === 'brush' || v === 'canvas' || v === 'stroke' || v === 'layer';
}

function isGrainWrap(v: unknown): v is BrushPreset['grainWrap'] {
  return v === 'repeat' || v === 'mirror' || v === 'clamp';
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
  doc: { brushPresets?: Record<string, unknown> },
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
