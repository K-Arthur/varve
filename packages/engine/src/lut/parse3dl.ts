/**
 * Autodesk .3dl LUT format parser (limited support).
 *
 * Format:
 *   Lines starting with # are comments
 *   Data lines: space-separated RGB triplets
 *   Order: R varies fastest, then G, then B
 *   Grid size determined by cube root of line count
 *
 * Limitations:
 *   - No explicit grid size declaration (must be a perfect cube)
 *   - No domain metadata
 *   - No 1D LUT support
 *   - No colour-space metadata
 *
 * Research basis:
 *   Autodesk Flame/Smoke LUT format documentation,
 *   OpenColorIO FileFormat3dl.cpp.
 */

import { MAX_LUT_3D_SIZE, MAX_LUT_TEXT_LENGTH } from './parseCube';
import type { Lut3D } from './types';

export interface Parse3dlResult {
  transform: Lut3D;
}

export class Parse3dlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Parse3dlError';
  }
}

function isPerfectCube(n: number): { root: number; isCube: boolean } {
  const root = Math.round(Math.cbrt(n));
  return { root, isCube: root * root * root === n };
}

export function parse3dlData(content: string): Parse3dlResult {
  if (content.length > MAX_LUT_TEXT_LENGTH) {
    throw new Parse3dlError(`LUT file exceeds the 32 MiB limit (${content.length} characters)`);
  }
  const values: number[] = [];
  let lineCount = 0;

  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').split('#', 1)[0]!.trim();
    if (line.length === 0) continue;
    if (line.toUpperCase().startsWith('3DMESH')) continue;

    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new Parse3dlError(`Invalid data row at line ${index + 1}: expected exactly 3 values`);
    }
    const row = parts.map(Number);
    if (!row.every(Number.isFinite)) {
      throw new Parse3dlError(`Invalid data row at line ${index + 1}: values must be finite`);
    }
    values.push(row[0]!, row[1]!, row[2]!);
    lineCount++;
  }

  if (lineCount === 0) {
    throw new Parse3dlError('No valid data lines found in .3dl file');
  }

  const { root, isCube } = isPerfectCube(lineCount);
  if (!isCube) {
    throw new Parse3dlError(
      `Data line count ${lineCount} is not a perfect cube. Cannot determine grid size.`,
    );
  }

  if (root < 2 || root > MAX_LUT_3D_SIZE) {
    throw new Parse3dlError(
      `Grid size ${root} is outside the supported range (2..${MAX_LUT_3D_SIZE})`,
    );
  }

  const size = root;
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Parse3dlError(
      `Expected ${expected} float values for ${size}^3 grid, got ${values.length}`,
    );
  }

  const data = new Float64Array(expected);
  for (let i = 0; i < expected; i++) {
    data[i] = values[i]!;
  }

  return {
    transform: {
      kind: '3d',
      size,
      data,
      inputMin: [0, 0, 0],
      inputMax: [1, 1, 1],
      metadata: {
        sourceFormat: '3dl',
        description: `Autodesk .3dl LUT (${size}^3, converted on import)`,
      },
    },
  };
}
