/**
 * Adobe .cube LUT format parser.
 *
 * Research basis:
 *   Adobe .cube specification (2015),
 *   OpenColorIO FileFormatCube.cpp,
 *   DaVinci Resolve LUT format extensions.
 */

import type { Lut1D, Lut3D, LutTransform } from './types';

export interface ParseCubeResult {
  transform: LutTransform;
  title?: string;
}

export interface ParseCubeError {
  line: number;
  message: string;
}

export class CubeParseError extends Error {
  errors: ParseCubeError[];
  constructor(errors: ParseCubeError[]) {
    super(errors.map((e) => `Line ${e.line}: ${e.message}`).join('; '));
    this.errors = errors;
    this.name = 'CubeParseError';
  }
}

const MAX_LUT_SIZE = 256;

function parseFloatSafe(s: string | undefined): number | null {
  if (s === undefined) return null;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

export function parseCubeData(content: string): ParseCubeResult {
  let title: string | undefined;
  let inputMin: [number, number, number] = [0, 0, 0];
  let inputMax: [number, number, number] = [1, 1, 1];
  let lutSize3D = 0;
  let lutSize1D = 0;
  const dataValues: number[] = [];
  const errors: ParseCubeError[] = [];
  let lineNum = 0;
  let inData = false;

  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    lineNum++;
    const line = rawLine.trim();

    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const upper = line.toUpperCase();

    if (upper.startsWith('TITLE')) {
      const match = line.match(/^TITLE\s+"([^"]*)"/i);
      if (match) title = match[1];
      continue;
    }

    if (upper.startsWith('DOMAIN_MIN')) {
      const parts = line.split(/\s+/);
      const v0 = parseFloatSafe(parts[1]);
      const v1 = parseFloatSafe(parts[2]);
      const v2 = parseFloatSafe(parts[3]);
      if (v0 !== null && v1 !== null && v2 !== null) {
        inputMin = [v0, v1, v2];
      } else {
        errors.push({ line: lineNum, message: 'Invalid DOMAIN_MIN values' });
      }
      continue;
    }

    if (upper.startsWith('DOMAIN_MAX')) {
      const parts = line.split(/\s+/);
      const v0 = parseFloatSafe(parts[1]);
      const v1 = parseFloatSafe(parts[2]);
      const v2 = parseFloatSafe(parts[3]);
      if (v0 !== null && v1 !== null && v2 !== null) {
        inputMax = [v0, v1, v2];
      } else {
        errors.push({ line: lineNum, message: 'Invalid DOMAIN_MAX values' });
      }
      continue;
    }

    if (upper.startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/);
      const n = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(n) && n >= 2 && n <= MAX_LUT_SIZE) {
        lutSize3D = n;
      } else {
        errors.push({
          line: lineNum,
          message: `LUT_3D_SIZE must be 2..${MAX_LUT_SIZE}, got ${parts[1] ?? ''}`,
        });
      }
      continue;
    }

    if (upper.startsWith('LUT_1D_SIZE')) {
      const parts = line.split(/\s+/);
      const n = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(n) && n >= 2 && n <= MAX_LUT_SIZE) {
        lutSize1D = n;
      } else {
        errors.push({
          line: lineNum,
          message: `LUT_1D_SIZE must be 2..${MAX_LUT_SIZE}, got ${parts[1] ?? ''}`,
        });
      }
      continue;
    }

    const parts = line.split(/\s+/);
    const floats = parts.map((p) => parseFloatSafe(p)).filter((f): f is number => f !== null);

    if (floats.length >= 3) {
      inData = true;
      dataValues.push(floats[0]!, floats[1]!, floats[2]!);
    } else if (floats.length >= 1 && inData) {
      dataValues.push(floats[0]!);
    } else if (floats.length >= 1 && !inData && lutSize1D > 0) {
      inData = true;
      dataValues.push(floats[0]!);
    } else if (!inData) {
      errors.push({ line: lineNum, message: `Unrecognised directive: ${line.slice(0, 50)}` });
    }
  }

  if (errors.length > 0) {
    throw new CubeParseError(errors);
  }

  if (lutSize3D > 0 && lutSize1D > 0) {
    throw new CubeParseError([
      {
        line: 0,
        message:
          'File declares both LUT_3D_SIZE and LUT_1D_SIZE. Combined shaper+3D is not supported as a single file; import separately.',
      },
    ]);
  }

  if (lutSize3D > 0) {
    const expected = lutSize3D ** 3 * 3;
    if (dataValues.length < expected) {
      throw new CubeParseError([
        {
          line: lineNum,
          message: `Expected ${expected} data values for ${lutSize3D}^3 3D LUT, got ${dataValues.length}`,
        },
      ]);
    }

    const data = new Float64Array(expected);
    for (let i = 0; i < expected; i++) {
      const v = dataValues[i];
      if (v !== undefined) data[i] = v;
    }

    const transform: Lut3D = {
      kind: '3d',
      size: lutSize3D,
      data,
      inputMin,
      inputMax,
      metadata: {
        title,
        sourceFormat: 'cube',
      },
    };
    return { transform, title };
  }

  if (lutSize1D > 0) {
    const expected = lutSize1D * 3;
    if (dataValues.length < expected) {
      throw new CubeParseError([
        {
          line: lineNum,
          message: `Expected ${expected} data values for 1D LUT, got ${dataValues.length}`,
        },
      ]);
    }

    const r = new Float64Array(lutSize1D);
    const g = new Float64Array(lutSize1D);
    const b = new Float64Array(lutSize1D);
    for (let i = 0; i < lutSize1D; i++) {
      r[i] = dataValues[i]!;
    }
    for (let i = 0; i < lutSize1D; i++) {
      g[i] = dataValues[lutSize1D + i]!;
    }
    for (let i = 0; i < lutSize1D; i++) {
      b[i] = dataValues[lutSize1D * 2 + i]!;
    }

    const transform: Lut1D = {
      kind: '1d',
      size: lutSize1D,
      r,
      g,
      b,
      inputMin,
      inputMax,
      metadata: {
        title,
        sourceFormat: 'cube',
      },
    };
    return { transform, title };
  }

  throw new CubeParseError([
    { line: 0, message: 'File does not contain LUT_3D_SIZE or LUT_1D_SIZE declaration' },
  ]);
}
