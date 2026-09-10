import { linearToSrgbUnit, srgbToLinearUnit } from '@varve/shared';
import { normalizeBlurRadius } from './blur';

/** Versioned, owner-local geometry used by the spatial blur family. */
export const SPATIAL_BLUR_ALGORITHM_VERSION = 1;

export type BlurCoordinate = { x: number; y: number };
export type BlurEdgeMode = 'clamp' | 'transparent';

export interface FieldBlurPin extends BlurCoordinate {
  id: string;
  /** Blur amount in owner/source pixels. Positions may be off-canvas. */
  radius: number;
}

export interface IrisBlurRegion {
  id: string;
  center: BlurCoordinate;
  /** Normalized owner-local radii, normally 0..1 of the owner dimensions. */
  radii: BlurCoordinate;
  rotation: number;
  innerRatio: number;
  feather: number;
  amount: number;
}

export interface TiltShiftBlurRegion {
  id: string;
  center: BlurCoordinate;
  angle: number;
  sharpHalfWidth: number;
  feather: number;
  amount: number;
}

export interface MotionPathPoint extends BlurCoordinate {
  id: string;
  handleIn?: BlurCoordinate | null;
  handleOut?: BlurCoordinate | null;
}

export interface PathBlurPath {
  id: string;
  points: MotionPathPoint[];
}

interface SharedSpatialBlurFields {
  id?: string;
  visible: boolean;
  algorithmVersion: number;
  coordinateSpace: 'owner-normalized';
  edgeMode: BlurEdgeMode;
}

export type SpatialBlurEffect =
  | (SharedSpatialBlurFields & {
      type: 'gaussianBlur';
      sigmaX: number;
      sigmaY: number;
      linkedAxes: boolean;
    })
  | (SharedSpatialBlurFields & {
      type: 'fieldBlur';
      pins: FieldBlurPin[];
      outsideHull: 'nearest' | 'average' | 'zero';
      interpolation: 'inverse-distance-v1';
      maxRadius: number;
    })
  | (SharedSpatialBlurFields & {
      type: 'irisBlur';
      regions: IrisBlurRegion[];
    })
  | (SharedSpatialBlurFields & {
      type: 'tiltShiftBlur';
      regions: TiltShiftBlurRegion[];
    })
  | (SharedSpatialBlurFields & {
      type: 'pathBlur';
      paths: PathBlurPath[];
      amount: number;
      startAmount: number;
      endAmount: number;
      centered: boolean;
      taper: number;
      strobe: number;
      samples: number;
    })
  | (SharedSpatialBlurFields & {
      type: 'spinBlur';
      center: BlurCoordinate;
      pivot: BlurCoordinate;
      radii: BlurCoordinate;
      rotation: number;
      angle: number;
      amount: number;
      feather: number;
      strobe: number;
      samples: number;
    });

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finite(value, 0)));
}

function clampRadius(value: number): number {
  return normalizeBlurRadius(finite(value, 0));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function distance(a: BlurCoordinate, b: BlurCoordinate): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function normalizedPoint(point: BlurCoordinate, width: number, height: number): BlurCoordinate {
  return { x: point.x * width, y: point.y * height };
}

function pointInConvexHull(points: readonly BlurCoordinate[], point: BlurCoordinate): boolean {
  if (points.length === 0) return false;
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: BlurCoordinate, b: BlurCoordinate, c: BlurCoordinate) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: BlurCoordinate[] = [];
  for (const candidate of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower.at(-1)!, candidate) <= 0)
      lower.pop();
    lower.push(candidate);
  }
  const upper: BlurCoordinate[] = [];
  for (const candidate of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper.at(-1)!, candidate) <= 0)
      upper.pop();
    upper.push(candidate);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length === 1) return distance(hull[0]!, point) < 1e-6;
  if (hull.length === 2) {
    const minX = Math.min(hull[0]!.x, hull[1]!.x) - 1e-6;
    const maxX = Math.max(hull[0]!.x, hull[1]!.x) + 1e-6;
    const minY = Math.min(hull[0]!.y, hull[1]!.y) - 1e-6;
    const maxY = Math.max(hull[0]!.y, hull[1]!.y) + 1e-6;
    return (
      Math.abs(cross(hull[0]!, hull[1]!, point)) < 1e-6 &&
      point.x >= minX &&
      point.x <= maxX &&
      point.y >= minY &&
      point.y <= maxY
    );
  }
  let orientation = 0;
  for (let index = 0; index < hull.length; index++) {
    const sign = Math.sign(cross(hull[index]!, hull[(index + 1) % hull.length]!, point));
    if (sign === 0) continue;
    if (orientation === 0) orientation = sign;
    else if (orientation !== sign) return false;
  }
  return true;
}

