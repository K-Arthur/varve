/**
 * Wet-paint lifecycle.
 *
 * `WetBuffer` provided the mixing maths but nothing owned it: no allocation
 * policy, no drying schedule, no release on layer death. This manager is that
 * missing runtime.
 *
 * Three properties drive the design:
 *
 * 1. **Sparse.** Wetness lives in small tiles allocated only where paint has
 *    actually landed, and a tile is freed the moment it dries. Drying a 4K
 *    layer where 2% is wet must not walk 8 million pixels every tick.
 * 2. **Self-terminating.** The manager reports whether anything is still wet.
 *    A dry document schedules no work at all — there is no permanent animation
 *    loop, so an idle Varve costs nothing.
 * 3. **Runtime-only.** Wet state is never serialised. Deposited colour is
 *    already committed to the layer, so drying changes no canonical pixels and
 *    therefore creates no history entries — undo can never depend on how many
 *    milliseconds passed since the stroke.
 */

/** Wet tiles are much smaller than raster tiles: wetness is a local effect. */
export const WET_TILE_SIZE = 64;

/**
 * Longest gap that is simulated as elapsed time. Beyond this the app was
 * suspended, backgrounded or asleep, and the honest answer is that the paint
 * dried while nobody was looking — accumulating the real elapsed time would
 * make a single tick jump the simulation by minutes.
 */
export const WET_MAX_GAP_SECONDS = 5;

/** Per-tick dt ceiling, so one dropped frame cannot lurch the simulation. */
export const WET_MAX_STEP_SECONDS = 0.25;

/** Below this, a pixel is considered dry and its storage may be reclaimed. */
const DRY_EPSILON = 1 / 512;

export interface WetTile {
  col: number;
  row: number;
  /** Straight RGBA 0-255 of the wet film. */
  pixels: Uint8ClampedArray;
  wetness: Float32Array;
  /** Number of pixels with wetness above the dry threshold. */
  wetCount: number;
}

export interface WetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayerWetState {
  layerId: string;
  tiles: Map<string, WetTile>;
  wetPixels: number;
}

export interface WetTickResult {
  /** Regions whose wetness changed and therefore need repainting. */
  dirty: WetRect[];
  /** Pixels still wet across every layer. Zero means: stop scheduling. */
  remainingWetPixels: number;
  /** True when this tick moved the simulation at all. */
  simulated: boolean;
}

function tileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export class WetPaintManager {
  private layers = new Map<string, LayerWetState>();
  private lastTickMs: number | null = null;

  /** Total wet pixels across all layers. Zero means nothing needs scheduling. */
  get wetPixelCount(): number {
    let total = 0;
    for (const layer of this.layers.values()) total += layer.wetPixels;
    return total;
  }

  /** True while any paint is still wet — the scheduler's only run condition. */
  get isActive(): boolean {
    return this.wetPixelCount > 0;
  }

  /** Bytes currently held by wet tiles, for memory reporting. */
  get allocatedBytes(): number {
    let bytes = 0;
    for (const layer of this.layers.values()) {
      // Uint8ClampedArray RGBA + Float32Array wetness per tile.
      bytes += layer.tiles.size * WET_TILE_SIZE * WET_TILE_SIZE * (4 + 4);
    }
    return bytes;
  }

  get layerCount(): number {
    return this.layers.size;
  }

  /** Wet tiles allocated for a layer, mainly for tests and diagnostics. */
  tileCount(layerId: string): number {
    return this.layers.get(layerId)?.tiles.size ?? 0;
  }

  wetnessAt(layerId: string, x: number, y: number): number {
    const layer = this.layers.get(layerId);
    if (!layer) return 0;
    const col = Math.floor(x / WET_TILE_SIZE);
    const row = Math.floor(y / WET_TILE_SIZE);
    const tile = layer.tiles.get(tileKey(col, row));
    if (!tile) return 0;
    const ox = x - col * WET_TILE_SIZE;
    const oy = y - row * WET_TILE_SIZE;
    return tile.wetness[oy * WET_TILE_SIZE + ox] ?? 0;
  }

  /** Wet film colour at a pixel, or null when dry. */
  colorAt(layerId: string, x: number, y: number): [number, number, number, number] | null {
    const layer = this.layers.get(layerId);
    if (!layer) return null;
    const col = Math.floor(x / WET_TILE_SIZE);
    const row = Math.floor(y / WET_TILE_SIZE);
    const tile = layer.tiles.get(tileKey(col, row));
    if (!tile) return null;
    const ox = x - col * WET_TILE_SIZE;
    const oy = y - row * WET_TILE_SIZE;
    if ((tile.wetness[oy * WET_TILE_SIZE + ox] ?? 0) <= DRY_EPSILON) return null;
    const i = (oy * WET_TILE_SIZE + ox) * 4;
    return [tile.pixels[i]!, tile.pixels[i + 1]!, tile.pixels[i + 2]!, tile.pixels[i + 3]!];
  }

  /**
   * Add wet paint at a pixel, mixing with whatever film is already there.
   * Returns the colour that should actually be deposited, which is the mix of
   * the new paint and the wet film it landed in.
   */
  addPaint(
    layerId: string,
    x: number,
    y: number,
    color: readonly [number, number, number, number],
    amount: number,
    mixStrength: number,
  ): [number, number, number, number] {
    const px = Math.floor(x);
    const py = Math.floor(y);
    const layer = this.layerFor(layerId);
    const col = Math.floor(px / WET_TILE_SIZE);
    const row = Math.floor(py / WET_TILE_SIZE);
    const key = tileKey(col, row);
    let tile = layer.tiles.get(key);
    if (!tile) {
      tile = {
        col,
        row,
        pixels: new Uint8ClampedArray(WET_TILE_SIZE * WET_TILE_SIZE * 4),
        wetness: new Float32Array(WET_TILE_SIZE * WET_TILE_SIZE),
        wetCount: 0,
      };
      layer.tiles.set(key, tile);
    }

    const ox = px - col * WET_TILE_SIZE;
    const oy = py - row * WET_TILE_SIZE;
    const wi = oy * WET_TILE_SIZE + ox;
    const pi = wi * 4;

    const existingWet = tile.wetness[wi]!;
    const mix = existingWet > 0 ? Math.min(existingWet, Math.max(0, Math.min(1, mixStrength))) : 0;
    const inv = 1 - mix;
    const r = color[0] * inv + tile.pixels[pi]! * mix;
    const g = color[1] * inv + tile.pixels[pi + 1]! * mix;
    const b = color[2] * inv + tile.pixels[pi + 2]! * mix;
    const a = color[3] * inv + tile.pixels[pi + 3]! * mix;

    tile.pixels[pi] = r;
    tile.pixels[pi + 1] = g;
    tile.pixels[pi + 2] = b;
    tile.pixels[pi + 3] = a;

    const nextWet = Math.min(1, existingWet + Math.max(0, amount));
    if (existingWet <= DRY_EPSILON && nextWet > DRY_EPSILON) {
      tile.wetCount++;
      layer.wetPixels++;
    }
    tile.wetness[wi] = nextWet;

    return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
  }

  /**
   * Advance drying to `nowMs`.
   *
   * The first tick after a period of inactivity establishes the clock rather
   * than simulating the gap, and a gap longer than WET_MAX_GAP_SECONDS dries
   * everything outright.
   */
  tick(nowMs: number, dryingRatePerSecond: number): WetTickResult {
    const previous = this.lastTickMs;
    this.lastTickMs = nowMs;
    if (previous === null) {
      return { dirty: [], remainingWetPixels: this.wetPixelCount, simulated: false };
    }

    const elapsed = Math.max(0, (nowMs - previous) / 1000);
    if (elapsed === 0) {
      return { dirty: [], remainingWetPixels: this.wetPixelCount, simulated: false };
    }
    if (elapsed > WET_MAX_GAP_SECONDS) {
      const dirty = this.dryEverything();
      return { dirty, remainingWetPixels: 0, simulated: true };
    }

    const dt = Math.min(elapsed, WET_MAX_STEP_SECONDS);
    const decay = dt * Math.max(0, dryingRatePerSecond);
    if (decay <= 0) {
      return { dirty: [], remainingWetPixels: this.wetPixelCount, simulated: false };
    }

    const dirty: WetRect[] = [];
    for (const layer of this.layers.values()) {
      for (const [key, tile] of [...layer.tiles]) {
        if (tile.wetCount === 0) {
          layer.tiles.delete(key);
          continue;
        }
        const before = tile.wetCount;
        this.dryTile(tile, decay);
        layer.wetPixels -= before - tile.wetCount;
        dirty.push({
          x: tile.col * WET_TILE_SIZE,
          y: tile.row * WET_TILE_SIZE,
          w: WET_TILE_SIZE,
          h: WET_TILE_SIZE,
        });
        // Reclaim the tile as soon as it is dry: holding empty wet tiles for a
        // whole session is how this kind of buffer quietly costs hundreds of MB.
        if (tile.wetCount === 0) layer.tiles.delete(key);
      }
      if (layer.tiles.size === 0) this.layers.delete(layer.layerId);
    }

    return { dirty, remainingWetPixels: this.wetPixelCount, simulated: true };
  }

  /** Forget a layer's wet state — call when a layer is deleted or merged. */
  releaseLayer(layerId: string): void {
    this.layers.delete(layerId);
  }

  /** Forget everything — call on document close or switch. */
  releaseAll(): void {
    this.layers.clear();
    this.lastTickMs = null;
  }

  /**
   * Drop the clock without dropping wetness. Used when the app is
   * backgrounded, so the next tick measures from resume rather than
   * simulating the whole time away in a single step.
   */
  suspend(): void {
    this.lastTickMs = null;
  }

  private layerFor(layerId: string): LayerWetState {
    let layer = this.layers.get(layerId);
    if (!layer) {
      layer = { layerId, tiles: new Map(), wetPixels: 0 };
      this.layers.set(layerId, layer);
    }
    return layer;
  }

  private dryTile(tile: WetTile, decay: number): void {
    const { wetness, pixels } = tile;
    for (let i = 0; i < wetness.length; i++) {
      const w = wetness[i]!;
      if (w <= 0) continue;
      const next = w - decay;
      if (next <= DRY_EPSILON) {
        wetness[i] = 0;
        tile.wetCount--;
        const p = i * 4;
        pixels[p] = 0;
        pixels[p + 1] = 0;
        pixels[p + 2] = 0;
        pixels[p + 3] = 0;
      } else {
        wetness[i] = next;
      }
    }
    if (tile.wetCount < 0) tile.wetCount = 0;
  }

  private dryEverything(): WetRect[] {
    const dirty: WetRect[] = [];
    for (const layer of this.layers.values()) {
      for (const tile of layer.tiles.values()) {
        dirty.push({
          x: tile.col * WET_TILE_SIZE,
          y: tile.row * WET_TILE_SIZE,
          w: WET_TILE_SIZE,
          h: WET_TILE_SIZE,
        });
      }
    }
    this.layers.clear();
    return dirty;
  }
}
