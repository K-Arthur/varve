/**
 * Raster pyramid — renderer integration: strategy crossover, visible-tile
 * drawing with gutter tiles, and progressive fallback.
 *
 * This is the narrow seam into the replay hot path (ADR-0214 D5/D11). The
 * retained whole-layer surface stays the default; spatial tiles engage only
 * when the measured crossover says they are cheaper (large layer, low
 * effective scale, low viewport coverage). All decisions are exposed for
 * diagnostics; the module is disabled until explicitly enabled, and a draw
 * that finds nothing resident falls back to the caller's existing path.
 *
 * Effective scale is read from the live canvas transform (camera x DPR x
 * affine), so no IR schema change is required (brief §6).
 */

import { getRasterLayerCache } from '../rasterLayerCache';
import { maxPyramidLevel, PYRAMID_TILE_SIZE } from './pyramid';
import {
  currentGutterSnapshot,
  ensureGutterTile,
  type PyramidLayerSource,
  resolveGutterTile,
} from './pyramidCache';

export type { PyramidLayerSource };

import { DEFAULT_PYRAMID_BUDGET_BYTES, PyramidResidency } from './residency';
import { PYRAMID_PRIORITY_VIEWPORT, PyramidScheduler } from './scheduler';
import { PYRAMID_GUTTER_KEY_SUFFIX, PYRAMID_GUTTER_TEXELS, pyramidTileKey } from './tileKey';
import { type LevelPixelRect, visibleTilesAtLevel } from './tileQuery';

/**
 * Structural slice of the canvas context the tile draw needs. Declared
 * locally (not imported from replay.ts) so the pyramid module never creates
 * a dependency cycle with the replay hot path.
 */
export interface LodDrawTarget {
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
  drawImage?(
    image: CanvasImageSource | string,
    a1: number,
    a2: number,
    a3?: number,
    a4?: number,
    a5?: number,
    a6?: number,
    a7?: number,
    a8?: number,
    a9?: number,
  ): void;
}

export const PYRAMID_DEFAULT_MIN_LAYER_BYTES = 8 * 1024 * 1024; // the existing trigger (brief §2)
export const PYRAMID_DEFAULT_MAX_SCALE = 1; // zoomed-out only
export const PYRAMID_DEFAULT_MAX_VISIBLE_RATIO = 0.5; // < half the layer visible

export interface PyramidCrossoverOptions {
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly enabled: boolean;
  readonly minLayerBytes?: number;
  readonly maxScale?: number;
  readonly maxVisibleRatio?: number;
}

export type PyramidStrategy =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'retained'; readonly reason: 'small-layer' | 'zoomed-in' | 'coverage' }
  | { readonly kind: 'pyramid'; readonly level: number };

/**
 * Crossover heuristic (brief §11): retained whole surface for small layers,
 * zoom >= 100%, or when the viewport covers most of the layer; spatial tiles
 * otherwise. Exposed in diagnostics; tuned by measurement, not dogma.
 */
export function decideRasterStrategy(options: PyramidCrossoverOptions): PyramidStrategy {
  if (!options.enabled) return { kind: 'disabled' };
  const minBytes = options.minLayerBytes ?? PYRAMID_DEFAULT_MIN_LAYER_BYTES;
  const maxScale = options.maxScale ?? PYRAMID_DEFAULT_MAX_SCALE;
  const maxRatio = options.maxVisibleRatio ?? PYRAMID_DEFAULT_MAX_VISIBLE_RATIO;
  const layerBytes = options.width * options.height * 4;
  if (layerBytes < minBytes) return { kind: 'retained', reason: 'small-layer' };
  if (options.scale >= maxScale) return { kind: 'retained', reason: 'zoomed-in' };
  const visibleW = Math.min(1, options.viewportWidth / options.scale / options.width);
  const visibleH = Math.min(1, options.viewportHeight / options.scale / options.height);
  const ratio = visibleW * visibleH;
  if (ratio > maxRatio) return { kind: 'retained', reason: 'coverage' };
  const scale = options.scale;
  const level = Math.max(
    0,
    Math.min(maxPyramidLevel(options.width, options.height), Math.round(-Math.log2(scale))),
  );
  return { kind: 'pyramid', level };
}