function evalFieldRadius(
  effect: Extract<SpatialBlurEffect, { type: 'fieldBlur' }>,
  point: BlurCoordinate,
  width: number,
  height: number,
): number {
  const pins = effect.pins.filter(
    (pin) =>
      Number.isFinite(pin.x) &&
      Number.isFinite(pin.y) &&
      Number.isFinite(pin.radius) &&
      typeof pin.id === 'string',
  );
  if (pins.length === 0) return 0;
  const values = pins.map((pin) => ({
    point: normalizedPoint(pin, width, height),
    radius: clampRadius(pin.radius),
  }));
  const exact = values.find((pin) => distance(pin.point, point) < 1e-6);
  if (exact) return exact.radius;

  const weights = values.map((pin) => 1 / Math.max(1e-6, distance(pin.point, point) ** 2));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  if (
    effect.outsideHull === 'zero' &&
    !pointInConvexHull(
      values.map((pin) => pin.point),
      point,
    )
  )
    return 0;
  const weighted =
    values.reduce((sum, pin, index) => sum + pin.radius * weights[index]!, 0) / total;
  return Math.min(clampRadius(effect.maxRadius), Math.max(0, weighted));
}

function evalIrisRadius(
  effect: Extract<SpatialBlurEffect, { type: 'irisBlur' }>,
  point: BlurCoordinate,
  width: number,
  height: number,
): number {
  let result = 0;
  for (const region of effect.regions) {
    const center = normalizedPoint(region.center, width, height);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const c = Math.cos(-finite(region.rotation, 0));
    const s = Math.sin(-finite(region.rotation, 0));
    const rx = Math.max(1e-3, Math.abs(finite(region.radii.x, 0.5)) * width);
    const ry = Math.max(1e-3, Math.abs(finite(region.radii.y, 0.5)) * height);
    const qx = (dx * c - dy * s) / rx;
    const qy = (dx * s + dy * c) / ry;
    const radial = Math.hypot(qx, qy);
    const inner = clamp01(region.innerRatio);
    const outer = Math.max(inner + 1e-6, inner + clamp01(region.feather));
    result = Math.max(
      result,
      clampRadius(region.amount) * smoothstep((radial - inner) / (outer - inner)),
    );
  }
  return result;
}

function evalTiltRadius(
  effect: Extract<SpatialBlurEffect, { type: 'tiltShiftBlur' }>,
  point: BlurCoordinate,
  width: number,
  height: number,
): number {
  let result = 0;
  for (const region of effect.regions) {
    const center = normalizedPoint(region.center, width, height);
    const normal = { x: -Math.sin(finite(region.angle, 0)), y: Math.cos(finite(region.angle, 0)) };
    const signedDistance = Math.abs(
      (point.x - center.x) * normal.x + (point.y - center.y) * normal.y,
    );
    const sharp = Math.max(0, finite(region.sharpHalfWidth, 0));
    const feather = Math.max(1e-6, finite(region.feather, 0));
    result = Math.max(
      result,
      clampRadius(region.amount) * smoothstep((signedDistance - sharp) / feather),
    );
  }
  return result;
}

function segmentLength(a: BlurCoordinate, b: BlurCoordinate): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function samplePolyline(points: readonly BlurCoordinate[], t: number): BlurCoordinate {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0]! };
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(lengths[i - 1]! + segmentLength(points[i - 1]!, points[i]!));
  const total = lengths[lengths.length - 1]!;
  if (total <= 1e-6) return { ...points[0]! };
  const target = clamp01(t) * total;
  const index = Math.max(
    0,
    Math.min(points.length - 2, lengths.findIndex((value) => value > target) - 1),
  );
  const start = lengths[index]!;
  const span = Math.max(1e-6, lengths[index + 1]! - start);
  const localT = (target - start) / span;
  const a = points[index]!;
  const b = points[index + 1]!;
  return { x: a.x + (b.x - a.x) * localT, y: a.y + (b.y - a.y) * localT };
}

