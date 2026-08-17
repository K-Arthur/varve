import type { Affine } from '@varve/engine';
import type { BrushDab } from './brush';
import type { RasterLayerNode, RasterTile } from './types';

export type { BrushDab };

export const TILE_SIZE = 128;

export interface TileKey {
  col: number;
  row: number;
}

export function makeTileKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function parseTileKey(key: string): TileKey {
  const [col, row] = key.split(':').map(Number);
  return { col: col!, row: row! };
}

export function tileForPixel(x: number, y: number): TileKey {
  return {
    col: Math.floor(x / TILE_SIZE),
    row: Math.floor(y / TILE_SIZE),
  };
}

export function createEmptyTile(): RasterTile {
  return {
    pixels: new Uint8ClampedArray(TILE_SIZE * TILE_SIZE * 4),
    version: 1,
  };
}

export function makeRasterLayerNode(
  id: string,
  options: { width: number; height: number },
  opts: Partial<
    Pick<
      RasterLayerNode,
      'name' | 'visible' | 'locked' | 'opacity' | 'blendMode' | 'rotation' | 'order'
    >
  > = {},
): RasterLayerNode {
  return {
    id,
    kind: 'rasterLayer',
    name: opts.name ?? 'Raster Layer',
    order: opts.order ?? 'a0',
    visible: opts.visible ?? true,
    locked: opts.locked ?? false,
    opacity: opts.opacity ?? 1,
    blendMode: opts.blendMode ?? 'normal',
    rotation: opts.rotation ?? 0,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    width: Math.max(1, options.width),
    height: Math.max(1, options.height),
    pixelMode: false,
    tiles: new Map(),
    transform: [1, 0, 0, 1, 0, 0] as Affine,
  };
}

export function getTileAt(
  node: RasterLayerNode,
  x: number,
  y: number,
): { tile: RasterTile; key: string } | null {
  if (x < 0 || y < 0 || x >= node.width || y >= node.height) return null;
  const { col, row } = tileForPixel(x, y);
  const key = makeTileKey(col, row);
  const tile = node.tiles.get(key);
  if (!tile) return null;
  return { tile, key };
}

export function getOrCreateTile(
  node: RasterLayerNode,
  x: number,
  y: number,
): { tile: RasterTile; key: string } {
  if (x < 0 || y < 0 || x >= node.width || y >= node.height) {
    throw new Error(
      `Pixel (${x}, ${y}) is outside raster layer bounds (${node.width}x${node.height})`,
    );
  }
  const { col, row } = tileForPixel(x, y);
  const key = makeTileKey(col, row);
  let tile = node.tiles.get(key);
  if (!tile) {
    tile = createEmptyTile();
  }
  return { tile, key };
}

export function pixelOffsetInTile(x: number, y: number): { ox: number; oy: number } {
  return {
    ox: x % TILE_SIZE,
    oy: y % TILE_SIZE,
  };
}