/**
 * Effective device-space scale from the live canvas transform: the largest
 * singular value of the affine (worst-case axis scale, conservative under
 * rotation/skew — never undersamples; brief §6, §29).
 */
export function effectiveScaleFromTransform(m: {
  a: number;
  b: number;
  c: number;
  d: number;
}): number {
  const t = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
  const det = m.a * m.d - m.b * m.c;
  const disc = Math.sqrt(Math.max(0, t * t - 4 * det * det));
  return Math.sqrt((t + disc) / 2);
}

export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Layer-local rect covered by the viewport: invert the world->device affine
 * and take the AABB of the four viewport corners. Over-inclusive under
 * rotation/skew, which is acceptable (brief §9, §24).
 */
export function layerVisibleRect(
  m: Affine,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number; width: number; height: number } {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  const ie = (m.c * m.f - m.d * m.e) / det;
  const if_ = (m.b * m.e - m.a * m.f) / det;
  const corners = [
    [0, 0],
    [viewportWidth, 0],
    [0, viewportHeight],
    [viewportWidth, viewportHeight],
  ] as const;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [sx, sy] of corners) {
    const wx = ia * sx + ib * sy + ie;
    const wy = ic * sx + id * sy + if_;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Viewport rect in level-local pixels (layer px divided by 2^level). */
export function levelLocalRect(
  rect: { x: number; y: number; width: number; height: number },
  level: number,
): LevelPixelRect {
  const f = 2 ** level;
  return { x: rect.x / f, y: rect.y / f, width: rect.width / f, height: rect.height / f };
}

/** Pad a tile with a ring of edge-replicated texels (pure; used by the canvas cache). */
export function padTilePixels(
  pixels: Uint8ClampedArray,
  tileSize: number,
  gutter: number,
): Uint8ClampedArray {
  const size = tileSize + gutter * 2;
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    const sy = Math.max(0, Math.min(tileSize - 1, y - gutter));
    for (let x = 0; x < size; x++) {
      const sx = Math.max(0, Math.min(tileSize - 1, x - gutter));
      const si = (sy * tileSize + sx) * 4;
      const di = (y * size + x) * 4;
      out[di] = pixels[si] ?? 0;
      out[di + 1] = pixels[si + 1] ?? 0;
      out[di + 2] = pixels[si + 2] ?? 0;
      out[di + 3] = pixels[si + 3] ?? 0;
    }
  }
  return out;
}

/**
 * Small LRU canvas cache for padded gutter tiles. Reuses one canvas per
 * tile across frames; byte-budgeted like every other raster cache.
 */
export class GutterCanvasCache {
  private readonly canvases = new Map<
    string,
    { canvas: HTMLCanvasElement | OffscreenCanvas; bytes: number; lastUsed: number }
  >();
  private clock = 0;
  budgetBytes: number;

  constructor(budgetBytes = 8 * 1024 * 1024) {
    this.budgetBytes = budgetBytes;
  }

  get(
    key: string,
    pixels: Uint8ClampedArray,
    tileSize: number,
    gutter: number,
  ): HTMLCanvasElement | OffscreenCanvas | null {
    const hit = this.canvases.get(key);
    if (hit) {
      hit.lastUsed = ++this.clock;
      return hit.canvas;
    }
    const size = tileSize + gutter * 2;
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(size, size)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;
    if (!canvas) return null;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d') as
      | (CanvasRenderingContext2D & OffscreenCanvasRenderingContext2D)
      | null;
    if (!ctx) return null;
    const padded = padTilePixels(pixels, tileSize, gutter);
    const imageData = ctx.createImageData(size, size);
    imageData.data.set(padded);
    ctx.putImageData(imageData, 0, 0);
    const bytes = size * size * 4;
    this.canvases.set(key, { canvas, bytes, lastUsed: ++this.clock });
    this.evictToBudget();
    return canvas;
  }