function pathOffsets(
  effect: Extract<SpatialBlurEffect, { type: 'pathBlur' }>,
  width: number,
  height: number,
): BlurCoordinate[] {
  const path = effect.paths.find((candidate) => candidate.points.length > 0);
  if (!path) return [{ x: 0, y: 0 }];
  const points = path.points.map((point) => normalizedPoint(point, width, height));
  const count = Math.max(1, Math.min(64, Math.round(finite(effect.samples, 16))));
  const base = samplePolyline(points, effect.centered ? 0.5 : 0);
  const output: BlurCoordinate[] = [];
  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const point = samplePolyline(points, t);
    const taper = 1 - clamp01(effect.taper) * Math.abs(t * 2 - 1);
    const endpoint = (1 - t) * Math.max(0, effect.startAmount) + t * Math.max(0, effect.endAmount);
    const scale = Math.max(0, effect.amount) * taper * (endpoint > 0 ? endpoint : 1);
    output.push({ x: (point.x - base.x) * scale, y: (point.y - base.y) * scale });
  }
  return output;
}

function rotateAround(
  point: BlurCoordinate,
  center: BlurCoordinate,
  angle: number,
): BlurCoordinate {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
}

function toLinearPremultiplied(data: Uint8ClampedArray): Float32Array {
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    result[i] = srgbToLinearUnit(data[i]! / 255) * alpha;
    result[i + 1] = srgbToLinearUnit(data[i + 1]! / 255) * alpha;
    result[i + 2] = srgbToLinearUnit(data[i + 2]! / 255) * alpha;
    result[i + 3] = alpha;
  }
  return result;
}

function fromLinearPremultiplied(data: Float32Array): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = Math.max(0, Math.min(1, data[i + 3]!));
    const inv = alpha > 1e-6 ? 1 / alpha : 0;
    result[i] = Math.round(linearToSrgbUnit(Math.max(0, data[i]! * inv)) * 255);
    result[i + 1] = Math.round(linearToSrgbUnit(Math.max(0, data[i + 1]! * inv)) * 255);
    result[i + 2] = Math.round(linearToSrgbUnit(Math.max(0, data[i + 2]! * inv)) * 255);
    result[i + 3] = Math.round(alpha * 255);
  }
  return result;
}

function makeImageData(bytes: Uint8ClampedArray, width: number, height: number): ImageData {
  const safe = new Uint8ClampedArray(bytes.length);
  safe.set(bytes);
  return new ImageData(safe as unknown as ImageDataArray, width, height);
}

function samplePremultiplied(
  src: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  edgeMode: BlurEdgeMode,
): [number, number, number, number] {
  if (edgeMode === 'transparent' && (x < 0 || y < 0 || x >= width || y >= height))
    return [0, 0, 0, 0];
  const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (sy * width + sx) * 4;
  return [src[offset]!, src[offset + 1]!, src[offset + 2]!, src[offset + 3]!];
}

function convolveLinearAxis(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  kernel: readonly number[],
  horizontal: boolean,
  edgeMode: BlurEdgeMode,
): void {
  const support = (kernel.length - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const output = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let index = 0; index < kernel.length; index++) {
        const delta = index - support;
        const sx = horizontal ? x + delta : x;
        const sy = horizontal ? y : y + delta;
        if (edgeMode === 'transparent' && (sx < 0 || sy < 0 || sx >= width || sy >= height))
          continue;
        const cx = Math.max(0, Math.min(width - 1, sx));
        const cy = Math.max(0, Math.min(height - 1, sy));
        const sourceOffset = (cy * width + cx) * 4;
        const weight = kernel[index]!;
        r += source[sourceOffset]! * weight;
        g += source[sourceOffset + 1]! * weight;
        b += source[sourceOffset + 2]! * weight;
        a += source[sourceOffset + 3]! * weight;
      }
      target[output] = r;
      target[output + 1] = g;
      target[output + 2] = b;
      target[output + 3] = a;
    }
  }
}