export function tileBounds(
  col: number,
  row: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

export function tilesForBounds(x: number, y: number, w: number, h: number): TileKey[] {
  const start = tileForPixel(x, y);
  const end = tileForPixel(x + w - 1, y + h - 1);
  const keys: TileKey[] = [];
  for (let row = start.row; row <= end.row; row++) {
    for (let col = start.col; col <= end.col; col++) {
      keys.push({ col, row });
    }
  }
  return keys;
}

// ── Tile serialization ─────────────────────────────────────────────────────────

export interface SerializableTileData {
  pixels: string;
  version: number;
}

export type SerializableTiles = Record<string, SerializableTileData>;

function arrayBufferToBase64(buffer: ArrayBuffer | SharedArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

export function serializeTiles(tiles: Map<string, RasterTile>): SerializableTiles {
  const result: SerializableTiles = {};
  for (const [key, tile] of tiles) {
    result[key] = {
      pixels: arrayBufferToBase64(tile.pixels.buffer),
      version: tile.version,
    };
  }
  return result;
}

export function deserializeTiles(data: SerializableTiles): Map<string, RasterTile> {
  const tiles = new Map<string, RasterTile>();
  for (const [key, serialized] of Object.entries(data)) {
    if (!serialized || typeof serialized !== 'object') continue;
    if (typeof serialized.pixels !== 'string' || !Number.isFinite(serialized.version)) continue;
    try {
      const pixels = new Uint8ClampedArray(base64ToArrayBuffer(serialized.pixels));
      if (pixels.length !== TILE_SIZE * TILE_SIZE * 4) continue;
      tiles.set(key, { pixels, version: Math.max(1, Math.floor(serialized.version)) });
    } catch {
      // A corrupt tile must not make an otherwise usable document unloadable.
    }
  }
  return tiles;
}

// ── Brush dab compositing ──────────────────────────────────────────────────────

function createBrushMask(
  radius: number,
  hardness: number,
  shape: string = 'circle',
  angle: number = 0,
  roundness: number = 1,
): Float64Array {
  const size = Math.ceil(radius * 2);
  const mask = new Float64Array(size * size);
  const cx = radius;
  const cy = radius;
  const innerRadius = radius * (1 - hardness);
  const falloff = radius - innerRadius;

  if (shape === 'square') {
    const halfSize = radius;
    const innerHalf = halfSize * (1 - hardness);
    const edgeFalloff = halfSize - innerHalf;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);

        if (dx >= halfSize || dy >= halfSize) {
          mask[y * size + x] = 0;
        } else if (
          (dx <= innerHalf || edgeFalloff === 0) &&
          (dy <= innerHalf || edgeFalloff === 0)
        ) {
          mask[y * size + x] = 1;
        } else {
          // Smooth falloff along both axes
          const fx = dx > innerHalf ? 1 - (dx - innerHalf) / edgeFalloff : 1;
          const fy = dy > innerHalf ? 1 - (dy - innerHalf) / edgeFalloff : 1;
          mask[y * size + x] = Math.max(0, Math.min(1, fx * fy));
        }
      }
    }
  } else {
    // Circle (default) — optionally elliptical via roundness
    const rx = radius;
    const ry = radius / Math.max(0.01, roundness);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        // Apply rotation
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const rx2 = dx * cosA - dy * sinA;
        const ry2 = dx * sinA + dy * cosA;

        const dist = Math.sqrt((rx2 / rx) ** 2 + (ry2 / ry) ** 2) * rx;
        if (dist >= radius) {
          mask[y * size + x] = 0;
        } else if (dist <= innerRadius || falloff === 0) {
          mask[y * size + x] = 1;
        } else {
          mask[y * size + x] = 1 - (dist - innerRadius) / falloff;
        }
      }
    }
  }
  return mask;
}

/**
 * Apply a blend mode to two color values (premultiplied alpha).
 */
