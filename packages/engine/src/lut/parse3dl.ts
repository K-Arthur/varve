/**
 * Autodesk/Discreet .3dl LUT format parser.
 *
 * The format is not a text .cube with another extension. Real Flame/Lustre
 * files contain integer code values, optionally have one scalar shaper row,
 * and store 3D entries blue-fastest (B changes before G, then R). The
 * canonical Varve LUT representation is R-fastest, so the parser transposes
 * the entry coordinates before storing them.
 *
 * A small normalized-value compatibility path is retained for older Varve
 * fixtures and simple third-party files that use decimal values in [0, 1].
 * It is only selected when the values are visibly fractional; integer-only
 * files with a maximum below the plausible 8-bit code range are rejected as
 * ambiguous rather than silently producing a washed-out LUT.
 *
 * The integer/shaper interpretation follows the upstream OpenColorIO 3DL
 * reader: https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormat3DL.cpp
 */

import { MAX_LUT_3D_SIZE, MAX_LUT_TEXT_LENGTH } from './parseCube';
import type { Lut1D, Lut3D, LutTransform, Shaper3D } from './types';

export interface Parse3dlResult {
  transform: LutTransform;
}

export class Parse3dlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Parse3dlError';
  }
}

interface NumericRow {
  tokens: string[];
  values: number[];
}

function isFiniteToken(token: string): boolean {
  return token.length > 0 && Number.isFinite(Number(token));
}

function looksNumeric(token: string): boolean {
  return /^[0-9.+-]/.test(token);
}

function isIntegerToken(token: string): boolean {
  return /^[+-]?\d+$/.test(token);
}

function withoutInlineComment(raw: string): string {
  const hash = raw.indexOf('#');
  return (hash >= 0 ? raw.slice(0, hash) : raw).trim();
}

function isPerfectCube(n: number): { root: number; isCube: boolean } {
  const root = Math.round(Math.cbrt(n));
  return { root, isCube: root * root * root === n };
}

/** Infer the integer code range using the same bounded even-bit-depth bands
 * used by the reference .3dl reader. A 2x overshoot is accepted because some
 * files contain values slightly above the nominal code maximum. */
function inferCodeMaximum(maximum: number, label: string): number {
  const candidates = [255, 1023, 4095, 16383, 65535];
  const codeMaximum = candidates.find((candidate) => maximum <= candidate * 2 + 1);
  if (maximum < 128 || codeMaximum === undefined) {
    throw new Parse3dlError(
      `${label} maximum ${maximum} is not a plausible 8–16-bit .3dl code range`,
    );
  }
  return codeMaximum;
}

function normalizeCodeValues(values: number[], codeMaximum: number | null): number[] {
  if (codeMaximum === null) return values;
  return values.map((value) => value / codeMaximum);
}

function makeShaper(values: number[], codeMaximum: number | null): Lut1D {
  const normalized = normalizeCodeValues(values, codeMaximum);
  return {
    kind: '1d',
    size: normalized.length,
    r: Float64Array.from(normalized),
    g: Float64Array.from(normalized),
    b: Float64Array.from(normalized),
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: {
      sourceFormat: '3dl',
      description: `Autodesk/Discreet .3dl shaper (${normalized.length} samples)`,
    },
  };
}