function applyGaussianAxes(
  data: ImageData,
  sigmaX: number,
  sigmaY: number,
  edgeMode: BlurEdgeMode,
): ImageData {
  const xRadius = clampRadius(sigmaX) * 3;
  const yRadius = clampRadius(sigmaY) * 3;
  if (xRadius <= 0 && yRadius <= 0) return makeImageData(data.data, data.width, data.height);
  const source = toLinearPremultiplied(data.data);
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  convolveLinearAxis(
    source,
    horizontal,
    data.width,
    data.height,
    gaussianKernelForSigma(xRadius),
    true,
    edgeMode,
  );
  convolveLinearAxis(
    horizontal,
    output,
    data.width,
    data.height,
    gaussianKernelForSigma(yRadius),
    false,
    edgeMode,
  );
  return makeImageData(fromLinearPremultiplied(output), data.width, data.height);
}

function gaussianKernelForSigma(radius: number): number[] {
  const support = Math.max(1, Math.ceil(radius));
  if (radius <= 0) return [1];
  const sigma = Math.max(Number.EPSILON, radius / 3);
  const result = new Array<number>(support * 2 + 1);
  let sum = 0;
  for (let index = 0; index < result.length; index++) {
    const distance = index - support;
    const weight = Math.exp(-(distance * distance) / (2 * sigma * sigma));
    result[index] = weight;
    sum += weight;
  }
  for (let index = 0; index < result.length; index++) result[index] = result[index]! / sum;
  return result;
}

function applyMotionSamples(
  data: ImageData,
  offsets: readonly BlurCoordinate[],
  edgeMode: BlurEdgeMode,
  coverageAt?: (x: number, y: number) => number,
): ImageData {
  if (offsets.length <= 1 || offsets.every((offset) => offset.x === 0 && offset.y === 0)) {
    return makeImageData(data.data, data.width, data.height);
  }
  const src = toLinearPremultiplied(data.data);
  const out = new Float32Array(src.length);
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const coverage = coverageAt?.(x, y) ?? 1;
      const offset = (y * data.width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const sample of offsets) {
        const [sr, sg, sb, sa] = samplePremultiplied(
          src,
          data.width,
          data.height,
          x + sample.x,
          y + sample.y,
          edgeMode,
        );
        r += sr;
        g += sg;
        b += sb;
        a += sa;
      }
      const invCount = 1 / offsets.length;
      out[offset] = src[offset]! * (1 - coverage) + r * invCount * coverage;
      out[offset + 1] = src[offset + 1]! * (1 - coverage) + g * invCount * coverage;
      out[offset + 2] = src[offset + 2]! * (1 - coverage) + b * invCount * coverage;
      out[offset + 3] = src[offset + 3]! * (1 - coverage) + a * invCount * coverage;
    }
  }
  return makeImageData(fromLinearPremultiplied(out), data.width, data.height);
}

function applyVariableGaussian(
  data: ImageData,
  radiusAt: (x: number, y: number) => number,
  edgeMode: BlurEdgeMode,
): ImageData {
  const src = toLinearPremultiplied(data.data);
  const out = new Float32Array(src.length);
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const radius = clampRadius(radiusAt(x, y));
      const output = (y * data.width + x) * 4;
      if (radius <= 0) {
        out[output] = src[output]!;
        out[output + 1] = src[output + 1]!;
        out[output + 2] = src[output + 2]!;
        out[output + 3] = src[output + 3]!;
        continue;
      }
      const support = Math.ceil(radius);
      const sigma = Math.max(0.75, radius / 3);
      const sigma2 = 2 * sigma * sigma;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightSum = 0;
      for (let oy = -support; oy <= support; oy++) {
        for (let ox = -support; ox <= support; ox++) {
          const weight = Math.exp(-(ox * ox + oy * oy) / sigma2);
          const [sr, sg, sb, sa] = samplePremultiplied(
            src,
            data.width,
            data.height,
            x + ox,
            y + oy,
            edgeMode,
          );
          r += sr * weight;
          g += sg * weight;
          b += sb * weight;
          a += sa * weight;
          weightSum += weight;
        }
      }
      out[output] = r / weightSum;
      out[output + 1] = g / weightSum;
      out[output + 2] = b / weightSum;
      out[output + 3] = a / weightSum;
    }
  }
  return makeImageData(fromLinearPremultiplied(out), data.width, data.height);
}

