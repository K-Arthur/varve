/**
 * Export a LUT transform to Adobe .cube format.
 */

import type { LutTransform } from './types';

export interface CubeExportOptions {
  title?: string;
  domainMin?: [number, number, number];
  domainMax?: [number, number, number];
  size?: number;
}

function formatFloat(v: number): string {
  return v.toFixed(6);
}

function formatLine(r: number, g: number, b: number): string {
  return `${formatFloat(r)} ${formatFloat(g)} ${formatFloat(b)}`;
}

export function exportLutToCube(transform: LutTransform, options: CubeExportOptions = {}): string {
  const title = options.title ?? transform.metadata.title ?? 'Exported from Strata';
  const lines: string[] = [];

  lines.push(`TITLE "${title}"`);
  if (transform.metadata.author) {
    lines.push(`# Author: ${transform.metadata.author}`);
  }
  if (transform.metadata.description) {
    lines.push(`# Description: ${transform.metadata.description}`);
  }
  lines.push(`# Exported from Strata (format: ${transform.kind})`);

  if (transform.kind === '1d') {
    const lut = transform;
    const size = options.size ?? lut.size;
    const domainMin = options.domainMin ?? lut.inputMin;
    const domainMax = options.domainMax ?? lut.inputMax;

    lines.push(
      'DOMAIN_MIN ' +
        [formatFloat(domainMin[0]), formatFloat(domainMin[1]), formatFloat(domainMin[2])].join(' '),
    );
    lines.push(
      'DOMAIN_MAX ' +
        [formatFloat(domainMax[0]), formatFloat(domainMax[1]), formatFloat(domainMax[2])].join(' '),
    );
    lines.push(`LUT_1D_SIZE ${size}`);

    for (let i = 0; i < size; i++) {
      const srcIdx = Math.min(i, lut.size - 1);
      lines.push(formatLine(lut.r[srcIdx]!, lut.g[srcIdx]!, lut.b[srcIdx]!));
    }
  } else if (transform.kind === '3d') {
    const lut = transform;
    const size = options.size ?? lut.size;
    const domainMin = options.domainMin ?? lut.inputMin;
    const domainMax = options.domainMax ?? lut.inputMax;

    lines.push(
      'DOMAIN_MIN ' +
        [formatFloat(domainMin[0]), formatFloat(domainMin[1]), formatFloat(domainMin[2])].join(' '),
    );
    lines.push(
      'DOMAIN_MAX ' +
        [formatFloat(domainMax[0]), formatFloat(domainMax[1]), formatFloat(domainMax[2])].join(' '),
    );
    lines.push(`LUT_3D_SIZE ${size}`);

    if (size === lut.size) {
      for (let i = 0; i < lut.data.length; i += 3) {
        lines.push(formatLine(lut.data[i]!, lut.data[i + 1]!, lut.data[i + 2]!));
      }
    } else {
      const step = lut.size - 1 > 0 ? 1.0 / (lut.size - 1) : 1;
      const dstStep = size - 1 > 0 ? 1.0 / (size - 1) : 1;
      for (let b = 0; b < size; b++) {
        for (let g = 0; g < size; g++) {
          for (let r = 0; r < size; r++) {
            const srcR = Math.min(Math.round((r * dstStep) / step), lut.size - 1);
            const srcG = Math.min(Math.round((g * dstStep) / step), lut.size - 1);
            const srcB = Math.min(Math.round((b * dstStep) / step), lut.size - 1);
            const idx = ((srcB * lut.size + srcG) * lut.size + srcR) * 3;
            lines.push(formatLine(lut.data[idx]!, lut.data[idx + 1]!, lut.data[idx + 2]!));
          }
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
