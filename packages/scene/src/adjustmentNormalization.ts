/**
 * Persistence-boundary normalization for the shared Adjustment union.
 *
 * Adjustments are intentionally defined by @varve/engine because they feed
 * FilterIR, but serialized scene data is untrusted. This module is the scene
 * boundary that fills fields added by newer/older documents, clamps values
 * that could create invalid pixels or unbounded raster work, and drops
 * unknown entries with an explicit warning from DocumentCodec.
 */

import {
  adjustmentDefaults,
  type Adjustment,
  type AdjustmentBlendMode,
  type AdjustmentKind,
  isKnownAdjustmentKind,
} from '@varve/engine';

const BLEND_MODES: readonly AdjustmentBlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'hardLight',
  'colorDodge',
  'colorBurn',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'passThrough',
];

const ENUMS: Record<string, readonly string[]> = {
  channel: ['rgb', 'red', 'green', 'blue'],
  outputChannel: ['red', 'green', 'blue'],
  colorRange: [
    'reds',
    'yellows',
    'greens',
    'cyans',
    'blues',
    'magentas',
    'whites',
    'neutrals',
    'blacks',
  ],
  interpolation: ['nearest', 'trilinear', 'tetrahedral', 'smoothstep', 'linear'],
  inputSpace: [
    'sRGB',
    'linear',
    'rec709',
    'rec2020',
    'displayP3',
    'adobeRGB',
    'aces2065-1',
    'acescg',
    'acescct',
    'arriLogC3',
    'arriLogC4',
    'sonySLog3',
    'redLog3G10',
    'panasonicVLog',
    'canonCLog2',
    'canonCLog3',
    'nconlog',
    'davinciWideGamut',
    'custom',
  ],
  quality: ['auto', 'interactive', 'draft', 'normal', 'high', 'final'],
};

const KIND_NUMERIC_RANGES: Record<string, Record<string, [number, number]>> = {
  brightness: { value: [-100, 100] },
  contrast: { value: [-100, 100] },
  saturation: { value: [-100, 100] },
  vibrance: { value: [-100, 100] },
  hueRotate: { value: [-180, 180] },
  sepia: { value: [0, 100] },
  grayscale: { value: [0, 100] },
  invert: { value: [0, 100] },
  opacity: { value: [0, 100] },
  exposure: { value: [-32, 32], offset: [-1, 1], gammaCorrection: [0.01, 10] },
  blur: { radius: [0, 4096] },
  sharpen: { amount: [0, 4096], radius: [0, 4096], threshold: [0, 255] },
  temperature: { value: [-100, 100] },
  tint: { value: [-100, 100] },
  levels: {
    inputShadows: [0, 255],
    inputMidtones: [0.01, 10],
    inputHighlights: [0, 255],
    outputShadows: [0, 255],
    outputHighlights: [0, 255],
  },
  posterize: { levels: [2, 256] },
  threshold: { level: [0, 255] },
  lut: { intensity: [0, 1] },
  shadowHighlight: {
    shadows: [0, 100],
    highlights: [0, 100],
    tonalWidth: [0, 100],
    midpoint: [0, 100],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number, min = -4096, max = 4096): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function numberRange(kind: AdjustmentKind, key: string): [number, number] {
  if (key === 'opacity') return [0, 1];
  if (key === 'id') return [0, 0];
  return KIND_NUMERIC_RANGES[kind]?.[key] ?? [-4096, 4096];
}

function normalizeColor(value: unknown, fallback: unknown): unknown {
  const source = Array.isArray(value) ? value : Array.isArray(fallback) ? fallback : [];
  const base = Array.isArray(fallback) ? fallback : [];
  return source.map((channel, index) =>
    finiteNumber(channel, finiteNumber(base[index], 0, 0, 255), 0, 255),
  );
}

function normalizeStops(value: unknown, fallback: unknown): unknown[] {
  const source = Array.isArray(value) ? value : [];
  const defaultStops = Array.isArray(fallback) ? fallback : [];
  const stops = source.length > 0 ? source : defaultStops;
  return stops.filter(isRecord).map((stop, index) => {
    const defaultStop = isRecord(defaultStops[index]) ? defaultStops[index] : {};
    const position = finiteNumber(
      stop.position,
      finiteNumber(defaultStop.position, index / Math.max(1, stops.length - 1), 0, 1),
      0,
      1,
    );
    const color = normalizeColor(stop.color, defaultStop.color ?? [0, 0, 0, 255]);
    const result: Record<string, unknown> = { ...stop, position, color };
    if ('opacity' in stop || 'opacity' in defaultStop) {
      result.opacity = finiteNumber(stop.opacity, finiteNumber(defaultStop.opacity, 1, 0, 1), 0, 1);
    }
    if ('midpoint' in stop || 'midpoint' in defaultStop) {
      result.midpoint = finiteNumber(
        stop.midpoint,
        finiteNumber(defaultStop.midpoint, 0.5, 0, 1),
        0,
        1,
      );
    }
    return result;
  });
}

function normalizeOpacityStops(value: unknown, fallback: unknown): unknown[] {
  const source = Array.isArray(value) ? value : [];
  const defaultStops = Array.isArray(fallback) ? fallback : [];
  const stops = source.length > 0 ? source : defaultStops;
  return stops.filter(isRecord).map((stop, index) => {
    const defaultStop = isRecord(defaultStops[index]) ? defaultStops[index] : {};
    return {
      ...stop,
      position: finiteNumber(
        stop.position,
        finiteNumber(defaultStop.position, index / Math.max(1, stops.length - 1), 0, 1),
        0,
        1,
      ),
      opacity: finiteNumber(stop.opacity, finiteNumber(defaultStop.opacity, 1, 0, 1), 0, 1),
      ...(stop.midpoint !== undefined || defaultStop.midpoint !== undefined
        ? {
            midpoint: finiteNumber(
              stop.midpoint,
              finiteNumber(defaultStop.midpoint, 0.5, 0, 1),
              0,
              1,
            ),
          }
        : {}),
    };
  });
}

function normalizeCurvePoints(value: unknown): Array<{ input: number; output: number }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((point) => ({
    input: finiteNumber(point.input ?? point.x, 0, 0, 255),
    output: finiteNumber(point.output ?? point.y, 0, 0, 255),
  }));
}

