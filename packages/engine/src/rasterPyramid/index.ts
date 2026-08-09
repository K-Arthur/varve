/**
 * Multi-resolution tiled raster pyramid — derived display LOD over the
 * authoritative scene raster tiles (ADR-0214). Pure geometry, identity,
 * resampling, and LOD-selection helpers; no DOM, no cache, no React.
 */

export * from './downsample';
export * from './lod';
export * from './pyramid';
export {
  commitIfCurrent,
  currentSnapshot,
  ensurePyramidTile,
  generatePyramidTile,
  type PyramidLayerSource,
  type PyramidSourceTileData,
  type PyramidTileResult,
  pyramidMaxLevel,
  resolveTile,
} from './pyramidCache';
export * from './residency';
export * from './scheduler';
export * from './tileKey';
export * from './tileQuery';
