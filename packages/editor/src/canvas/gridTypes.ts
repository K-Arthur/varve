import type { DocumentGrid } from '@strata/scene';

export type { DocumentGrid };

export type GridOverlayMode = 'none' | 'document' | 'baseline' | 'isometric';

export function computeMajorStep(spacing: number, subdivisions: number): number {
  return spacing * Math.max(1, subdivisions);
}

export interface GridRenderState {
  zoom: number;
  panX: number;
  panY: number;
  cameraRotation: number;
  viewportWidth: number;
  viewportHeight: number;
  dotGridEnabled: boolean;
  pixelGridEnabled: boolean;
  documentGrid: DocumentGrid;
  gridOverlayMode: GridOverlayMode;
}

export interface GridViewportLines {
  major: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  minor: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}
