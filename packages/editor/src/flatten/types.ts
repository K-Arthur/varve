/**
 * Flatten types for the editor package. These define the public API
 * for flatten operations. Re-exports BoundsRect from scene and adds
 * engine-specific result types.
 */

import type { BoundsRect } from '@varve/scene';

export type { BoundsRect };

export type FlattenMode = 'flatten' | 'rasterize' | 'merge' | 'bake';

export type TextFlattenPolicy = 'preserve-editable' | 'outlines' | 'rasterize';

export type BoundsPolicy = 'selection' | 'visible';

export type BackgroundPolicy = 'transparent' | 'opaque';

export interface FlattenOptions {
  mode: FlattenMode;
  /** Legacy density-independent multiplier. Ignored when `dpi` is supplied. */
  scale?: number;
  /** Explicit raster output density in pixels per inch (96 design units/in). */
  dpi?: number;
  bounds?: BoundsPolicy;
  background?: BackgroundPolicy;
  backgroundColor?: readonly [number, number, number, number];
  textPolicy?: TextFlattenPolicy;
  includeEffectOverflow?: boolean;
  signal?: AbortSignal;
  onProgress?: (phase: string, progress: number) => void;
}

export interface FlattenWarning {
  code: string;
  message: string;
  nodeId?: string;
  severity: 'info' | 'warning' | 'error';
}

export interface FlattenResult {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  cssWidth: number;
  cssHeight: number;
  sourceBounds: BoundsRect;
  outputBounds: BoundsRect;
  assetId: string;
  placement: {
    dx: number;
    dy: number;
  };
  warnings: FlattenWarning[];
  flattenedNodeIds: string[];
  baseNodeId?: string;
}
