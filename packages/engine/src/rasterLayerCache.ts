/**
 * Persistent per-layer backing surface with dirty-tile-only replay.
 *
 * Measured trigger (see `docs/perf/raster-tiling-decision.md`, 2026-08-03):
 * full-layer reconstruction composites *every* tile on *every* replay, costing
 * a p95 of 58.67 ms at 2048² and 252.84 ms at 4096² against a 16.7 ms frame
 * budget, and allocating a 16–256 MiB intermediate each time. Tile replay is
 * 94–99.8% of that cost, so re-uploading only the tiles whose version changed
 * removes work proportional to the tiles skipped — the dominant term.
 *
 * Correctness contract. This changes *when* pixels are written into the
 * intermediate, never *what* is written or how the intermediate is drawn:
 *
 *  - Tile pixels are written with `putImageData`, which ignores transform,
 *    clip, globalAlpha and globalCompositeOperation. Writing a subset is
 *    therefore pixel-identical to writing all of them, because each tile
 *    write is independent and order-insensitive — they never overlap.
 *  - The composite step is unchanged: the whole surface is still handed to
 *    `drawImage` exactly as before, so transform, rotation, scale, fractional
 *    translation, opacity, blend mode, masks, clips and filters all continue
 *    to apply to the finished surface rather than per tile. No seams can be
 *    introduced, because no per-tile drawing happens at composite time.
 *  - A cache miss, a size change, or any doubt falls back to a full rebuild.
 *
 * Memory is bounded: surfaces are byte-budgeted and evicted least-recently-used
 * first, so the cache cannot trade the allocation spike it removes for
 * unbounded residency.
 */

export interface RasterLayerSurface {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: CanvasRenderingContext2D & OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  /** Version of each tile currently resident in the surface, keyed `col:row`. */
  tileVersions: Map<string, number>;
  bytes: number;
  lastUsedAt: number;
}

export interface TileUploadPlan {
  /** Tiles whose resident version differs from the requested one. */
  changed: string[];
  /** Tiles resident in the surface but absent from the request. */
  removed: string[];
  /** True when the surface must be rebuilt from scratch. */
  fullRebuild: boolean;
}

/**
 * Decide which tiles need re-uploading. A dimension change or an absent
 * surface forces a full rebuild; otherwise only version mismatches and
 * removals are touched.
 */
export function planTileUploads(
  surface: RasterLayerSurface | null,
  width: number,
  height: number,
  tiles: Readonly<Record<string, { pixels: number[]; version: number }>>,
): TileUploadPlan {
  const requested = Object.keys(tiles);
  if (!surface || surface.width !== width || surface.height !== height) {
    return { changed: requested, removed: [], fullRebuild: true };
  }
  const changed: string[] = [];
  for (const key of requested) {
    const resident = surface.tileVersions.get(key);
    // `undefined` covers a newly added tile; a differing version covers an
    // edited one. Both need the pixels re-uploaded.
    if (resident === undefined || resident !== tiles[key]!.version) changed.push(key);
  }
  const removed: string[] = [];
  for (const key of surface.tileVersions.keys()) {
    if (!(key in tiles)) removed.push(key);
  }
  return { changed, removed, fullRebuild: false };
}

function createSurfaceCanvas(
  width: number,
  height: number,
): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: RasterLayerSurface['ctx'] } | null {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null;
  if (!canvas) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as RasterLayerSurface['ctx'] | null;
  if (!ctx) return null;
  return { canvas, ctx };
}

/** Default budget: two 4096² surfaces, well under the 128 MiB bitmap budget. */
export const DEFAULT_LAYER_SURFACE_BUDGET_BYTES = 128 * 1024 * 1024;

/**
 * Process-wide cache used by the replay path. A module-level singleton because
 * replay is a free function called from both the main thread and the render
 * worker, each of which is its own JS realm and so gets its own instance.
 */
let sharedCache: RasterLayerCache | null = null;

export function getRasterLayerCache(): RasterLayerCache {
  sharedCache ??= new RasterLayerCache();
  return sharedCache;
}