function blendPixel(
  destR: number,
  destG: number,
  destB: number,
  destA: number,
  srcR: number,
  srcG: number,
  srcB: number,
  srcA: number,
  blendMode: string,
): { r: number; g: number; b: number; a: number } {
  // If blending onto transparent with a blend mode that isn't normal,
  // the result depends on the backdrop. Fallback to normal.
  if (destA === 0 || blendMode === 'normal' || blendMode === 'source-over') {
    const outA = srcA + destA * (1 - srcA);
    if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (srcR + destR * (1 - srcA)) / outA,
      g: (srcG + destG * (1 - srcA)) / outA,
      b: (srcB + destB * (1 - srcA)) / outA,
      a: outA,
    };
  }

  // Un-premultiply for blend math
  const dr = destR / destA;
  const dg = destG / destA;
  const db = destB / destA;
  const sr = srcR / srcA;
  const sg = srcG / srcA;
  const sb = srcB / srcA;

  let br: number;
  let bg: number;
  let bb: number;

  switch (blendMode) {
    case 'multiply':
      br = sr * dr;
      bg = sg * dg;
      bb = sb * db;
      break;
    case 'screen':
      br = sr + dr - sr * dr;
      bg = sg + dg - sg * dg;
      bb = sb + db - sb * db;
      break;
    case 'overlay':
      br = dr < 0.5 ? 2 * sr * dr : 1 - 2 * (1 - sr) * (1 - dr);
      bg = dg < 0.5 ? 2 * sg * dg : 1 - 2 * (1 - sg) * (1 - dg);
      bb = db < 0.5 ? 2 * sb * db : 1 - 2 * (1 - sb) * (1 - db);
      break;
    case 'darken':
      br = Math.min(sr, dr);
      bg = Math.min(sg, dg);
      bb = Math.min(sb, db);
      break;
    case 'lighten':
      br = Math.max(sr, dr);
      bg = Math.max(sg, dg);
      bb = Math.max(sb, db);
      break;
    case 'color-dodge':
      br = dr === 0 ? 0 : Math.min(1, sr / dr);
      bg = dg === 0 ? 0 : Math.min(1, sg / dg);
      bb = db === 0 ? 0 : Math.min(1, sb / db);
      break;
    case 'color-burn':
      br = sr >= 1 ? 1 : Math.max(0, 1 - (1 - dr) / sr);
      bg = sg >= 1 ? 1 : Math.max(0, 1 - (1 - dg) / sg);
      bb = sb >= 1 ? 1 : Math.max(0, 1 - (1 - db) / sb);
      break;
    case 'difference':
      br = Math.abs(sr - dr);
      bg = Math.abs(sg - dg);
      bb = Math.abs(sb - db);
      break;
    case 'exclusion':
      br = sr + dr - 2 * sr * dr;
      bg = sg + dg - 2 * sg * dg;
      bb = sb + db - 2 * sb * db;
      break;
    default:
      br = sr;
      bg = sg;
      bb = sb;
  }

  // Alpha compositing: blend result over destination
  const outA = srcA + destA * (1 - srcA);
  if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 };

  return {
    r: (srcA * br + destA * dr * (1 - srcA)) / outA,
    g: (srcA * bg + destA * dg * (1 - srcA)) / outA,
    b: (srcA * bb + destA * db * (1 - srcA)) / outA,
    a: outA,
  };
}

function compositeBrushDabOnPixels(
  pixels: Uint8ClampedArray,
  tileW: number,
  dabX: number,
  dabY: number,
  dabRadius: number,
  dabOpacity: number,
  dabFlow: number,
  brushMask: Float64Array,
  color: readonly [number, number, number, number],
  alphaLock: boolean,
  blendMode: string = 'normal',
): void {
  const size = Math.ceil(dabRadius * 2);
  const offsetX = Math.round(dabX - dabRadius);
  const offsetY = Math.round(dabY - dabRadius);

  for (let my = 0; my < size; my++) {
    const py = offsetY + my;
    if (py < 0 || py >= tileW) continue;
    for (let mx = 0; mx < size; mx++) {
      const px = offsetX + mx;
      if (px < 0 || px >= tileW) continue;
      const maskValue = brushMask[my * size + mx]!;
      if (maskValue <= 0) continue;

      const srcAlpha = color[3]! / 255;
      const effectiveAlpha = maskValue * dabOpacity * dabFlow * srcAlpha;
      if (effectiveAlpha <= 0) continue;

      const idx = (py * tileW + px) * 4;
      const destAlpha = pixels[idx + 3]! / 255;

      if (alphaLock && destAlpha === 0) continue;

      // Premultiplied source
      const srcR = (color[0]! / 255) * effectiveAlpha;
      const srcG = (color[1]! / 255) * effectiveAlpha;
      const srcB = (color[2]! / 255) * effectiveAlpha;
      const srcA = effectiveAlpha;

      if (blendMode === 'normal' || blendMode === 'source-over') {
        const outAlpha = destAlpha + srcA * (1 - destAlpha);
        if (outAlpha <= 0) continue;
        const premulR = (color[0]! / 255) * effectiveAlpha;
        const premulG = (color[1]! / 255) * effectiveAlpha;
        const premulB = (color[2]! / 255) * effectiveAlpha;
        pixels[idx] = Math.round(
          (((pixels[idx]! / 255) * destAlpha + premulR * (1 - destAlpha)) / outAlpha) * 255,
        );
        pixels[idx + 1] = Math.round(
          (((pixels[idx + 1]! / 255) * destAlpha + premulG * (1 - destAlpha)) / outAlpha) * 255,
        );
        pixels[idx + 2] = Math.round(
          (((pixels[idx + 2]! / 255) * destAlpha + premulB * (1 - destAlpha)) / outAlpha) * 255,
        );
        pixels[idx + 3] = Math.round(outAlpha * 255);
      } else {
        const destR = (pixels[idx]! / 255) * destAlpha;
        const destG = (pixels[idx + 1]! / 255) * destAlpha;
        const destB = (pixels[idx + 2]! / 255) * destAlpha;
        const result = blendPixel(
          destR,
          destG,
          destB,
          destAlpha,
          srcR,
          srcG,
          srcB,
          srcA,
          blendMode,
        );
        pixels[idx] = Math.round(Math.min(255, Math.max(0, result.r * 255)));
        pixels[idx + 1] = Math.round(Math.min(255, Math.max(0, result.g * 255)));
        pixels[idx + 2] = Math.round(Math.min(255, Math.max(0, result.b * 255)));
        pixels[idx + 3] = Math.round(Math.min(255, Math.max(0, result.a * 255)));
      }
    }
  }
}

