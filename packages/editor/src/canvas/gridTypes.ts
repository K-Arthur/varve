export type GridOverlayMode = 'none' | 'document' | 'baseline' | 'isometric';

export interface DocumentGrid {
  visible: boolean;
  spacingX: number;
  spacingY: number;
  subdivisions: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  snapEnabled: boolean;
}

export function createDefaultDocumentGrid(): DocumentGrid {
  return {
    visible: false,
    spacingX: 8,
    spacingY: 8,
    subdivisions: 4,
    offsetX: 0,
    offsetY: 0,
    color: 'var(--color-border-subtle)',
    opacity: 0.4,
    snapEnabled: true,
  };
}

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
