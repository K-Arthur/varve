import { MAX_LUT_1D_SIZE, MAX_LUT_3D_SIZE } from './parseCube';
import type { Lut1D, Lut3D, LutMetadata, LutTransform, Shaper3D } from './types';

const CODEC_NAME = 'strata-lut';
const CODEC_VERSION = 1;

interface LutEnvelope {
  schema: typeof CODEC_NAME;
  version: typeof CODEC_VERSION;
  transform: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSize(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 2 || (value as number) > maximum) {
    throw new Error(`${label} size must be an integer in 2..${maximum}`);
  }
  return value as number;
}

function readFloatArray(value: unknown, length: number, label: string): Float64Array {
  let raw: unknown[];
  if (Array.isArray(value)) {
    raw = value;
  } else if (isRecord(value)) {
    raw = Array.from({ length }, (_, index) => value[String(index)]);
  } else {
    throw new Error(`${label} must be an array`);
  }
  if (raw.length !== length) {
    throw new Error(`${label} must contain exactly ${length} values`);
  }
  if (!raw.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    throw new Error(`${label} values must be finite numbers`);
  }
  return Float64Array.from(raw as number[]);
}

function readDomain(value: unknown, label: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    throw new Error(`${label} must contain exactly three finite numbers`);
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function readMetadata(value: unknown): LutMetadata {
  if (!isRecord(value)) return {};
  const metadata: LutMetadata = {};
  const fields = [
    'title',
    'author',
    'description',
    'copyright',
    'sourceFormat',
    'assetId',
    'originalData',
  ] as const;
  for (const field of fields) {
    const entry = value[field];
    if (entry !== undefined) {
      if (typeof entry !== 'string') throw new Error(`LUT metadata.${field} must be a string`);
      metadata[field] = entry;
    }
  }
  return metadata;
}

function validateDomain(
  inputMin: [number, number, number],
  inputMax: [number, number, number],
): void {
  if (inputMax.some((value, index) => value <= inputMin[index]!)) {
    throw new Error('LUT inputMax must be greater than inputMin for every channel');
  }
}

function readLut1D(value: Record<string, unknown>): Lut1D {
  const size = readSize(value.size, MAX_LUT_1D_SIZE, '1D LUT');
  const inputMin = readDomain(value.inputMin, '1D LUT inputMin');
  const inputMax = readDomain(value.inputMax, '1D LUT inputMax');
  validateDomain(inputMin, inputMax);
  return {
    kind: '1d',
    size,
    r: readFloatArray(value.r, size, '1D LUT red channel'),
    g: readFloatArray(value.g, size, '1D LUT green channel'),
    b: readFloatArray(value.b, size, '1D LUT blue channel'),
    inputMin,
    inputMax,
    metadata: readMetadata(value.metadata),
  };
}

function readLut3D(value: Record<string, unknown>): Lut3D {
  const size = readSize(value.size, MAX_LUT_3D_SIZE, '3D LUT');
  const inputMin = readDomain(value.inputMin, '3D LUT inputMin');
  const inputMax = readDomain(value.inputMax, '3D LUT inputMax');
  validateDomain(inputMin, inputMax);
  return {
    kind: '3d',
    size,
    data: readFloatArray(value.data, size ** 3 * 3, '3D LUT data'),
    inputMin,
    inputMax,
    metadata: readMetadata(value.metadata),
  };
}

export function normalizeLutTransform(value: unknown): LutTransform {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('Serialized LUT must be an object with a supported kind');
  }
  if (value.kind === '1d') return readLut1D(value);
  if (value.kind === '3d') return readLut3D(value);
  if (value.kind === 'shaper3d') {
    const shaper = normalizeLutTransform(value.shaper);
    const lut3d = normalizeLutTransform(value.lut3d);
    if (shaper.kind !== '1d' || lut3d.kind !== '3d') {
      throw new Error('Shaper3D requires a 1D shaper and a 3D LUT');
    }
    const result: Shaper3D = {
      kind: 'shaper3d',
      shaper,
      lut3d,
      metadata: readMetadata(value.metadata),
    };
    return result;
  }
  throw new Error(`Unsupported LUT kind: ${value.kind}`);
}

function serializableTransform(transform: LutTransform): unknown {
  switch (transform.kind) {
    case '1d':
      return {
        ...transform,
        r: Array.from(transform.r),
        g: Array.from(transform.g),
        b: Array.from(transform.b),
      };
    case '3d':
      return { ...transform, data: Array.from(transform.data) };
    case 'shaper3d':
      return {
        ...transform,
        shaper: serializableTransform(transform.shaper),
        lut3d: serializableTransform(transform.lut3d),
      };
  }
}

export function serializeLutTransform(transform: LutTransform): string {
  const validated = normalizeLutTransform(transform);
  const envelope: LutEnvelope = {
    schema: CODEC_NAME,
    version: CODEC_VERSION,
    transform: serializableTransform(validated),
  };
  return JSON.stringify(envelope);
}

export function deserializeLutTransform(json: string): LutTransform {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Serialized LUT is not valid JSON');
  }
  if (isRecord(parsed) && parsed.schema === CODEC_NAME) {
    if (parsed.version !== CODEC_VERSION) {
      throw new Error(`Unsupported Varve LUT schema version: ${String(parsed.version)}`);
    }
    return normalizeLutTransform(parsed.transform);
  }
  // Backward compatibility for documents created before the versioned codec.
  return normalizeLutTransform(parsed);
}
