/**
 * Non-destructive warp system — public surface.
 *
 * Geometry core owned here (types, validation, deterministic evaluation,
 * bounds, foldover analysis, text warp, deterministic proposals/presets).
 * Scene integration (node field, ops, migrations) lives in @varve/scene.
 */

export * from './fit';
export * from './geometry';
export * from './plan';
export * from './text';
export * from './types';
