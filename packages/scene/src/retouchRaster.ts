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
import {
  createBrushDabMask,
  makeTileKey,
  rasterBoundsForDab,
  sampleBrushMask,
  TILE_SIZE,
  tilesForDab,
} from './rasterLayer';
import type { RasterLayerNode, RasterTile } from './types';

export interface RetouchOptions {
  /**
   * Tiles to sample from — normally a snapshot taken at stroke start.
   *
   * For "sample all layers" this is a flattened composite of the visible stack
   * rather than the target's own tiles. Sampling the composite while
   * depositing onto the active layer only is what keeps the operation
   * non-destructive: the layers that contributed to the sample are never
   * written back to.
   */
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

export interface RasterRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpotHealSource {
  x: number;
  y: number;
  score: number;
}

export interface SpotHealOptions extends RetouchOptions {
  /** Maximum source-search distance in raster pixels. Defaults to 6 radii. */
  searchRadius?: number;
}

export interface PatchRegionOptions {
  /** Frozen source view captured before the source rectangle is selected. */
  sourceTiles: Map<string, RasterTile>;
  sourceRect: RasterRect;
  targetRect: RasterRect;
  /** Width of the edge feather in target pixels. */
  featherRadius?: number;
  /** Overall patch opacity before source-over compositing. */
  opacity?: number;
  coverage?: CoverageMask | null;
  alphaLock?: boolean;
}

/** Nearest-neighbour tile sample. Returns null outside any populated tile. */
export function sampleTiles(tiles: Map<string, RasterTile>, x: number, y: number): Rgba | null {
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

/**
 * Bilinear sampling in premultiplied space. Interpolating straight RGB and
 * alpha independently produces dark fringes around translucent source edges;
 * the four samples are premultiplied for interpolation and converted back to
 * straight RGBA only after the weighted alpha is known.
 */
export function sampleTilesBilinear(
  tiles: Map<string, RasterTile>,
  x: number,
  y: number,
): Rgba | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const samples = [
    { sample: sampleTiles(tiles, x0, y0), weight: (1 - fx) * (1 - fy) },
    { sample: sampleTiles(tiles, x0 + 1, y0), weight: fx * (1 - fy) },
    { sample: sampleTiles(tiles, x0, y0 + 1), weight: (1 - fx) * fy },
    { sample: sampleTiles(tiles, x0 + 1, y0 + 1), weight: fx * fy },
  ];
  let alpha = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let weightSum = 0;
  for (const { sample, weight } of samples) {
    if (!sample || weight <= 0) continue;
    const a = sample.a / 255;
    alpha += a * weight;
    r += sample.r * a * weight;
    g += sample.g * a * weight;
    b += sample.b * a * weight;
    weightSum += weight;
  }
  if (weightSum <= 0 || alpha <= 0) return null;
  const normalizedAlpha = Math.max(0, Math.min(1, alpha));
  return {
    r: r / alpha,
    g: g / alpha,
    b: b / alpha,
    a: normalizedAlpha * 255,
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
  const tileKeys = tilesForDab(dab);
  const newTiles = new Map(node.tiles);
  let changed = false;

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
    const localDabX = dab.x - tileOriginX;
    const localDabY = dab.y - tileOriginY;
    const {
      minX: startX,
      minY: startY,
      maxX: endX,
      maxY: endY,
    } = rasterBoundsForDab({
      x: localDabX,
      y: localDabY,
      radius: dab.radius,
    });
    let wrote = false;

    for (let py = startY; py < endY; py++) {
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let px = startX; px < endX; px++) {
        if (px < 0 || px >= TILE_SIZE) continue;
        const maskValue = sampleBrushMask(
          mask,
          size,
          px - (localDabX - dab.radius),
          py - (localDabY - dab.radius),
          dab,
        );
        if (maskValue <= 0) continue;

        const layerX = tileOriginX + px;
        const layerY = tileOriginY + py;
        const selection = coverage ? sampleCoverage(coverage, layerX, layerY) : 1;
        if (selection <= 0) continue;

        const sampled = sampleTilesBilinear(sourceTiles, layerX - offsetX, layerY - offsetY);
        if (!sampled || sampled.a === 0) continue;

        const idx = (py * TILE_SIZE + px) * 4;
        const src = transform(sampled);
        const coverageAmount = maskValue * dab.opacity * dab.flow * selection;
        const dest = {
          r: pixels[idx]!,
          g: pixels[idx + 1]!,
          b: pixels[idx + 2]!,
          a: pixels[idx + 3]!,
        };
        const blended = blendRetouchPixel(dest, src, coverageAmount, alphaLock);
        if (!blended) continue;
        if (
          blended.r === dest.r &&
          blended.g === dest.g &&
          blended.b === dest.b &&
          blended.a === dest.a
        ) {
          continue;
        }
        pixels[idx] = blended.r;
        pixels[idx + 1] = blended.g;
        pixels[idx + 2] = blended.b;
        pixels[idx + 3] = blended.a;
        wrote = true;
      }
    }

    if (!wrote) continue;
    changed = true;
    newTiles.set(key, { pixels, version: (tile?.version ?? 0) + 1 });
  }

