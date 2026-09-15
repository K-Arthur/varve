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

import { axisSeparationDegrees, DIMETRIC_2_1_ANGLE_DEG } from './isometricGeometry';

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
  /**
   * @deprecated Not consumed. Per-family line spacing is derived from the
   * lattice basis (`s·sin θ`); storing an independent value here would let the
   * three families disagree. Retained only so authored legacy data is not
   * dropped during sanitization/migration.
   */
  spacing?: number;
  label?: string;
}

export interface IsometricGrid extends GridBase {
  type: 'isometric';
  preset: IsometricPreset;
  axes: IsometricAxis[];
  originX: number;
  originY: number;
  /** Grid rotation about the origin, degrees. */
  rotation: number;
  /**
   * Projected length of one lattice step along each axis (lattice constant).
   *
   * v2.28+: this is an **axis step**. Legacy documents (formatVersion ≤ 2.27)
   * stored a per-family perpendicular line gap; `migrateV227ToV228` converts
   * it by dividing by `sin θ` so the drawn grid does not move.
   */
  spacing: number;
  /** v2.28+: records which spacing convention the stored value uses. */
  spacingMode?: 'axis-step';
  /** v2.28+: active construction plane for new geometry. `none` keeps ordinary 2-D drawing. */
  activePlaneId?: import('./isometricGeometry').IsometricPlaneId | 'none';
  /** v2.28+: major line interval in lattice steps (>=1). */
  majorEvery?: number;
  /** v2.28+: snap to all lattice intersections vs displayed lines only. */
  snapToSubdivisions?: boolean;
  /** v2.28+: snap to the grid's line families, not only intersections. */
  snapToLines?: boolean;
  /**
   * v2.28+: last authored custom axis set. Switching to a preset and back to
   * Custom restores it instead of discarding the user's configuration.
   */
  customAxes?: IsometricAxis[];
  version: number;
}

/**
 * Validate axis directions with numerical conditioning, not just duplicate
 * equality: two axes 0.5° apart are distinct but useless as a lattice basis.
 */
