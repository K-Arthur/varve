/**
 * Grid system types for Strata documents.
 *
 * This module defines the data model for all grid types in Strata:
 * - Document grid: Document-wide cartesian grid for alignment
 * - Layout grid: Frame-level grid for responsive layout
 * - Baseline grid: Typography grid for text alignment
 * - Pixel grid: 1px grid for pixel-perfect work
 *
 * All grid settings are persisted in the Document model, not localStorage.
 */

/**
 * Grid scope determines where a grid applies.
 */
export type GridScope = 'document' | 'page' | 'frame' | 'textFrame';

/**
 * Base interface for all grid types.
 */
export interface GridBase {
  /** Stable identifier for the grid. */
  id: string;
  /** Human-readable name for the grid. */
  name?: string;
  /** Whether the grid is currently visible. */
  visible: boolean;
  /** Whether snapping to this grid is enabled. */
  snapEnabled: boolean;
  /** Whether the grid is locked from editing. */
  locked?: boolean;
  /** Grid line color (CSS color string). */
  color: string;
  /** Grid line opacity (0-1). */
  opacity: number;
  /** Scope of the grid (document/page/frame/textFrame). */
  scope: GridScope;
  /** Page ID for page-scoped grids. */
  pageId?: string;
  /** Frame ID for frame-scoped grids. */
  frameId?: string;
}

/**
 * Document grid: document-wide cartesian grid for general alignment.
 */
export interface DocumentGrid extends GridBase {
  type: 'document';
  /** Horizontal spacing in document units. */
  spacingX: number;
  /** Vertical spacing in document units. */
  spacingY: number;
  /** Number of subdivisions between major lines. */
  subdivisions: number;
  /** Horizontal offset from document origin. */
  offsetX: number;
  /** Vertical offset from document origin. */
  offsetY: number;
  /** Grid rotation in radians (future: not yet implemented). */
  rotation?: number;
}

/**
 * Layout grid: frame-level grid for responsive layout (columns/rows).
 */
export interface LayoutGrid extends GridBase {
  type: 'layout';
  /** Grid mode: columns, rows, or uniform. */
  layoutMode: 'columns' | 'rows' | 'uniform';
  /** Number of columns (for column mode). */
  columnCount?: number;
  /** Column width in px (for column mode). */
  columnWidth?: number;
  /** Gutter width in px. */
  gutter: number;
  /** Margin [top, right, bottom, left] in px. */
  margin: [number, number, number, number];
  /** Alignment mode: stretch, left, center, right. */
  alignment: 'stretch' | 'left' | 'center' | 'right';
  /** Number of rows (for row mode). */
  rowCount?: number;
  /** Row height in px (for row mode). */
  rowHeight?: number;
}

/**
 * Baseline grid: typography grid for text baseline alignment.
 */
export interface BaselineGrid extends GridBase {
  type: 'baseline';
  /** Baseline increment in document units. */
  baselineStep: number;
  /** Start offset from document origin. */
  offset: number;
  /** Whether to snap text baselines only. */
  snapTextBaseline: boolean;
}

/**
 * Pixel grid: 1px grid for pixel-perfect work.
 */
export interface PixelGrid extends GridBase {
  type: 'pixel';
  /** Whether to show at high zoom only. */
  showAtHighZoom: boolean;
  /** Zoom threshold for showing pixel grid (e.g., 400%). */
  zoomThreshold: number;
}

export type IsometricPreset = 'standard' | 'dimetric' | 'trimetric' | 'custom';

export interface IsometricAxis {
  angle: number;
  visible: boolean;
  color?: string;
  opacity?: number;
  spacing?: number;
  label?: string;
}

export interface IsometricGrid extends GridBase {
  type: 'isometric';
  preset: IsometricPreset;
  axes: IsometricAxis[];
  originX: number;
  originY: number;
  rotation: number;
  spacing: number;
  version: number;
}