  release(key: string): void {
    this.canvases.delete(key);
  }

  clear(): void {
    this.canvases.clear();
  }

  get residentBytes(): number {
    let bytes = 0;
    for (const e of this.canvases.values()) bytes += e.bytes;
    return bytes;
  }

  private evictToBudget(): void {
    while (this.residentBytes > this.budgetBytes) {
      let oldest: { key: string; lastUsed: number } | null = null;
      for (const [key, e] of this.canvases) {
        if (!oldest || e.lastUsed < oldest.lastUsed) oldest = { key, lastUsed: e.lastUsed };
      }
      if (!oldest) break;
      this.canvases.delete(oldest.key);
    }
  }
}

export interface RasterLodDrawOptions {
  readonly gutter?: number;
  readonly tileSize?: number;
  readonly schedule?: (source: PyramidLayerSource, level: number, col: number, row: number) => void;
  readonly canvasCache?: GutterCanvasCache;
  readonly maxFallbackLevels?: number;
}

export interface RasterLodDrawResult {
  readonly drawnTiles: number;
  readonly missingTiles: number;
  readonly level: number;
  readonly fallbackLevel: number;
}

/**
 * Draw the visible region of a raster layer from resident pyramid tiles.
 * Falls back to coarser resident ancestors when the ideal level is not
 * ready (brief §30) and reports missing tiles for the scheduler. Tiles are
 * drawn with 1-texel gutters under a layer-bounds clip — no seams, no
 * pixels painted outside the layer. Returns {drawnTiles: 0} when nothing is
 * resident, letting the caller keep its existing path.
 */
export function drawRasterLayerLod(
  target: LodDrawTarget,
  source: PyramidLayerSource,
  store: PyramidResidency,
  idealLevel: number,
  viewportRect: { x: number; y: number; width: number; height: number },
  options: RasterLodDrawOptions = {},
): RasterLodDrawResult {
  const gutter = options.gutter ?? PYRAMID_GUTTER_TEXELS;
  const tileSize = options.tileSize ?? PYRAMID_TILE_SIZE;
  const schedule = options.schedule ?? schedulePyramidTile;
  const canvasCache = options.canvasCache ?? new GutterCanvasCache();
  const maxFallback = options.maxFallbackLevels ?? 3;

  if (!target.drawImage || !target.getTransform)
    return { drawnTiles: 0, missingTiles: 0, level: idealLevel, fallbackLevel: -1 };

  // Clip to the layer bounds so gutters never paint outside the layer.
  target.save();
  target.beginPath();
  target.rect(0, 0, source.width, source.height);
  target.clip();

  let drawn = 0;
  let missing = 0;
  let fallbackLevel = idealLevel;
  const layerDims = { width: source.width, height: source.height };

  // Progressive refinement: walk from the ideal level toward coarser levels
  // until at least one tile is available (brief §30).
  for (let attempt = 0; attempt <= maxFallback; attempt++) {
    const level = idealLevel - attempt;
    if (level < 0) break;
    fallbackLevel = level;
    const rect = levelLocalRect(viewportRect, level);
    const visible = visibleTilesAtLevel(level, rect, layerDims, tileSize);
    if (visible.tiles.length === 0) continue;
    const f = 2 ** level;
    let levelDrawn = 0;
    let levelMissing = 0;
    for (const coord of visible.tiles) {
      const entry = resolveGutterTile(source, level, coord.col, coord.row, store);
      if (!entry) {
        levelMissing++;
        if (attempt === 0) {
          schedule?.(source, level, coord.col, coord.row);
        }
        continue;
      }
      const canvas = canvasCache.get(entry.key, entry.pixels, tileSize, gutter);
      if (!canvas) {
        levelMissing++;
        continue;
      }
      const ox = coord.col * tileSize * f - gutter * f;
      const oy = coord.row * tileSize * f - gutter * f;
      const span = (tileSize + gutter * 2) * f;
      target.drawImage(
        canvas,
        0,
        0,
        tileSize + gutter * 2,
        tileSize + gutter * 2,
        ox,
        oy,
        span,
        span,
      );
      levelDrawn++;
    }
    drawn += levelDrawn;
    if (levelDrawn > 0) {
      missing = levelMissing;
      break;
    }
    missing = levelMissing;
  }

  target.restore();
  return { drawnTiles: drawn, missingTiles: missing, level: idealLevel, fallbackLevel };
}