export function validateIsometricAxes(axes: IsometricAxis[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (axes.length < 2 || axes.length > 3) {
    errors.push(`Isometric grid requires 2-3 axes, got ${axes.length}`);
    return { valid: false, errors };
  }
  for (const [index, axis] of axes.entries()) {
    if (!Number.isFinite(axis.angle)) {
      errors.push(`Axis ${index + 1} angle must be finite`);
    }
    if (
      axis.opacity !== undefined &&
      (!Number.isFinite(axis.opacity) || axis.opacity < 0 || axis.opacity > 1)
    ) {
      errors.push(`Axis ${index + 1} opacity must be within 0-1`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  const visible = axes.filter((axis) => axis.visible !== false);
  if (visible.length >= 2) {
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        if (axisSeparationDegrees(axes[i]!.angle, axes[j]!.angle) < 1e-3) {
          errors.push(`Axis ${i + 1} and ${j + 1} are duplicates`);
        }
      }
    }
    if (errors.length === 0) {
      const separation = axisSeparationDegrees(visible[0]!.angle, visible[1]!.angle);
      if (separation < 5) {
        errors.push(
          `Axis 1 and 2 are only ${separation.toFixed(2)}° apart; a stable lattice needs at least 5°`,
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function normaliseAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  return ((angle % 360) + 360) % 360;
}

export function createStandardIsometricAxes(): IsometricAxis[] {
  return [
    { angle: 30, visible: true, label: 'Right' },
    { angle: 150, visible: true, label: 'Left' },
    { angle: 90, visible: true, label: 'Vertical' },
  ];
}

export interface IsometricPresetDef {
  id: IsometricPreset;
  label: string;
  /** Honest one-line description of what the preset does and does not claim. */
  description: string;
  /** Exact rhombus ratio when the preset is ratio-derived (`height:width`). */
  ratio?: { height: number; width: number };
  axes: IsometricAxis[];
}

export const ISOMETRIC_PRESETS: IsometricPresetDef[] = [
  {
    id: 'standard',
    label: 'True isometric (30°)',
    description:
      'Exact equal-axis 30° projection: both ground axes are 30° from horizontal and all three projected axes share one scale.',
    axes: createStandardIsometricAxes(),
  },
  {
    id: 'dimetric',
    label: 'Dimetric 2:1 (26.565°)',
    description:
      'Exact ratio-derived 2:1 game-art projection (slope 1:2). The angle is computed as atan2(1, 2), not rounded.',
    ratio: { height: 1, width: 2 },
    axes: [
      { angle: DIMETRIC_2_1_ANGLE_DEG, visible: true, label: 'Right' },
      { angle: 180 - DIMETRIC_2_1_ANGLE_DEG, visible: true, label: 'Left' },
      { angle: 90, visible: true, label: 'Vertical' },
    ],
  },
  {
    id: 'trimetric',
    label: 'Trimetric-style (15° / 75°)',
    description:
      'Illustrative three-angle guide, not a measured trimetric projection: use it as directional construction guides.',
    axes: [
      { angle: 15, visible: true, label: 'Right' },
      { angle: 135, visible: true, label: 'Left' },
      { angle: 75, visible: true, label: 'Vertical' },
    ],
  },
];

export function getPresetAxes(preset: IsometricPreset): IsometricAxis[] {
  const found = ISOMETRIC_PRESETS.find((p) => p.id === preset);
  return found ? found.axes.map((a) => ({ ...a })) : createStandardIsometricAxes();
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
    spacingMode: 'axis-step',
    activePlaneId: 'top',
    majorEvery: 4,
    snapToSubdivisions: true,
    snapToLines: false,
    version: 3,
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
  /** Layout guides keyed by frame ID; each frame may own multiple guides. */
  layoutGrids?: Record<string, LayoutGrid[]>;
  /** Baseline grids keyed by ID. */
  baselineGrids?: Record<string, BaselineGrid>;
  /** Pixel grid settings (singleton). */
  pixelGrid?: PixelGrid;
  /** Isometric grids keyed by ID. */
  isometricGrids?: Record<string, IsometricGrid>;
  /**
   * v2.28+: explicit active isometric grid. Absence must never be resolved by
   * object-iteration order; use `resolveActiveIsometricGrid`.
   */
  activeIsometricGridId?: string;
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
    (grid.rotation === undefined || Number.isFinite(grid.rotation)) &&
    validateGridOpacity(grid.opacity)
  );
}

/**
 * Validate a layout grid definition.
 */
export function validateLayoutGrid(grid: LayoutGrid): boolean {
  const validCount = (value: number | undefined) =>
    value === undefined || (Number.isInteger(value) && value >= 1 && value <= 100);
  const validSize = (value: number | undefined) =>
    value === undefined || (Number.isFinite(value) && value > 0 && value <= 100000);
  return (
    Number.isFinite(grid.gutter) &&
    grid.gutter >= 0 &&
    grid.gutter <= 1000 &&
    grid.margin.length === 4 &&
    grid.margin.every((m) => Number.isFinite(m) && m >= 0 && m <= 1000) &&
    validCount(grid.columnCount) &&
    validCount(grid.rowCount) &&
    validSize(grid.columnWidth) &&
    validSize(grid.rowHeight) &&
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
    (grid.majorEvery === undefined ||
      (Number.isInteger(grid.majorEvery) && grid.majorEvery >= 1 && grid.majorEvery <= 64)) &&
    (grid.activePlaneId === undefined ||
      grid.activePlaneId === 'none' ||
      grid.activePlaneId === 'top' ||
      grid.activePlaneId === 'front' ||
      grid.activePlaneId === 'side') &&
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
 * Clamp a possibly non-finite value into `[min, max]`. `Math.min`/`Math.max`
 * propagate NaN, which is how malformed saved grids used to poison the model;
 * this returns the fallback instead.
 */
function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/**
 * Sanitize an isometric grid. Handles NaN and Infinity explicitly (rather
 * than clamping them through), preserves the last valid identity, and
 * normalises optional v2.28 fields with defaults.
 */
export function sanitizeIsometricGrid(grid: IsometricGrid): IsometricGrid {
  const sanitized: IsometricGrid = {
    ...grid,
    opacity: clampFinite(grid.opacity, 0, 1, 0.2),
    spacing: clampFinite(grid.spacing, 0.01, 100000, 24),
    spacingMode: 'axis-step',
    originX: clampFinite(grid.originX, -1e7, 1e7, 0),
    originY: clampFinite(grid.originY, -1e7, 1e7, 0),
    rotation: Number.isFinite(grid.rotation) ? ((grid.rotation % 360) + 360) % 360 : 0,
    activePlaneId:
      grid.activePlaneId === 'none' ||
      grid.activePlaneId === 'front' ||
      grid.activePlaneId === 'side'
        ? grid.activePlaneId
        : 'top',
    majorEvery: Number.isInteger(grid.majorEvery)
      ? Math.max(1, Math.min(64, grid.majorEvery as number))
      : 4,
    snapToSubdivisions: grid.snapToSubdivisions !== false,
    snapToLines: grid.snapToLines === true,
    axes: (Array.isArray(grid.axes) ? grid.axes : []).slice(0, 3).map((axis) => ({
      ...axis,
      angle: normaliseAngle(axis?.angle ?? 0),
      visible: axis?.visible !== false,
      opacity: axis?.opacity === undefined ? undefined : clampFinite(axis.opacity, 0, 1, 1),
      spacing:
        axis?.spacing === undefined ? undefined : clampFinite(axis.spacing, 0.01, 100000, 24),
    })),
  };
  if (sanitized.axes.length < 2) {
    sanitized.axes = createStandardIsometricAxes();
  }
  if (grid.customAxes !== undefined) {
    const custom = (Array.isArray(grid.customAxes) ? grid.customAxes : [])
      .slice(0, 3)
      .map((axis) => ({
        ...axis,
        angle: normaliseAngle(axis?.angle ?? 0),
        visible: axis?.visible !== false,
      }));
    sanitized.customAxes = custom.length >= 2 ? custom : undefined;
  }
  return sanitized;
}

/**
 * Sanitize a grid definition by clamping values to valid ranges.
 */
export function sanitizeGrid(grid: GridDefinition): GridDefinition {
  const sanitized = { ...grid };

  // Clamp opacity
  sanitized.opacity = clampFinite(sanitized.opacity, 0, 1, 0.4);

  // Type-specific sanitization
  if (sanitized.type === 'document') {
    sanitized.spacingX = clampFinite(sanitized.spacingX, 1, 10000, 8);
    sanitized.spacingY = clampFinite(sanitized.spacingY, 1, 10000, 8);
    sanitized.subdivisions = clampFinite(sanitized.subdivisions, 1, 100, 4);
    sanitized.offsetX = clampFinite(sanitized.offsetX, -10000, 10000, 0);
    sanitized.offsetY = clampFinite(sanitized.offsetY, -10000, 10000, 0);
  } else if (sanitized.type === 'layout') {
    sanitized.gutter = clampFinite(sanitized.gutter, 0, 1000, 0);
    sanitized.margin = (Array.isArray(sanitized.margin) ? sanitized.margin : [0, 0, 0, 0]).map(
      (m) => clampFinite(m, 0, 1000, 0),
    ) as [number, number, number, number];
    if (sanitized.columnCount !== undefined) {
      sanitized.columnCount = Math.round(clampFinite(sanitized.columnCount, 1, 100, 1));
    }
    if (sanitized.rowCount !== undefined) {
      sanitized.rowCount = Math.round(clampFinite(sanitized.rowCount, 1, 100, 1));
    }
    if (sanitized.columnWidth !== undefined) {
      sanitized.columnWidth = clampFinite(sanitized.columnWidth, 1, 100000, 1);
    }
    if (sanitized.rowHeight !== undefined) {
      sanitized.rowHeight = clampFinite(sanitized.rowHeight, 1, 100000, 1);
    }
  } else if (sanitized.type === 'baseline') {
    sanitized.baselineStep = clampFinite(sanitized.baselineStep, 1, 10000, 24);
    sanitized.offset = clampFinite(sanitized.offset, -10000, 10000, 0);
  } else if (sanitized.type === 'pixel') {
    sanitized.zoomThreshold = clampFinite(sanitized.zoomThreshold, 1, 100, 4);
  } else if (sanitized.type === 'isometric') {
    return sanitizeIsometricGrid(sanitized);
  }

  return sanitized;
}
