/**
 * Canonical Clone Stamp and Healing Brush compositing.
 *
 * These run through the same tile mutation, coverage clipping and alpha-lock
 * rules as the ordinary brush, so cloning and healing produce real document
 * pixels that survive redraw, undo, save and export — rather than pixels
 * painted onto the visible canvas that vanish on the next frame.
 *
 * Both operations sample from a *source snapshot* taken when the stroke began.
 * Sampling live target tiles instead would let a stroke feed on its own output,
 * which smears the clone along the drag direction and makes the result depend
 * on tile iteration order rather than on what the artist asked for.
 */

import type { BrushDab } from './brush';
import { type CoverageMask, sampleCoverage } from './paintCoverage';
import { createBrushDabMask, makeTileKey, TILE_SIZE, tilesForBounds } from './rasterLayer';
import type { RasterLayerNode, RasterTile } from './types';

export interface RetouchOptions {
  /** Tiles to sample from — normally a snapshot taken at stroke start. */
  sourceTiles: Map<string, RasterTile>;
  /** Source position for a target pixel is (x - offsetX, y - offsetY). */
  offsetX: number;
  offsetY: number;
  /** Selection / clip coverage in layer pixel space. */
  coverage?: CoverageMask | null;
  /** Constrain new coverage by destination alpha and preserve it. */
  alphaLock?: boolean;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Nearest-neighbour tile sample. Returns null outside any populated tile. */
export function sampleTiles(
  tiles: Map<string, RasterTile>,
  x: number,
  y: number,
): Rgba | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const col = Math.floor(px / TILE_SIZE);
  const row = Math.floor(py / TILE_SIZE);
  const tile = tiles.get(makeTileKey(col, row));
  if (!tile) return null;
  const ox = px - col * TILE_SIZE;
  const oy = py - row * TILE_SIZE;
  if (ox < 0 || ox >= TILE_SIZE || oy < 0 || oy >= TILE_SIZE) return null;
  const i = (oy * TILE_SIZE + ox) * 4;
  return {
    r: tile.pixels[i]!,
    g: tile.pixels[i + 1]!,
    b: tile.pixels[i + 2]!,
    a: tile.pixels[i + 3]!,
  };
}

/** Snapshot the tiles of a layer so a stroke samples a stable image. */
export function snapshotTiles(node: RasterLayerNode): Map<string, RasterTile> {
  const copy = new Map<string, RasterTile>();
  for (const [key, tile] of node.tiles) {
    copy.set(key, { pixels: new Uint8ClampedArray(tile.pixels), version: tile.version });
  }
  return copy;
}

type PixelTransform = (source: Rgba) => Rgba;

/**
 * Shared body for clone and heal: walk the dab, sample the source at the
 * stroke's offset, optionally recolour it, and blend it in under the brush
 * mask, selection coverage and alpha lock.
 */
