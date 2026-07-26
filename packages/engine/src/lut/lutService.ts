/**
 * LUT service — import, manage, and resolve LUTs from the editor.
 *
 * Provides utilities for:
 *   - Detecting LUT format from file extension/magic bytes
 *   - Parsing LUT data bytes
 *   - Building LUT adjustment from a file
 *   - Serializing LUT transforms for document storage
 */

import { deserializeLutTransform, serializeLutTransform } from './codec';
import { parse3dlData } from './parse3dl';
import { MAX_LUT_TEXT_LENGTH, parseCubeData } from './parseCube';
import type { LutTransform } from './types';

export type LutFileFormat = 'cube' | '3dl' | 'unknown';
export { MAX_LUT_TEXT_LENGTH } from './parseCube';

export interface LutImportResult {
  transform: LutTransform;
  format: LutFileFormat;
  title?: string;
  warnings?: string[];
  /** Stable non-cryptographic content fingerprint for duplicate detection. */
  fingerprint: string;
}

export function detectLutFormat(filename: string, data: string): LutFileFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'cube') return 'cube';
  if (ext === '3dl') return '3dl';

  if (data.includes('LUT_3D_SIZE') || data.includes('LUT_1D_SIZE')) return 'cube';
  if (data.includes('3DMESH') || /^[\d\s.]+$/.test(data.slice(0, 100).trim())) return '3dl';

  return 'unknown';
}

export function parseLutFile(filename: string, data: string): LutImportResult {
  if (data.length > MAX_LUT_TEXT_LENGTH) {
    throw new Error(`LUT file exceeds the 32 MiB limit (${data.length} characters)`);
  }
  const format = detectLutFormat(filename, data);
  const warnings: string[] = [];

  switch (format) {
    case 'cube': {
      const result = parseCubeData(data);
      const fingerprint = fingerprintLut(result.transform);
      return {
        transform: result.transform,
        format: 'cube',
        title: result.title,
        fingerprint,
      };
    }
    case '3dl': {
      const result = parse3dlData(data);
      warnings.push(
        '.3dl format has limited support: no domain metadata, no colour-space info, grid size auto-detected',
      );
      const fingerprint = fingerprintLut(result.transform);
      return {
        transform: result.transform,
        format: '3dl',
        warnings,
        fingerprint,
      };
    }
    default:
      // Try both parsers as fallback
      try {
        const result = parseCubeData(data);
        return {
          transform: result.transform,
          format: 'cube',
          title: result.title,
          warnings: ['Format detected by content, not extension'],
          fingerprint: fingerprintLut(result.transform),
        };
      } catch {
        try {
          const result = parse3dlData(data);
          return {
            transform: result.transform,
            format: '3dl',
            warnings: [...warnings, 'Format detected by content, not extension'],
            fingerprint: fingerprintLut(result.transform),
          };
        } catch {
          throw new Error(
            `Cannot parse "${filename}" as a supported LUT format. Supported formats: .cube, .3dl`,
          );
        }
      }
  }
}

export function serializeLutForDocument(transform: LutTransform): string {
  return serializeLutTransform(transform);
}

export function deserializeLutFromDocument(json: string): LutTransform {
  return deserializeLutTransform(json);
}

export function fingerprintLut(transform: LutTransform): string {
  const withoutDisplayMetadata = (value: LutTransform): LutTransform => {
    switch (value.kind) {
      case '1d':
        return { ...value, metadata: {} };
      case '3d':
        return { ...value, metadata: {} };
      case 'shaper3d':
        return {
          ...value,
          shaper: withoutDisplayMetadata(value.shaper) as typeof value.shaper,
          lut3d: withoutDisplayMetadata(value.lut3d) as typeof value.lut3d,
          metadata: {},
        };
    }
  };
  const canonical = serializeLutTransform(withoutDisplayMetadata(transform));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < canonical.length; index++) {
    const code = canonical.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `lut-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function estimateLutMemoryUsage(transform: LutTransform): number {
  switch (transform.kind) {
    case '1d':
      return transform.r.byteLength * 3;
    case '3d':
      return transform.data.byteLength;
    case 'shaper3d':
      return transform.shaper.r.byteLength * 3 + transform.lut3d.data.byteLength;
  }
}
