/**
 * Adobe .cube LUT format parser.
 *
 * Data is validated before typed-array allocation. The parser accepts the
 * standard RGB-triplet representation for 1D LUTs and the legacy planar
 * single-value representation emitted by older Strata builds.
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

/** 65^3 RGB float64 entries use about 6.3 MiB before parser overhead. */
export const MAX_LUT_3D_SIZE = 65;
/** 65,536 RGB float64 entries use 1.5 MiB. */
export const MAX_LUT_1D_SIZE = 65_536;
/** Prevent excessive decoded text and parser row overhead. */
export const MAX_LUT_TEXT_LENGTH = 32 * 1024 * 1024;

type Domain = [number, number, number];

interface DataRow {
  line: number;
  values: number[];
}

function withoutInlineComment(raw: string): string {
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) return raw.slice(0, i);
  }
  return raw;
}

function parseFiniteValues(parts: string[]): number[] | null {
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function parseSize(
  token: string | undefined,
  maximum: number,
  directive: string,
  line: number,
  errors: ParseCubeError[],
): number {
  if (!token || !/^\d+$/.test(token)) {
    errors.push({ line, message: `${directive} must be an integer in 2..${maximum}` });
    return 0;
  }
  const size = Number(token);
  if (!Number.isSafeInteger(size) || size < 2 || size > maximum) {
    errors.push({
      line,
      message: `${directive} must be 2..${maximum}, got ${token}`,
    });
    return 0;
  }
  return size;
}

function parseDomain(
  parts: string[],
  directive: string,
  line: number,
  errors: ParseCubeError[],
): Domain | null {
  if (parts.length !== 4) {
    errors.push({ line, message: `${directive} requires exactly three values` });
    return null;
  }
  const values = parseFiniteValues(parts.slice(1));
  if (!values) {
    errors.push({ line, message: `Invalid ${directive} values` });
    return null;
  }
  return [values[0]!, values[1]!, values[2]!];
}

function validateDomain(
  inputMin: Domain,
  inputMax: Domain,
  line: number,
  errors: ParseCubeError[],
): void {
  if (inputMax.some((value, channel) => value <= inputMin[channel]!)) {
    errors.push({
      line,
      message: 'DOMAIN_MAX must be greater than DOMAIN_MIN for every channel',
    });
  }
}

function makeMetadata(title: string | undefined) {
  return { title, sourceFormat: 'cube' };
}

export function parseCubeData(content: string): ParseCubeResult {
  if (content.length > MAX_LUT_TEXT_LENGTH) {
    throw new CubeParseError([
      {
        line: 0,
        message: `LUT file exceeds the 32 MiB limit (${content.length} characters)`,
      },
    ]);
  }
  let title: string | undefined;
  let inputMin: Domain = [0, 0, 0];
  let inputMax: Domain = [1, 1, 1];
  let domainMinLine = 0;
  let domainMaxLine = 0;
  let lutSize3D = 0;
  let lutSize1D = 0;
  let size3dLine = 0;
  let size1dLine = 0;
  const rows: DataRow[] = [];
  const errors: ParseCubeError[] = [];
  let dataStarted = false;

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = withoutInlineComment(lines[index] ?? '').trim();
    if (line.length === 0) continue;

    const parts = line.split(/\s+/);
    const directive = parts[0]?.toUpperCase() ?? '';

    if (directive === 'TITLE') {
      if (dataStarted) {
        errors.push({ line: lineNumber, message: 'TITLE cannot appear after LUT data' });
      } else if (title !== undefined) {
        errors.push({ line: lineNumber, message: 'Duplicate TITLE directive' });
      } else {
        const match = line.match(/^TITLE\s+"([^"]*)"\s*$/i);
        if (match) title = match[1];
        else errors.push({ line: lineNumber, message: 'TITLE must contain one quoted value' });
      }
      continue;
    }

    if (directive === 'DOMAIN_MIN' || directive === 'DOMAIN_MAX') {
      if (dataStarted) {
        errors.push({ line: lineNumber, message: `${directive} cannot appear after LUT data` });
        continue;
      }
      const isMin = directive === 'DOMAIN_MIN';
      const duplicate = isMin ? domainMinLine > 0 : domainMaxLine > 0;
      if (duplicate) {
        errors.push({ line: lineNumber, message: `Duplicate ${directive} directive` });
        continue;
      }
      const parsed = parseDomain(parts, directive, lineNumber, errors);
      if (parsed) {
        if (isMin) {
          inputMin = parsed;
          domainMinLine = lineNumber;
        } else {
          inputMax = parsed;
          domainMaxLine = lineNumber;
        }
      }
      continue;
    }

    if (directive === 'LUT_3D_SIZE' || directive === 'LUT_1D_SIZE') {
      if (dataStarted) {
        errors.push({ line: lineNumber, message: `${directive} cannot appear after LUT data` });
        continue;
      }
      const is3d = directive === 'LUT_3D_SIZE';
      const priorLine = is3d ? size3dLine : size1dLine;
      if (priorLine > 0) {
        errors.push({ line: lineNumber, message: `Duplicate ${directive} declaration` });
        continue;
      }
      if (parts.length !== 2) {
        errors.push({ line: lineNumber, message: `${directive} requires exactly one value` });
        continue;
      }
      const size = parseSize(
        parts[1],
        is3d ? MAX_LUT_3D_SIZE : MAX_LUT_1D_SIZE,
        directive,
        lineNumber,
        errors,
      );
      if (is3d) {
        lutSize3D = size;
        size3dLine = lineNumber;
      } else {
        lutSize1D = size;
        size1dLine = lineNumber;
      }
      continue;
    }

    const values = parseFiniteValues(parts);
    if (!values) {
      errors.push({ line: lineNumber, message: 'LUT data must contain only finite numbers' });
      continue;
    }
    if (lutSize3D === 0 && lutSize1D === 0) {
      errors.push({ line: lineNumber, message: 'LUT data appeared before a size declaration' });
      continue;
    }
    if (values.length !== 1 && values.length !== 3) {
      errors.push({
        line: lineNumber,
        message: 'LUT data rows must contain either one value or exactly three RGB values',
      });
      continue;
    }
    dataStarted = true;
    rows.push({ line: lineNumber, values });
  }

  if (lutSize3D > 0 && lutSize1D > 0) {
    errors.push({
      line: Math.max(size3dLine, size1dLine),
      message:
        'File declares both LUT_3D_SIZE and LUT_1D_SIZE. Combined shaper+3D files are not supported.',
    });
  }
  if (lutSize3D === 0 && lutSize1D === 0 && errors.length === 0) {
    errors.push({
      line: 0,
      message: 'File does not contain LUT_3D_SIZE or LUT_1D_SIZE declaration',
    });
  }
  validateDomain(inputMin, inputMax, Math.max(domainMinLine, domainMaxLine), errors);

  if (lutSize3D > 0) {
    const expectedRows = lutSize3D ** 3;
    if (rows.length !== expectedRows) {
      errors.push({
        line: lines.length,
        message: `Expected exactly ${expectedRows} RGB rows for ${lutSize3D}^3 3D LUT, got ${rows.length}`,
      });
    }
    const invalid = rows.find((row) => row.values.length !== 3);
    if (invalid) {
      errors.push({ line: invalid.line, message: '3D LUT rows require exactly three RGB values' });
    }
  }

  if (lutSize1D > 0) {
    const allRgb = rows.every((row) => row.values.length === 3);
    const allSingle = rows.every((row) => row.values.length === 1);
    if ((!allRgb || rows.length !== lutSize1D) && (!allSingle || rows.length !== lutSize1D * 3)) {
      errors.push({
        line: lines.length,
        message: `Expected exactly ${lutSize1D} RGB rows (or ${lutSize1D * 3} legacy single-value rows) for 1D LUT, got ${rows.length}`,
      });
    }
  }

  if (errors.length > 0) throw new CubeParseError(errors);

  if (lutSize3D > 0) {
    const data = new Float64Array(lutSize3D ** 3 * 3);
    for (let row = 0; row < rows.length; row++) {
      data[row * 3] = rows[row]!.values[0]!;
      data[row * 3 + 1] = rows[row]!.values[1]!;
      data[row * 3 + 2] = rows[row]!.values[2]!;
    }
    const transform: Lut3D = {
      kind: '3d',
      size: lutSize3D,
      data,
      inputMin,
      inputMax,
      metadata: makeMetadata(title),
    };
    return { transform, title };
  }

  const r = new Float64Array(lutSize1D);
  const g = new Float64Array(lutSize1D);
  const b = new Float64Array(lutSize1D);
  const rgbRows = rows[0]?.values.length === 3;
  for (let index = 0; index < lutSize1D; index++) {
    if (rgbRows) {
      r[index] = rows[index]!.values[0]!;
      g[index] = rows[index]!.values[1]!;
      b[index] = rows[index]!.values[2]!;
    } else {
      r[index] = rows[index]!.values[0]!;
      g[index] = rows[lutSize1D + index]!.values[0]!;
      b[index] = rows[lutSize1D * 2 + index]!.values[0]!;
    }
  }
  const transform: Lut1D = {
    kind: '1d',
    size: lutSize1D,
    r,
    g,
    b,
    inputMin,
    inputMax,
    metadata: makeMetadata(title),
  };
  return { transform, title };
}