export function compositeDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  color: readonly [number, number, number, number],
  alphaLock = false,
): RasterLayerNode {
  const brushShape = dab.shape ?? 'circle';
  const brushMask = createBrushMask(dab.radius, dab.hardness, brushShape, dab.angle, dab.roundness);
  const dabDiameter = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    dabDiameter,
    dabDiameter,
  );

  const blendMode = dab.blendMode ?? 'normal';
  const newTiles = new Map(node.tiles);

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    let tile = newTiles.get(key);
    if (!tile) {
      tile = createEmptyTile();
    }
    const newPixels = new Uint8ClampedArray(tile.pixels);
    const newTile: RasterTile = { pixels: newPixels, version: tile.version + 1 };

    const tileOriginX = col * TILE_SIZE;
    const tileOriginY = row * TILE_SIZE;
    const localDabX = dab.x - tileOriginX;
    const localDabY = dab.y - tileOriginY;

    compositeBrushDabOnPixels(
      newTile.pixels,
      TILE_SIZE,
      localDabX,
      localDabY,
      dab.radius,
      dab.opacity,
      dab.flow,
      brushMask,
      color,
      alphaLock,
      blendMode,
    );

    newTiles.set(key, newTile);
  }

  return { ...node, tiles: newTiles };
}

export function compositeDabOnTiles(
  tiles: Map<string, RasterTile>,
  dab: BrushDab,
  color: readonly [number, number, number, number],
  alphaLock = false,
): Map<string, RasterTile> {
  const node: RasterLayerNode = {
    id: '',
    kind: 'rasterLayer',
    name: '',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
    pixelMode: false,
    tiles,
    transform: [1, 0, 0, 1, 0, 0] as Affine,
  };
  return compositeDabOnNode(node, dab, color, alphaLock).tiles;
}

/** Erase with the same tip geometry and dynamics as a paint dab. */
export function eraseDabOnNode(node: RasterLayerNode, dab: BrushDab): RasterLayerNode {
  const brushShape = dab.shape ?? 'circle';
  const brushMask = createBrushMask(dab.radius, dab.hardness, brushShape, dab.angle, dab.roundness);
  const size = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    size,
    size,
  );
  const newTiles = new Map(node.tiles);

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    const tile = newTiles.get(key);
    if (!tile) continue;
    const pixels = new Uint8ClampedArray(tile.pixels);
    const offsetX = Math.round(dab.x - col * TILE_SIZE - dab.radius);
    const offsetY = Math.round(dab.y - row * TILE_SIZE - dab.radius);
    for (let my = 0; my < size; my++) {
      const py = offsetY + my;
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let mx = 0; mx < size; mx++) {
        const px = offsetX + mx;
        if (px < 0 || px >= TILE_SIZE) continue;
        const eraseAlpha = brushMask[my * size + mx]! * dab.opacity * dab.flow;
        if (eraseAlpha <= 0) continue;
        const index = (py * TILE_SIZE + px) * 4;
        const remaining = Math.max(0, 1 - eraseAlpha);
        pixels[index + 3] = Math.round(pixels[index + 3]! * remaining);
        if (pixels[index + 3] === 0) {
          pixels[index] = 0;
          pixels[index + 1] = 0;
          pixels[index + 2] = 0;
        }
      }
    }
    newTiles.set(key, { pixels, version: tile.version + 1 });
  }
  return { ...node, tiles: newTiles };
}