function normalizeValue(
  kind: AdjustmentKind,
  key: string,
  value: unknown,
  fallback: unknown,
): unknown {
  if (value === undefined && fallback === undefined) return undefined;
  if (key === 'points') return normalizeCurvePoints(value);
  if (key === 'stops') return normalizeStops(value, fallback);
  if (key === 'opacityStops') return normalizeOpacityStops(value, fallback);
  if (key === 'channelStops' && isRecord(value)) {
    const fallbackRecord = isRecord(fallback) ? fallback : {};
    return Object.fromEntries(
      ['r', 'g', 'b'].map((channel) => [
        channel,
        normalizeStops(value[channel], fallbackRecord[channel]),
      ]),
    );
  }
  if (key === 'color' || key === 'tintColor' || key.endsWith('Color')) {
    return normalizeColor(value, fallback);
  }
  if (typeof fallback === 'number') {
    const [min, max] = numberRange(kind, key);
    return finiteNumber(value, fallback, min, max);
  }
  if (typeof fallback === 'boolean') return typeof value === 'boolean' ? value : fallback;
  if (typeof fallback === 'string') {
    const allowed = ENUMS[key];
    return allowed?.includes(value as string) ? value : fallback;
  }
  if (Array.isArray(fallback)) return normalizeColor(value, fallback);
  if (isRecord(fallback)) {
    const source = isRecord(value) ? value : {};
    const result: Record<string, unknown> = { ...source };
    for (const [childKey, childFallback] of Object.entries(fallback)) {
      result[childKey] = normalizeValue(kind, childKey, source[childKey], childFallback);
    }
    return result;
  }
  return value === undefined ? fallback : value;
}

export interface NormalizedAdjustmentStack {
  adjustments: Adjustment[];
  changed: boolean;
  dropped: number;
}

/** Normalize an adjustment or smart-filter stack without mutating its input. */
export function normalizeAdjustmentStack(
  value: unknown,
  ownerId: string,
): NormalizedAdjustmentStack {
  if (!Array.isArray(value)) return { adjustments: [], changed: value !== undefined, dropped: 0 };

  let changed = false;
  let dropped = 0;
  const adjustments: Adjustment[] = [];
  value.forEach((raw, index) => {
    if (!isRecord(raw) || !isKnownAdjustmentKind(raw.kind)) {
      dropped++;
      changed = true;
      return;
    }

    const kind = raw.kind as AdjustmentKind;
    const defaults = adjustmentDefaults(kind) as Record<string, unknown>;
    const normalized: Record<string, unknown> = { ...raw };
    normalized.id =
      typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `adj-${ownerId}-${index + 1}`;
    normalized.kind = kind;
    normalized.visible =
      typeof raw.visible === 'boolean' ? raw.visible : (defaults.visible ?? true);
    normalized.opacity = finiteNumber(raw.opacity, finiteNumber(defaults.opacity, 1, 0, 1), 0, 1);
    normalized.blendMode = BLEND_MODES.includes(raw.blendMode as AdjustmentBlendMode)
      ? raw.blendMode
      : (defaults.blendMode ?? 'normal');

    for (const [key, fallback] of Object.entries(defaults)) {
      if (key === 'visible' || key === 'opacity' || key === 'blendMode') continue;
      normalized[key] = normalizeValue(kind, key, raw[key], fallback);
    }

    // Optional ramps are not present in every adjustment's defaults. Keep
    // their normalization independent of the default object so malformed
    // persisted opacity stops cannot bypass the boundary clamp.
    if (raw.opacityStops !== undefined) {
      normalized.opacityStops = normalizeOpacityStops(raw.opacityStops, undefined);
    }

    // Several gradient-map controls are optional so old documents can omit
    // them. Normalize them when present even though they are absent from the
    // default object used above.
    if (kind === 'gradientMap') {
      if (raw.channelStops !== undefined) {
        normalized.channelStops = normalizeValue(kind, 'channelStops', raw.channelStops, {});
      }
      if (raw.intensity !== undefined) normalized.intensity = finiteNumber(raw.intensity, 1, 0, 1);
      if (raw.lutSize !== undefined) normalized.lutSize = finiteNumber(raw.lutSize, 256, 2, 4096);
      if (raw.reverse !== undefined) normalized.reverse = raw.reverse === true;
      if (raw.preserveSourceAlpha !== undefined)
        normalized.preserveSourceAlpha = raw.preserveSourceAlpha === true;
      if (raw.luminanceMode !== undefined) {
        const luminanceModes = [
          'relative-luminance',
          'perceptual-lightness',
          'average-rgb',
          'max-channel',
          'alpha',
          'red',
          'green',
          'blue',
          'compatibility',
        ];
        normalized.luminanceMode = luminanceModes.includes(raw.luminanceMode as string)
          ? raw.luminanceMode
          : 'relative-luminance';
      }
    }

    if (JSON.stringify(normalized) !== JSON.stringify(raw)) changed = true;
    adjustments.push(normalized as unknown as Adjustment);
  });

  return { adjustments, changed, dropped };
}