  return changed ? { ...node, tiles: newTiles } : node;
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

/**
 * Choose a nearby source patch with a texture variance similar to the target
 * neighbourhood. This is deliberately a bounded proximity heuristic: it uses
 * existing evidence only and is not content-aware synthesis or generative
 * inpainting. A stable tie-breaker keeps the result deterministic.
 */
export function findSpotHealSource(
  tiles: Map<string, RasterTile>,
  targetX: number,
  targetY: number,
  radius: number,
  searchRadius = Math.max(12, radius * 6),
): SpotHealSource | null {
  const patchRadius = Math.max(1, Math.ceil(radius));
  const boundedSearch = Math.max(patchRadius * 2 + 1, Math.min(256, searchRadius));
  const targetStats = patchLuminanceVariance(tiles, targetX, targetY, patchRadius);
  if (!targetStats) return null;

  let best: SpotHealSource | null = null;
  const minX = Math.floor(targetX - boundedSearch);
  const maxX = Math.ceil(targetX + boundedSearch);
  const minY = Math.floor(targetY - boundedSearch);
  const maxY = Math.ceil(targetY + boundedSearch);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distance = Math.hypot(x - targetX, y - targetY);
      if (distance < patchRadius * 2 || distance > boundedSearch) continue;
      const stats = patchLuminanceVariance(tiles, x, y, patchRadius);
      if (!stats || stats.count < patchRadius * patchRadius) continue;
      const textureDifference = Math.abs(
        Math.log1p(stats.variance) - Math.log1p(targetStats.variance),
      );
      const score = textureDifference + distance / Math.max(1, boundedSearch * 100);
      if (
        best === null ||
        score < best.score - 1e-9 ||
        (Math.abs(score - best.score) <= 1e-9 && (y < best.y || (y === best.y && x < best.x)))
      ) {
        best = { x, y, score };
      }
    }
  }
  return best;
}

/**
 * Spot heal on a persistent raster layer. The target is sampled from the
 * immutable stroke-start snapshot, so the operation cannot feed on pixels it
 * has just written. The selected source is adapted with the same color-shift
 * healing rule as Healing Brush and deposited with the shared alpha equation.
 */
export function compositeSpotHealDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  options: SpotHealOptions,
): RasterLayerNode {
  const source = findSpotHealSource(
    options.sourceTiles,
    dab.x,
    dab.y,
    dab.radius,
    options.searchRadius,
  );
  if (!source) return node;
  return compositeHealDabOnNode(node, dab, {
    ...options,
    offsetX: dab.x - source.x,
    offsetY: dab.y - source.y,
  });
}

/**
 * Copy a frozen source rectangle into a target rectangle with a feathered
 * edge for a softer transition. Source and destination are separate
 * ownerships even when they belong to the same raster layer; all reads come
 * from `sourceTiles`.
 */