function compositeRetouchDab(
  node: RasterLayerNode,
  dab: BrushDab,
  options: RetouchOptions,
  transform: PixelTransform,
): RasterLayerNode {
  const { sourceTiles, offsetX, offsetY } = options;
  const coverage = options.coverage ?? null;
  const alphaLock = options.alphaLock ?? false;

  const mask = createBrushDabMask(dab);
  const size = Math.ceil(dab.radius * 2);
  const diameter = size;
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    diameter,
    diameter,
  );
  const newTiles = new Map(node.tiles);

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    const tile = newTiles.get(key);
    // Nothing to constrain paint to, and nothing to sample onto.
    if (!tile && alphaLock) continue;
    const pixels = tile
      ? new Uint8ClampedArray(tile.pixels)
      : new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);

    const tileOriginX = col * TILE_SIZE;
    const tileOriginY = row * TILE_SIZE;
    const startX = Math.round(dab.x - tileOriginX - dab.radius);
    const startY = Math.round(dab.y - tileOriginY - dab.radius);
    let wrote = false;

    for (let my = 0; my < size; my++) {
      const py = startY + my;
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let mx = 0; mx < size; mx++) {
        const px = startX + mx;
        if (px < 0 || px >= TILE_SIZE) continue;
        const maskValue = mask[my * size + mx]!;
        if (maskValue <= 0) continue;

        const layerX = tileOriginX + px;
        const layerY = tileOriginY + py;
        const selection = coverage ? sampleCoverage(coverage, layerX, layerY) : 1;
        if (selection <= 0) continue;

        const sampled = sampleTiles(sourceTiles, layerX - offsetX, layerY - offsetY);
        if (!sampled || sampled.a === 0) continue;

        const idx = (py * TILE_SIZE + px) * 4;
        const destAlphaByte = pixels[idx + 3]!;
        let strength = maskValue * dab.opacity * dab.flow * selection;
        if (alphaLock) {
          if (destAlphaByte === 0) continue;
          strength *= destAlphaByte / 255;
        }
        if (strength <= 0) continue;

        const src = transform(sampled);
        const inv = 1 - strength;
        pixels[idx] = clampByte(pixels[idx]! * inv + src.r * strength);
        pixels[idx + 1] = clampByte(pixels[idx + 1]! * inv + src.g * strength);
        pixels[idx + 2] = clampByte(pixels[idx + 2]! * inv + src.b * strength);
        pixels[idx + 3] = alphaLock
          ? destAlphaByte
          : clampByte(destAlphaByte * inv + src.a * strength);
        wrote = true;
      }
    }

    if (!tile && !wrote) continue;
    newTiles.set(key, { pixels, version: (tile?.version ?? 0) + 1 });
  }

  return { ...node, tiles: newTiles };
}

/** Clone Stamp: copy source pixels verbatim. */
export function compositeCloneDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  options: RetouchOptions,
): RasterLayerNode {
  return compositeRetouchDab(node, dab, options, (s) => s);
}

/**
 * Healing Brush: take *texture* from the source but *colour* from the
 * destination.
 *
 * The mean colour of the source under the dab is shifted to the mean colour of
 * the destination under the same dab, which is what makes a heal blend into
 * its surroundings where a clone would leave a visible patch. This is a
 * first-order approximation of the gradient-domain solve real healing uses —
 * cheap enough to run per dab, and correct in the case that matters (source
 * and destination differ mainly in low-frequency illumination).
 */
export function compositeHealDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  options: RetouchOptions,
): RasterLayerNode {
  const shift = meanColorShift(node, dab, options);
  return compositeRetouchDab(node, dab, options, (s) => ({
    r: s.r + shift.r,
    g: s.g + shift.g,
    b: s.b + shift.b,
    a: s.a,
  }));
}

/** Mean destination-minus-source colour over the dab footprint. */
function meanColorShift(
  node: RasterLayerNode,
  dab: BrushDab,
  options: RetouchOptions,
): { r: number; g: number; b: number } {
  const { sourceTiles, offsetX, offsetY } = options;
  const radius = dab.radius;
  // Sample on a coarse lattice: the shift is a low-frequency quantity, so
  // reading every pixel would cost far more than it improves the estimate.
  const step = Math.max(1, Math.floor(radius / 4));
  let n = 0;
  let dr = 0;
  let dg = 0;
  let db = 0;

  for (let y = -radius; y <= radius; y += step) {
    for (let x = -radius; x <= radius; x += step) {
      if (x * x + y * y > radius * radius) continue;
      const lx = Math.round(dab.x + x);
      const ly = Math.round(dab.y + y);
      const dest = sampleTiles(node.tiles, lx, ly);
      const src = sampleTiles(sourceTiles, lx - offsetX, ly - offsetY);
      if (!dest || !src || dest.a === 0 || src.a === 0) continue;
      dr += dest.r - src.r;
      dg += dest.g - src.g;
      db += dest.b - src.b;
      n++;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: dr / n, g: dg / n, b: db / n };
}

function clampByte(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}