/** Return the maximum source-space footprint needed by a spatial blur. */
export function spatialBlurSupport(effect: SpatialBlurEffect): number {
  switch (effect.type) {
    case 'gaussianBlur':
      return Math.max(clampRadius(effect.sigmaX), clampRadius(effect.sigmaY)) * 3;
    case 'fieldBlur':
      return Math.max(0, ...effect.pins.map((pin) => clampRadius(pin.radius)));
    case 'irisBlur':
    case 'tiltShiftBlur':
      return Math.max(0, ...effect.regions.map((region) => clampRadius(region.amount)));
    case 'pathBlur':
      return Math.max(
        0,
        Math.abs(effect.amount),
        Math.abs(effect.startAmount),
        Math.abs(effect.endAmount),
      );
    case 'spinBlur':
      return Math.max(
        0,
        Math.max(Math.abs(effect.radii.x), Math.abs(effect.radii.y)) *
          Math.abs(finite(effect.angle, 0) * clampRadius(effect.amount)),
      );
  }
}

/** Deterministic scalar radius evaluator for diagnostic overlays and tests. */
export function spatialBlurRadiusAt(
  effect: SpatialBlurEffect,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  switch (effect.type) {
    case 'fieldBlur':
      return evalFieldRadius(effect, { x, y }, width, height);
    case 'irisBlur':
      return evalIrisRadius(effect, { x, y }, width, height);
    case 'tiltShiftBlur':
      return evalTiltRadius(effect, { x, y }, width, height);
    default:
      return 0;
  }
}

/** Apply a deterministic CPU reference implementation for spatial blur. */
export function applySpatialBlur(data: ImageData, effect: SpatialBlurEffect): ImageData {
  if (!effect.visible) return makeImageData(data.data, data.width, data.height);
  switch (effect.type) {
    case 'gaussianBlur': {
      return applyGaussianAxes(data, effect.sigmaX, effect.sigmaY, effect.edgeMode);
    }
    case 'fieldBlur':
      return applyVariableGaussian(
        data,
        (x, y) => evalFieldRadius(effect, { x, y }, data.width, data.height),
        effect.edgeMode,
      );
    case 'irisBlur':
      return applyVariableGaussian(
        data,
        (x, y) => evalIrisRadius(effect, { x, y }, data.width, data.height),
        effect.edgeMode,
      );
    case 'tiltShiftBlur':
      return applyVariableGaussian(
        data,
        (x, y) => evalTiltRadius(effect, { x, y }, data.width, data.height),
        effect.edgeMode,
      );
    case 'pathBlur':
      return applyMotionSamples(
        data,
        pathOffsets(effect, data.width, data.height),
        effect.edgeMode,
      );
    case 'spinBlur': {
      const center = normalizedPoint(effect.center, data.width, data.height);
      const pivot = normalizedPoint(effect.pivot, data.width, data.height);
      const rx = Math.max(1, Math.abs(effect.radii.x) * data.width);
      const ry = Math.max(1, Math.abs(effect.radii.y) * data.height);
      const feather = Math.max(1e-6, finite(effect.feather, 0));
      const sampleCount = Math.max(1, Math.min(64, Math.round(finite(effect.samples, 16))));
      const offsets: BlurCoordinate[] = [];
      for (let index = 0; index < sampleCount; index++) {
        const t = sampleCount === 1 ? 0.5 : index / (sampleCount - 1);
        const angle = (t - 0.5) * finite(effect.angle, 0) * clampRadius(effect.amount);
        const probe = rotateAround({ x: center.x + rx, y: center.y }, pivot, angle);
        offsets.push({ x: probe.x - (center.x + rx), y: probe.y - center.y });
      }
      return applyMotionSamples(data, offsets, effect.edgeMode, (x, y) => {
        const dx = x - center.x;
        const dy = y - center.y;
        const c = Math.cos(-finite(effect.rotation, 0));
        const s = Math.sin(-finite(effect.rotation, 0));
        const qx = (dx * c - dy * s) / rx;
        const qy = (dx * s + dy * c) / ry;
        return smoothstep((1 - Math.hypot(qx, qy)) / feather);
      });
    }
  }
}