export function compositePatchRegionOnNode(
  node: RasterLayerNode,
  options: PatchRegionOptions,
): RasterLayerNode {
  const { sourceTiles, sourceRect, targetRect } = options;
  if (sourceRect.w <= 0 || sourceRect.h <= 0 || targetRect.w <= 0 || targetRect.h <= 0) {
    return node;
  }
  const startX = Math.floor(targetRect.x);
  const startY = Math.floor(targetRect.y);
  const endX = Math.ceil(targetRect.x + targetRect.w);
  const endY = Math.ceil(targetRect.y + targetRect.h);
  const feather = Math.max(
    1,
    Math.min(
      Math.min(targetRect.w, targetRect.h) / 6,
      options.featherRadius ?? Math.min(targetRect.w, targetRect.h) / 6,
    ),
  );
  const newTiles = new Map(node.tiles);
  let changed = false;

  for (let row = Math.floor(startY / TILE_SIZE); row <= Math.floor((endY - 1) / TILE_SIZE); row++) {
    for (
      let col = Math.floor(startX / TILE_SIZE);
      col <= Math.floor((endX - 1) / TILE_SIZE);
      col++
    ) {
      const key = makeTileKey(col, row);
      const existing = newTiles.get(key);
      const pixels = existing
        ? new Uint8ClampedArray(existing.pixels)
        : new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4);
      let tileChanged = false;
      const tileOriginX = col * TILE_SIZE;
      const tileOriginY = row * TILE_SIZE;

      for (let py = 0; py < TILE_SIZE; py++) {
        const y = tileOriginY + py;
        if (y < startY || y >= endY || y < 0 || y >= node.height) continue;
        for (let px = 0; px < TILE_SIZE; px++) {
          const x = tileOriginX + px;
          if (x < startX || x >= endX || x < 0 || x >= node.width) continue;
          const selection = options.coverage ? sampleCoverage(options.coverage, x, y) : 1;
          if (selection <= 0) continue;
          const u = (x + 0.5 - targetRect.x) / targetRect.w;
          const v = (y + 0.5 - targetRect.y) / targetRect.h;
          const source = sampleTilesBilinear(
            sourceTiles,
            sourceRect.x + u * sourceRect.w - 0.5,
            sourceRect.y + v * sourceRect.h - 0.5,
          );
          if (!source) continue;
          const edgeDistance = Math.min(
            x + 0.5 - targetRect.x,
            targetRect.x + targetRect.w - (x + 0.5),
            y + 0.5 - targetRect.y,
            targetRect.y + targetRect.h - (y + 0.5),
          );
          const edgeCoverage = Math.max(0, Math.min(1, edgeDistance / feather));
          const idx = (py * TILE_SIZE + px) * 4;
          const dest = {
            r: pixels[idx]!,
            g: pixels[idx + 1]!,
            b: pixels[idx + 2]!,
            a: pixels[idx + 3]!,
          };
          const blended = blendRetouchPixel(
            dest,
            source,
            edgeCoverage * selection * Math.max(0, Math.min(1, options.opacity ?? 1)),
            options.alphaLock ?? false,
          );
          if (!blended) continue;
          if (
            blended.r === dest.r &&
            blended.g === dest.g &&
            blended.b === dest.b &&
            blended.a === dest.a
          ) {
            continue;
          }
          pixels[idx] = blended.r;
          pixels[idx + 1] = blended.g;
          pixels[idx + 2] = blended.b;
          pixels[idx + 3] = blended.a;
          tileChanged = true;
          changed = true;
        }
      }
      if (tileChanged) {
        newTiles.set(key, { pixels, version: (existing?.version ?? 0) + 1 });
      }
    }
  }
  return changed ? { ...node, tiles: newTiles } : node;
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