// ── Smudge compositing ───────────────────────────────────────────────────────

/**
 * Composite a smudge dab onto a raster layer.
 *
 * Smudge "drags" existing pixels in the direction of motion:
 * - Samples destination pixels at the dab position
 * - Displaces them by (dx * strength, dy * strength)
 * - Blends displaced pixels with original using brush mask
 *
 * The color of existing paint is preserved (not overwritten by foreground color).
 * Only alpha > 0 pixels are smudged.
 *
 * @param node - The raster layer node
 * @param dab - The brush dab (position, radius, hardness, shape)
 * @param direction - Movement direction in radians
 * @param strength - Smudge strength (0-1)
 * @returns A new raster layer node with smudged tiles
 */
export function compositeSmudgeDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  direction: number,
  strength: number,
): RasterLayerNode {
  const brushShape = dab.shape ?? 'circle';
  const brushMask = createBrushMask(dab.radius, dab.hardness, brushShape, dab.angle, dab.roundness);
  const dabDiameter = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    dabDiameter,
    dabDiameter,
  );

  const newTiles = new Map(node.tiles);

  const displacement = dab.radius * strength * 0.5;
  const dx = Math.cos(direction) * displacement;
  const dy = Math.sin(direction) * displacement;

  for (const { col, row } of tileKeys) {
    const key = makeTileKey(col, row);
    const tile = newTiles.get(key);
    if (!tile) continue;

    const newPixels = new Uint8ClampedArray(tile.pixels);
    const size = Math.ceil(dab.radius * 2);
    const tileOriginX = col * TILE_SIZE;
    const tileOriginY = row * TILE_SIZE;
    const localDabX = dab.x - tileOriginX;
    const localDabY = dab.y - tileOriginY;
    const offsetX = Math.round(localDabX - dab.radius);
    const offsetY = Math.round(localDabY - dab.radius);

    for (let my = 0; my < size; my++) {
      const py = offsetY + my;
      if (py < 0 || py >= TILE_SIZE) continue;
      for (let mx = 0; mx < size; mx++) {
        const px = offsetX + mx;
        if (px < 0 || px >= TILE_SIZE) continue;
        const maskValue = brushMask[my * size + mx]!;
        if (maskValue <= 0) continue;

        const srcIdx = (py * TILE_SIZE + px) * 4;
        const sr = newPixels[srcIdx]!;
        const sg = newPixels[srcIdx + 1]!;
        const sb = newPixels[srcIdx + 2]!;
        const sa = newPixels[srcIdx + 3]!;
        if (sa === 0) continue;

        const sx = Math.round(px - dx);
        const sy = Math.round(py - dy);
        if (sx < 0 || sx >= TILE_SIZE || sy < 0 || sy >= TILE_SIZE) continue;

        const dstIdx = (sy * TILE_SIZE + sx) * 4;
        const dr = newPixels[dstIdx]!;
        const dg = newPixels[dstIdx + 1]!;
        const db = newPixels[dstIdx + 2]!;
        const da = newPixels[dstIdx + 3]!;

        const t = maskValue * strength;
        const invT = 1 - t;

        newPixels[srcIdx] = clampByte(sr * invT + dr * t);
        newPixels[srcIdx + 1] = clampByte(sg * invT + dg * t);
        newPixels[srcIdx + 2] = clampByte(sb * invT + db * t);
        newPixels[srcIdx + 3] = clampByte(sa * invT + da * t);
      }
    }

    newTiles.set(key, { pixels: newPixels, version: tile.version + 1 });
  }

  return { ...node, tiles: newTiles };
}

function clampByte(v: number): number {
  return Math.round(Math.max(0, Math.min(255, v)));
}