/** Normalize untrusted spatial geometry without allocating from bad input. */
export function normalizeSpatialBlurEffect(effect: SpatialBlurEffect): SpatialBlurEffect {
  const base = {
    ...effect,
    algorithmVersion: Number.isInteger(effect.algorithmVersion)
      ? Math.max(1, effect.algorithmVersion)
      : SPATIAL_BLUR_ALGORITHM_VERSION,
    coordinateSpace: 'owner-normalized' as const,
    edgeMode: effect.edgeMode === 'transparent' ? ('transparent' as const) : ('clamp' as const),
    visible: effect.visible !== false,
  };
  if (effect.type === 'gaussianBlur') {
    const sigmaX = clampRadius(effect.sigmaX);
    const sigmaY = clampRadius(effect.linkedAxes ? effect.sigmaX : effect.sigmaY);
    return { ...base, type: effect.type, sigmaX, sigmaY, linkedAxes: effect.linkedAxes !== false };
  }
  if (effect.type === 'fieldBlur') {
    const pins = Array.isArray(effect.pins)
      ? effect.pins
          .slice(0, 128)
          .filter((pin) => pin && typeof pin.id === 'string')
          .map((pin) => ({
            ...pin,
            x: finite(pin.x, 0),
            y: finite(pin.y, 0),
            radius: clampRadius(pin.radius),
          }))
      : [];
    return {
      ...base,
      type: effect.type,
      pins,
      outsideHull:
        effect.outsideHull === 'zero' || effect.outsideHull === 'average'
          ? effect.outsideHull
          : 'nearest',
      interpolation: 'inverse-distance-v1',
      maxRadius: clampRadius(effect.maxRadius),
    };
  }
  if (effect.type === 'irisBlur') {
    const regions = Array.isArray(effect.regions)
      ? effect.regions
          .slice(0, 16)
          .filter((region) => region && typeof region.id === 'string')
          .map((region) => ({
            ...region,
            amount: clampRadius(region.amount),
            innerRatio: clamp01(region.innerRatio),
            feather: clamp01(region.feather),
          }))
      : [];
    return { ...base, type: effect.type, regions } as SpatialBlurEffect;
  }
  if (effect.type === 'tiltShiftBlur') {
    const regions = Array.isArray(effect.regions)
      ? effect.regions
          .slice(0, 16)
          .filter((region) => region && typeof region.id === 'string')
          .map((region) => ({
            ...region,
            amount: clampRadius(region.amount),
            sharpHalfWidth: Math.max(0, finite(region.sharpHalfWidth, 0)),
            feather: Math.max(0, finite(region.feather, 0)),
          }))
      : [];
    return { ...base, type: effect.type, regions } as SpatialBlurEffect;
  }
  if (effect.type === 'pathBlur') {
    return {
      ...base,
      type: effect.type,
      paths: Array.isArray(effect.paths) ? effect.paths.slice(0, 16) : [],
      amount: clampRadius(effect.amount),
      startAmount: clampRadius(effect.startAmount),
      endAmount: clampRadius(effect.endAmount),
      centered: effect.centered !== false,
      taper: clamp01(effect.taper),
      strobe: clamp01(effect.strobe),
      samples: Math.max(1, Math.min(64, Math.round(finite(effect.samples, 16)))),
    };
  }
  return {
    ...base,
    type: effect.type,
    amount: clampRadius(effect.amount),
    angle: finite(effect.angle, 0),
    feather: clamp01(effect.feather),
    samples: Math.max(1, Math.min(64, Math.round(finite(effect.samples, 16)))),
    center: {
      x: finite(effect.center?.x, 0.5),
      y: finite(effect.center?.y, 0.5),
    },
    pivot: {
      x: finite(effect.pivot?.x, 0.5),
      y: finite(effect.pivot?.y, 0.5),
    },
    rotation: finite(effect.rotation, 0),
    strobe: clamp01(effect.strobe),
    radii: {
      x: Math.max(1e-3, finite(effect.radii?.x, 0.5)),
      y: Math.max(1e-3, finite(effect.radii?.y, 0.5)),
    },
  } as SpatialBlurEffect;
}