export function validateIsometricAxes(axes: IsometricAxis[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (axes.length < 2 || axes.length > 3) {
    errors.push('Isometric grid requires 2-3 axes, got ' + axes.length);
    return { valid: false, errors };
  }
  for (let i = 0; i < axes.length; i++) {
    const a = axes[i];
    for (let j = i + 1; j < axes.length; j++) {
      const b = axes[j];
      const diff = Math.abs((((a.angle % 360) + 360) % 360) - (((b.angle % 360) + 360) % 360));
      if (diff < 0.1 || diff > 359.9) errors.push('Axis ' + i + ' and ' + j + ' are duplicates');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normaliseAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

export function createStandardIsometricAxes(): IsometricAxis[] {
  return [
    { angle: 30, visible: true, label: 'Right' },
    { angle: 150, visible: true, label: 'Left' },
    { angle: 90, visible: true, label: 'Vertical' },
  ];
}

export function createDefaultIsometricGrid(): IsometricGrid {
  return {
    id: 'grid-isometric-default',
    type: 'isometric',
    name: 'Isometric Grid',
    visible: false,
    snapEnabled: true,
    color: 'var(--color-text-muted)',
    opacity: 0.2,
    scope: 'document',
    preset: 'standard',
    axes: createStandardIsometricAxes(),
    originX: 0,
    originY: 0,
    rotation: 0,
    spacing: 24,
    version: 2,
  };
}

/**
 * Discriminated union of all grid types.
 */
export type GridDefinition = DocumentGrid | LayoutGrid | BaselineGrid | PixelGrid | IsometricGrid;

/**
 * Grid settings container in the Document model.
 */
export interface DocumentGridSettings {
  /** Active document grid (if any). */
  documentGrid?: DocumentGrid;
  /** Layout grids keyed by frame ID. */
  layoutGrids?: Record<string, LayoutGrid>;
  /** Baseline grids keyed by ID. */
  baselineGrids?: Record<string, BaselineGrid>;
  /** Pixel grid settings (singleton). */
  pixelGrid?: PixelGrid;
  /** Isometric grids keyed by ID. */
  isometricGrids?: Record<string, IsometricGrid>;
}

/**
 * Default document grid configuration.
 */
export function createDefaultDocumentGrid(): DocumentGrid {
  return {
    id: 'grid-document-default',
    type: 'document',
    name: 'Document Grid',
    visible: false,
    snapEnabled: true,
    color: 'var(--color-border-subtle)',
    opacity: 0.4,
    scope: 'document',
    spacingX: 8,
    spacingY: 8,
    subdivisions: 4,
    offsetX: 0,
    offsetY: 0,
  };
}

/**
 * Default layout grid configuration.
 */
export function createDefaultLayoutGrid(): LayoutGrid {
  return {
    id: 'grid-layout-default',
    type: 'layout',
    name: 'Layout Grid',
    visible: true,
    snapEnabled: true,
    color: 'var(--color-border-subtle)',
    opacity: 0.3,
    scope: 'frame',
    layoutMode: 'columns',
    columnCount: 12,
    gutter: 20,
    margin: [20, 20, 20, 20],
    alignment: 'stretch',
  };
}

/**
 * Default baseline grid configuration.
 */
export function createDefaultBaselineGrid(): BaselineGrid {
  return {
    id: 'grid-baseline-default',
    type: 'baseline',
    name: 'Baseline Grid',
    visible: false,
    snapEnabled: true,
    color: 'var(--color-border-subtle)',
    opacity: 0.3,
    scope: 'document',
    baselineStep: 24,
    offset: 0,
    snapTextBaseline: true,
  };
}

/**
 * Default pixel grid configuration.
 */
export function createDefaultPixelGrid(): PixelGrid {
  return {
    id: 'grid-pixel-default',
    type: 'pixel',
    name: 'Pixel Grid',
    visible: false,
    snapEnabled: false,
    color: 'var(--color-border-subtle)',
    opacity: 0.5,
    scope: 'document',
    showAtHighZoom: true,
    zoomThreshold: 4.0,
  };
}

/**
 * Validate grid spacing values.
 */
export function validateGridSpacing(spacing: number): boolean {
  return Number.isFinite(spacing) && spacing > 0 && spacing <= 10000;
}

/**
 * Validate grid subdivisions.
 */
export function validateGridSubdivisions(subdivisions: number): boolean {
  return Number.isInteger(subdivisions) && subdivisions >= 1 && subdivisions <= 100;
}

/**
 * Validate grid opacity.
 */
export function validateGridOpacity(opacity: number): boolean {
  return Number.isFinite(opacity) && opacity >= 0 && opacity <= 1;
}

/**
 * Validate a document grid definition.
 */
export function validateDocumentGrid(grid: DocumentGrid): boolean {
  return (
    validateGridSpacing(grid.spacingX) &&
    validateGridSpacing(grid.spacingY) &&
    validateGridSubdivisions(grid.subdivisions) &&
    Number.isFinite(grid.offsetX) &&
    Number.isFinite(grid.offsetY) &&
    validateGridOpacity(grid.opacity)
  );
}

/**
 * Validate a layout grid definition.
 */
export function validateLayoutGrid(grid: LayoutGrid): boolean {
  return (
    grid.gutter >= 0 &&
    grid.gutter <= 1000 &&
    grid.margin.every((m) => m >= 0 && m <= 1000) &&
    validateGridOpacity(grid.opacity)
  );
}

/**
 * Validate a baseline grid definition.
 */
export function validateBaselineGrid(grid: BaselineGrid): boolean {
  return (
    validateGridSpacing(grid.baselineStep) &&
    Number.isFinite(grid.offset) &&
    validateGridOpacity(grid.opacity)
  );
}

/**
 * Validate a pixel grid definition.
 */
export function validatePixelGrid(grid: PixelGrid): boolean {
  return grid.zoomThreshold >= 1 && grid.zoomThreshold <= 100 && validateGridOpacity(grid.opacity);
}

export function validateIsometricGrid(grid: IsometricGrid): boolean {
  return (
    validateGridSpacing(grid.spacing) &&
    validateGridOpacity(grid.opacity) &&
    Number.isFinite(grid.originX) &&
    Number.isFinite(grid.originY) &&
    Number.isFinite(grid.rotation) &&
    validateIsometricAxes(grid.axes).valid
  );
}

/**
 * Validate any grid definition based on its type.
 */
export function validateGrid(grid: GridDefinition): boolean {
  switch (grid.type) {
    case 'document':
      return validateDocumentGrid(grid);
    case 'layout':
      return validateLayoutGrid(grid);
    case 'baseline':
      return validateBaselineGrid(grid);
    case 'pixel':
      return validatePixelGrid(grid);
    case 'isometric':
      return validateIsometricGrid(grid);
    default:
      return false;
  }
}

/**
 * Sanitize a grid definition by clamping values to valid ranges.
 */
export function sanitizeGrid(grid: GridDefinition): GridDefinition {
  const sanitized = { ...grid };

  // Clamp opacity
  sanitized.opacity = Math.max(0, Math.min(1, sanitized.opacity));

  // Type-specific sanitization
  if (sanitized.type === 'document') {
    sanitized.spacingX = Math.max(1, Math.min(10000, sanitized.spacingX));
    sanitized.spacingY = Math.max(1, Math.min(10000, sanitized.spacingY));
    sanitized.subdivisions = Math.max(1, Math.min(100, sanitized.subdivisions));
    sanitized.offsetX = Math.max(-10000, Math.min(10000, sanitized.offsetX));
    sanitized.offsetY = Math.max(-10000, Math.min(10000, sanitized.offsetY));
  } else if (sanitized.type === 'layout') {
    sanitized.gutter = Math.max(0, Math.min(1000, sanitized.gutter));
    sanitized.margin = sanitized.margin.map((m) => Math.max(0, Math.min(1000, m))) as [
      number,
      number,
      number,
      number,
    ];
  } else if (sanitized.type === 'baseline') {
    sanitized.baselineStep = Math.max(1, Math.min(10000, sanitized.baselineStep));
    sanitized.offset = Math.max(-10000, Math.min(10000, sanitized.offset));
  } else if (sanitized.type === 'pixel') {
    sanitized.zoomThreshold = Math.max(1, Math.min(100, sanitized.zoomThreshold));
  } else if (sanitized.type === 'isometric') {
    sanitized.spacing = Math.max(1, Math.min(10000, sanitized.spacing));
    sanitized.originX = Math.max(-100000, Math.min(100000, sanitized.originX));
    sanitized.originY = Math.max(-100000, Math.min(100000, sanitized.originY));
    sanitized.rotation = ((sanitized.rotation % 360) + 360) % 360;
    sanitized.axes = sanitized.axes
      .slice(0, 3)
      .map((a) => ({ ...a, angle: ((a.angle % 360) + 360) % 360, visible: a.visible !== false }));
  }

  return sanitized;
}