/** Module-level residency for the replay seam (per realm, like RasterLayerCache). */
let residency: PyramidResidency | null = null;
export function getPyramidResidency(): PyramidResidency {
  if (!residency) residency = new PyramidResidency({ budgetBytes: DEFAULT_PYRAMID_BUDGET_BYTES });
  return residency;
}
export function resetPyramidResidency(): void {
  residency = null;
}

/** Opt-in flag: the spatial path engages only when enabled (default off). */
let pyramidEnabled = false;
export function setRasterPyramidEnabled(enabled: boolean): void {
  pyramidEnabled = enabled;
}
export function isRasterPyramidEnabled(): boolean {
  return pyramidEnabled;
}

/**
 * Forward the retained whole-layer surface budget (finding F2): under a
 * constrained pressure profile the editor shrinks the RasterLayerCache
 * alongside the pyramid so two full 4096^2 surfaces cannot sit resident
 * next to a shrunk pyramid. Kept in this subpath so the shared engine
 * index stays untouched.
 */
export function setRetainedSurfaceBudget(bytes: number): void {
  getRasterLayerCache().setBudget(Math.max(0, bytes));
}

/** Viewport size for visible-tile selection (updated by the editor adapter on resize). */
let viewport = { width: 1920, height: 1080 };
export function setPyramidViewport(width: number, height: number): void {
  viewport = { width: Math.max(0, width), height: Math.max(0, height) };
}
export function getPyramidViewport(): { width: number; height: number } {
  return viewport;
}

/** Source registry: the scheduler resolves the freshest source per layer at run time. */
const sources = new Map<string, PyramidLayerSource>();
export function registerPyramidSource(source: PyramidLayerSource): void {
  sources.set(source.layerId, source);
}
export function unregisterPyramidSource(layerId: string): void {
  sources.delete(layerId);
}

/**
 * Default generation scheduler: bounded, latest-wins, async (never blocks a
 * frame). The run closure resolves the current source and commits only if
 * still current (ADR-0214 D4). The editor adapter may replace this with the
 * background-lane integration later.
 */
let scheduler: PyramidScheduler<undefined> | null = null;
export function getPyramidScheduler(): PyramidScheduler<undefined> {
  if (!scheduler) {
    scheduler = new PyramidScheduler<undefined>({
      maxConcurrency: 1,
      maxQueued: 256,
      run: (job) => {
        const source = sources.get(job.layerId);
        if (!source) return;
        return Promise.resolve().then(() => {
          ensureGutterTile(source, job.level, job.col, job.row, getPyramidResidency());
        });
      },
    });
  }
  return scheduler;
}

/** Enqueue gutter generation for a visible tile (default schedule callback). */
export function schedulePyramidTile(
  source: PyramidLayerSource,
  level: number,
  col: number,
  row: number,
): void {
  const key =
    pyramidTileKey({
      layerId: source.layerId,
      level,
      col,
      row,
      pixelMode: source.pixelMode,
      resamplerVersion: 1,
    }) + PYRAMID_GUTTER_KEY_SUFFIX;
  getPyramidScheduler().enqueue({
    id: `${key}:${currentGutterSnapshot(source, level, col, row)}`,
    key,
    revision: currentGutterSnapshot(source, level, col, row),
    priority: PYRAMID_PRIORITY_VIEWPORT,
    layerId: source.layerId,
    level,
    col,
    row,
    payload: undefined,
  });
}
