/**
 * Bake an adjustment stack into a LUT.
 *
 * Works by sampling the adjustment pipeline on a uniform grid and storing
 * the output as a LUT. Supports 1D and 3D output, with configurable grid
 * size and domain mapping.
 *
 * Research basis: GPU Gems 2 ch.24 (Selan), OpenColorIO bake API,
 *   DaVinci Resolve LUT generation.
 */

import { applySoftwareFilter } from '../filterCompositor';
import { createRasterSurface } from '../rasterSurface';
import type { FilterIR } from '../types';
import type { Lut1D, Lut3D, LutInputSpace } from './types';
import { makeIdentityLut1D, makeIdentityLut3D } from './types';

export interface BakeOptions {
  /** Output format */
  format: '1d' | '3d';
  /** Grid size (per axis for 3D, per channel for 1D) */
  size: number;
  /** Input domain minimum */
  domainMin?: [number, number, number];
  /** Input domain maximum */
  domainMax?: [number, number, number];
  /** Assumed input colour space */
  inputSpace?: LutInputSpace;
  /** Mix amount (0..1) */
  intensity?: number;
  /** Whether to apply linearize before filter stack */
  linearize?: boolean;
}

export interface BakeResult {
  lut: Lut1D | Lut3D;
  /** Any adjustments that could not be represented */
  incompatibleFilters: FilterIR[];
}

function allFiltersBakeable(filters: FilterIR[]): FilterIR[] {
  return filters.filter(
    (f) => f.kind !== 'blur' && f.kind !== 'sharpen' && f.kind !== 'halftone' && f.kind !== 'chain',
  );
}

/**
 * Bake a filter stack into a LUT.
 *
 * Process: Render each filter onto an image with known input values,
 * sample the output, and build the LUT grid.
 */
export function bakeFiltersToLut(filters: FilterIR[], options: BakeOptions): BakeResult {
  const usable = allFiltersBakeable(filters);
  const incompatible = filters.filter((f) => !allFiltersBakeable(filters).includes(f));
  const size = options.size;
  const domainMin = options.domainMin ?? [0, 0, 0];
  const domainMax = options.domainMax ?? [1, 1, 1];

  if (usable.length === 0) {
    // Return identity LUT if no bakeable filters
    return {
      lut: options.format === '1d' ? makeIdentityLut1D(size) : makeIdentityLut3D(size),
      incompatibleFilters: incompatible,
    };
  }

  if (options.format === '3d') {
    const data = new Float64Array(size * size * size * 3);
    let idx = 0;

    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const ri = domainMin[0] + (r / (size - 1)) * (domainMax[0] - domainMin[0]);
          const gi = domainMin[1] + (g / (size - 1)) * (domainMax[1] - domainMin[1]);
          const bi = domainMin[2] + (b / (size - 1)) * (domainMax[2] - domainMin[2]);

          const surface = createRasterSurface(1, 1);
          surface.context.fillStyle = `rgb(${Math.round(ri * 255)}, ${Math.round(gi * 255)}, ${Math.round(bi * 255)})`;
          surface.context.fillRect(0, 0, 1, 1);
          const imageData = surface.context.getImageData(0, 0, 1, 1);

          for (const filter of usable) {
            applySoftwareFilter(surface.context, filter, 1, 1);
          }

          data[idx] = imageData.data[0]! / 255;
          data[idx + 1] = imageData.data[1]! / 255;
          data[idx + 2] = imageData.data[2]! / 255;
          idx += 3;
        }
      }
    }

    const lut: Lut3D = {
      kind: '3d',
      size,
      data,
      inputMin: domainMin,
      inputMax: domainMax,
      metadata: {
        title: 'Baked from adjustment stack',
        description: `${usable.length} filters baked at ${size}^3 resolution`,
      },
    };

    return { lut, incompatibleFilters: incompatible };
  } else {
    // 1D LUT — per-channel curves only
    // For a 1D LUT, we bake only per-channel adjustments
    const r = new Float64Array(size);
    const g = new Float64Array(size);
    const b = new Float64Array(size);

    for (let i = 0; i < size; i++) {
      const t = i / (size - 1);
      r[i] = t;
      g[i] = t;
      b[i] = t;

      const surface = createRasterSurface(1, 1);
      surface.context.fillStyle = `rgb(${Math.round(t * 255)}, ${Math.round(t * 255)}, ${Math.round(t * 255)})`;
      surface.context.fillRect(0, 0, 1, 1);

      for (const filter of usable) {
        applySoftwareFilter(surface.context, filter, 1, 1);
      }

      const imageData = surface.context.getImageData(0, 0, 1, 1);
      r[i] = imageData.data[0]! / 255;
    }

    const lut: Lut1D = {
      kind: '1d',
      size,
      r,
      g: r,
      b: r,
      inputMin: domainMin,
      inputMax: domainMax,
      metadata: {
        title: 'Baked 1D from adjustment stack',
      },
    };

    return { lut, incompatibleFilters: incompatible };
  }
}
