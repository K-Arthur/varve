/**
 * LUT service — import, manage, and resolve LUTs from the editor.
 *
 * Provides utilities for:
 *   - Detecting LUT format from file extension/magic bytes
 *   - Parsing LUT data bytes
 *   - Building LUT adjustment from a file
 *   - Serializing LUT transforms for document storage
 */

import { parse3dlData } from './parse3dl';
import { parseCubeData } from './parseCube';
import type { LutTransform } from './types';

export type LutFileFormat = 'cube' | '3dl' | 'unknown';

export interface LutImportResult {
  transform: LutTransform;
  format: LutFileFormat;
  title?: string;
  warnings?: string[];
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
  const format = detectLutFormat(filename, data);
  const warnings: string[] = [];

  switch (format) {
    case 'cube': {
      const result = parseCubeData(data);
      return {
        transform: result.transform,
        format: 'cube',
        title: result.title,
      };
    }
    case '3dl': {
      const result = parse3dlData(data);
      warnings.push(
        '.3dl format has limited support: no domain metadata, no colour-space info, grid size auto-detected',
      );
      return {
        transform: result.transform,
        format: '3dl',
        warnings,
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
        };
      } catch {
        try {
          const result = parse3dlData(data);
          return {
            transform: result.transform,
            format: '3dl',
            warnings: [...warnings, 'Format detected by content, not extension'],
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
  return JSON.stringify(transform);
}

export function deserializeLutFromDocument(json: string): LutTransform {
  return JSON.parse(json) as LutTransform;
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
