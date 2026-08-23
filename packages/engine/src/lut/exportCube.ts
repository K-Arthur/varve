/**
 * Export a LUT transform to Adobe .cube format.
 */

import type { Lut3D, LutTransform } from './types';
import { sampleLut1D, sampleLut3D } from './interpolate';

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

function exportSize(value: number | undefined, fallback: number): number {
  const candidate = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.max(2, Math.min(256, candidate));
}

function sample3dExportTransform(
  transform: Lut3D | Extract<LutTransform, { kind: 'shaper3d' }>,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  if (transform.kind === '3d') {
    return sampleLut3D(transform, r, g, b, 'tetrahedral');
  }

  const shaped = [
    sampleLut1D(transform.shaper, 'r', r),
    sampleLut1D(transform.shaper, 'g', g),
    sampleLut1D(transform.shaper, 'b', b),
  ] as const;
  return sampleLut3D(transform.lut3d, shaped[0], shaped[1], shaped[2], 'tetrahedral');
}

export function exportLutToCube(transform: LutTransform, options: CubeExportOptions = {}): string {
  const title = options.title ?? transform.metadata.title ?? 'Exported from Varve';
  const lines: string[] = [];

  lines.push(`TITLE "${title}"`);
  if (transform.metadata.author) {
    lines.push(`# Author: ${transform.metadata.author}`);
  }
  if (transform.metadata.description) {
    lines.push(`# Description: ${transform.metadata.description}`);
  }
  lines.push(`# Exported from Varve (format: ${transform.kind})`);

  if (transform.kind === '1d') {
    const lut = transform;
    const size = exportSize(options.size, lut.size);
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
      const t = i / (size - 1);
      const input = [
        domainMin[0] + t * (domainMax[0] - domainMin[0]),
        domainMin[1] + t * (domainMax[1] - domainMin[1]),
        domainMin[2] + t * (domainMax[2] - domainMin[2]),
      ] as const;
      lines.push(
        formatLine(
          sampleLut1D(lut, 'r', input[0]),
          sampleLut1D(lut, 'g', input[1]),
          sampleLut1D(lut, 'b', input[2]),
        ),
      );
    }
  } else if (transform.kind === '3d' || transform.kind === 'shaper3d') {
    const size = exportSize(
      options.size,
      transform.kind === '3d' ? transform.size : transform.lut3d.size,
    );
    const domainMin =
      options.domainMin ??
      (transform.kind === '3d' ? transform.inputMin : transform.lut3d.inputMin);
    const domainMax =
      options.domainMax ??
      (transform.kind === '3d' ? transform.inputMax : transform.lut3d.inputMax);

    lines.push(
      'DOMAIN_MIN ' +
        [formatFloat(domainMin[0]), formatFloat(domainMin[1]), formatFloat(domainMin[2])].join(' '),
    );
    lines.push(
      'DOMAIN_MAX ' +
        [formatFloat(domainMax[0]), formatFloat(domainMax[1]), formatFloat(domainMax[2])].join(' '),
    );
    lines.push(`LUT_3D_SIZE ${size}`);

    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const rb = r / (size - 1);
          const gb = g / (size - 1);
          const bb = b / (size - 1);
          const value = sample3dExportTransform(
            transform,
            domainMin[0] + rb * (domainMax[0] - domainMin[0]),
            domainMin[1] + gb * (domainMax[1] - domainMin[1]),
            domainMin[2] + bb * (domainMax[2] - domainMin[2]),
          );
          lines.push(formatLine(value[0], value[1], value[2]));
        }
      }
    }
  }

  return `${lines.join('\n')}\n`;
}