export function parse3dlData(content: string): Parse3dlResult {
  if (content.length > MAX_LUT_TEXT_LENGTH) {
    throw new Parse3dlError(`LUT file exceeds the 32 MiB limit (${content.length} characters)`);
  }

  const dataRows: NumericRow[] = [];
  let shaperRow: NumericRow | undefined;
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = withoutInlineComment(lines[index] ?? '');
    if (line.length === 0) continue;

    const tokens = line.split(/\s+/);
    if (!tokens.every(isFiniteToken)) {
      // Flame/Lustre headers are textual (3DMESH, Mesh, LUT8, gamma, …).
      // The upstream reader intentionally ignores those lines. If a line
      // starts like a numeric row, report it instead of hiding malformed
      // data behind the header tolerance.
      const firstToken = tokens[0] ?? '';
      const hasTextHeader = /[a-z]/i.test(firstToken);
      const hasNonFiniteToken = tokens.some((token) => /^(?:nan|infinity|inf)$/i.test(token));
      if ((!hasTextHeader && looksNumeric(firstToken)) || hasNonFiniteToken) {
        throw new Parse3dlError(
          `Invalid data row at line ${lineNumber}: values must be finite numbers`,
        );
      }
      continue;
    }

    const values = tokens.map(Number);
    if (values.length > 3) {
      if (shaperRow) {
        throw new Parse3dlError(`More than one shaper row found (line ${lineNumber})`);
      }
      shaperRow = { tokens, values };
      continue;
    }
    if (values.length !== 3) {
      throw new Parse3dlError(`Invalid data row at line ${lineNumber}: expected three RGB values`);
    }
    if (values.some((value) => value < 0)) {
      throw new Parse3dlError(`Invalid data row at line ${lineNumber}: values cannot be negative`);
    }
    dataRows.push({ tokens, values });
  }

  if (dataRows.length === 0) {
    throw new Parse3dlError('No 3D LUT data rows found in .3dl file');
  }

  const { root: size, isCube } = isPerfectCube(dataRows.length);
  if (!isCube) {
    throw new Parse3dlError(
      `Data row count ${dataRows.length} is not a perfect cube. Cannot determine grid size.`,
    );
  }
  if (size < 2 || size > MAX_LUT_3D_SIZE) {
    throw new Parse3dlError(
      `Grid size ${size} is outside the supported range (2..${MAX_LUT_3D_SIZE})`,
    );
  }

  const rows = shaperRow ? [shaperRow, ...dataRows] : dataRows;
  const allIntegerValues = rows.every((row) => row.values.every(Number.isInteger));
  const hasDecimalNotation = rows.some((row) => row.tokens.some((token) => !isIntegerToken(token)));
  const maximum = Math.max(...rows.flatMap((row) => row.values));
  const normalizedCompatibility = hasDecimalNotation && maximum <= 1;
  if (!normalizedCompatibility && !allIntegerValues) {
    throw new Parse3dlError(
      'Real .3dl code values must be integers; fractional values are only accepted in the [0, 1] compatibility form',
    );
  }

  const dataMaximum = Math.max(...dataRows.flatMap((row) => row.values));
  const dataCodeMaximum = normalizedCompatibility ? null : inferCodeMaximum(dataMaximum, '3D LUT');
  const shaperCodeMaximum = shaperRow
    ? normalizedCompatibility
      ? null
      : inferCodeMaximum(Math.max(...shaperRow.values), 'shaper LUT')
    : null;

  const data = new Float64Array(size ** 3 * 3);
  for (let sourceIndex = 0; sourceIndex < dataRows.length; sourceIndex++) {
    const row = dataRows[sourceIndex]!;
    const blue = sourceIndex % size;
    const green = Math.floor(sourceIndex / size) % size;
    const red = Math.floor(sourceIndex / (size * size));
    const targetIndex = ((blue * size + green) * size + red) * 3;
    const output = normalizeCodeValues(row.values, dataCodeMaximum);
    data[targetIndex] = output[0]!;
    data[targetIndex + 1] = output[1]!;
    data[targetIndex + 2] = output[2]!;
  }

  const valueDescription = normalizedCompatibility
    ? 'normalized [0,1] compatibility values'
    : `integer code values normalized from ${dataCodeMaximum}`;
  const lut3d: Lut3D = {
    kind: '3d',
    size,
    data,
    inputMin: [0, 0, 0],
    inputMax: [1, 1, 1],
    metadata: {
      sourceFormat: '3dl',
      description: `Autodesk/Discreet .3dl LUT (${size}^3; ${valueDescription}; blue-fastest)`,
    },
  };

  if (!shaperRow) return { transform: lut3d };

  const shaper = makeShaper(shaperRow.values, shaperCodeMaximum);
  const transform: Shaper3D = {
    kind: 'shaper3d',
    shaper,
    lut3d,
    metadata: {
      sourceFormat: '3dl',
      description: `Autodesk/Discreet .3dl shaper + ${size}^3 LUT (${valueDescription})`,
    },
  };
  return { transform };
}