function patchLuminanceVariance(
  tiles: Map<string, RasterTile>,
  centerX: number,
  centerY: number,
  radius: number,
): { variance: number; count: number } | null {
  let sum = 0;
  let sumSquared = 0;
  let count = 0;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const sample = sampleTiles(tiles, Math.round(centerX + x), Math.round(centerY + y));
      if (!sample || sample.a === 0) continue;
      const luminance = sample.r * 0.2126 + sample.g * 0.7152 + sample.b * 0.0722;
      sum += luminance;
      sumSquared += luminance * luminance;
      count++;
    }
  }
  if (count === 0) return null;
  const mean = sum / count;
  return { variance: Math.max(0, sumSquared / count - mean * mean), count };
}

/** Blend one source sample with a destination using one coverage application. */
function blendRetouchPixel(
  destination: Rgba,
  source: Rgba,
  coverage: number,
  alphaLock: boolean,
): Rgba | null {
  const amount = Math.max(0, Math.min(1, coverage));
  if (amount <= 0 || source.a <= 0) return null;
  if (alphaLock) {
    if (destination.a <= 0) return null;
    const sourceOpacity = (source.a / 255) * amount;
    return {
      r: clampByte(destination.r * (1 - sourceOpacity) + source.r * sourceOpacity),
      g: clampByte(destination.g * (1 - sourceOpacity) + source.g * sourceOpacity),
      b: clampByte(destination.b * (1 - sourceOpacity) + source.b * sourceOpacity),
      a: destination.a,
    };
  }

  // Source-over with a fractional brush coverage. RGB is kept premultiplied
  // for the calculation; alpha is bounded independently from extended RGB in
  // the future float-tile implementation.
  const sourceAlpha = (source.a / 255) * amount;
  const destinationAlpha = destination.a / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return null;
  return {
    r: clampByte(
      (source.r * sourceAlpha + destination.r * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
    ),
    g: clampByte(
      (source.g * sourceAlpha + destination.g * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
    ),
    b: clampByte(
      (source.b * sourceAlpha + destination.b * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
    ),
    a: clampByte(outputAlpha * 255),
  };
}

function clampByte(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}

/**
 * Flatten several layers' tiles into one sampling source, bottom-up.
 *
 * Used by "sample all layers" for clone, heal and smudge. The result is a
 * read-only snapshot: it is never written back, so sampling a composite cannot
 * destructively bake the stack into whichever layer happens to be active.
 */
export function flattenTilesForSampling(
  layers: ReadonlyArray<{ tiles: Map<string, RasterTile>; opacity?: number; visible?: boolean }>,
): Map<string, RasterTile> {
  const out = new Map<string, RasterTile>();
  for (const layer of layers) {
    if (layer.visible === false) continue;
    const opacity = layer.opacity ?? 1;
    if (opacity <= 0) continue;
    for (const [key, tile] of layer.tiles) {
      const existing = out.get(key);
      if (!existing) {
        // First contributor for this tile: copy so the source stays read-only.
        const pixels = new Uint8ClampedArray(tile.pixels);
        if (opacity < 1) {
          for (let i = 3; i < pixels.length; i += 4) pixels[i] = pixels[i]! * opacity;
        }
        out.set(key, { pixels, version: tile.version });
        continue;
      }
      compositeTileOver(existing.pixels, tile.pixels, opacity);
    }
  }
  return out;
}

/** Source-over a tile onto an accumulating one, both straight-alpha RGBA. */
function compositeTileOver(dest: Uint8ClampedArray, src: Uint8ClampedArray, opacity: number): void {
  for (let i = 0; i < dest.length; i += 4) {
    const srcA = (src[i + 3]! / 255) * opacity;
    if (srcA <= 0) continue;
    const destA = dest[i + 3]! / 255;
    const outA = srcA + destA * (1 - srcA);
    if (outA <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const s = (src[i + c]! / 255) * srcA;
      const d = (dest[i + c]! / 255) * destA;
      dest[i + c] = Math.round(((s + d * (1 - srcA)) / outA) * 255);
    }
    dest[i + 3] = Math.round(outA * 255);
  }
}