/** Drop every retained surface — document close, context loss, teardown. */
export function resetRasterLayerCache(): void {
  sharedCache?.clear();
}

export class RasterLayerCache {
  private readonly surfaces = new Map<string, RasterLayerSurface>();
  private budgetBytes: number;
  private clock = 0;
  private hits = 0;
  private misses = 0;
  private tilesUploaded = 0;
  private tilesSkipped = 0;

  constructor(budgetBytes = DEFAULT_LAYER_SURFACE_BUDGET_BYTES) {
    this.budgetBytes = budgetBytes;
  }

  get residentBytes(): number {
    let total = 0;
    for (const surface of this.surfaces.values()) total += surface.bytes;
    return total;
  }

  get diagnostics() {
    return {
      surfaces: this.surfaces.size,
      residentBytes: this.residentBytes,
      budgetBytes: this.budgetBytes,
      hits: this.hits,
      misses: this.misses,
      tilesUploaded: this.tilesUploaded,
      tilesSkipped: this.tilesSkipped,
    };
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(0, bytes);
    this.evictToBudget();
  }

  /**
   * Return a surface holding the layer's current pixels, uploading only the
   * tiles whose version changed. Returns null when no canvas backend exists,
   * so the caller can fall back to the original path.
   */
  acquire(
    layerKey: string,
    width: number,
    height: number,
    tiles: Readonly<Record<string, { pixels: number[]; version: number }>>,
    tileSize: number,
  ): { surface: RasterLayerSurface; plan: TileUploadPlan } | null {
    let surface = this.surfaces.get(layerKey) ?? null;
    const plan = planTileUploads(surface, width, height, tiles);

    if (plan.fullRebuild) {
      const created = createSurfaceCanvas(width, height);
      if (!created) return null;
      if (surface) this.surfaces.delete(layerKey);
      surface = {
        canvas: created.canvas,
        ctx: created.ctx,
        width,
        height,
        tileVersions: new Map(),
        bytes: width * height * 4,
        lastUsedAt: ++this.clock,
      };
      this.surfaces.set(layerKey, surface);
      this.misses++;
    } else {
      this.hits++;
    }

    const live = surface!;
    live.lastUsedAt = ++this.clock;

    // A removed tile must be cleared, otherwise its stale pixels persist in
    // the retained surface — the one correctness hazard a persistent surface
    // introduces that a per-frame rebuild cannot have.
    for (const key of plan.removed) {
      const [col, row] = key.split(':').map(Number);
      if (Number.isFinite(col) && Number.isFinite(row)) {
        live.ctx.clearRect(col! * tileSize, row! * tileSize, tileSize, tileSize);
      }
      live.tileVersions.delete(key);
    }

    for (const key of plan.changed) {
      const tile = tiles[key];
      if (!tile) continue;
      const [colStr, rowStr] = key.split(':');
      const col = Number(colStr);
      const row = Number(rowStr);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const imageData = live.ctx.createImageData(tileSize, tileSize);
      imageData.data.set(new Uint8ClampedArray(tile.pixels));
      live.ctx.putImageData(imageData, col * tileSize, row * tileSize);
      live.tileVersions.set(key, tile.version);
      this.tilesUploaded++;
    }
    this.tilesSkipped += Object.keys(tiles).length - plan.changed.length;

    this.evictToBudget(layerKey);
    return { surface: live, plan };
  }

  /** Drop a layer's surface (layer deleted, document closed). */
  release(layerKey: string): void {
    this.surfaces.delete(layerKey);
  }

  clear(): void {
    this.surfaces.clear();
  }

  /** Evict least-recently-used surfaces until the budget is respected. */
  private evictToBudget(protectedKey?: string): void {
    if (this.budgetBytes <= 0) {
      this.surfaces.clear();
      return;
    }
    while (this.residentBytes > this.budgetBytes) {
      let oldestKey: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [key, surface] of this.surfaces) {
        if (key === protectedKey) continue;
        if (surface.lastUsedAt < oldestAt) {
          oldestAt = surface.lastUsedAt;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      this.surfaces.delete(oldestKey);
    }
  }
}
