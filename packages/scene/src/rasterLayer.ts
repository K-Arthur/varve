import type { RasterLayerNode, RasterTile } from './types';

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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
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
  return bytes.buffer;
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
    tiles.set(key, {
      pixels: new Uint8ClampedArray(base64ToArrayBuffer(serialized.pixels)),
      version: serialized.version,
    });
  }
  return tiles;
}

// ── Brush dab compositing ──────────────────────────────────────────────────────

export interface BrushDab {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  flow: number;
  hardness: number;
  angle: number;
  roundness: number;
  strokeT: number;
}

function createBrushMask(radius: number, hardness: number): Float64Array {
  const size = Math.ceil(radius * 2);
  const mask = new Float64Array(size * size);
  const cx = radius;
  const cy = radius;
  const innerRadius = radius * (1 - hardness);
  const falloff = radius - innerRadius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= radius) {
        mask[y * size + x] = 0;
      } else if (dist <= innerRadius || falloff === 0) {
        mask[y * size + x] = 1;
      } else {
        mask[y * size + x] = 1 - (dist - innerRadius) / falloff;
      }
    }
  }
  return mask;
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
      const maskValue = brushMask[my * size + mx];
      if (maskValue <= 0) continue;

      const srcAlpha = color[3]! / 255;
      const effectiveAlpha = maskValue * dabOpacity * dabFlow * srcAlpha;
      if (effectiveAlpha <= 0) continue;

      const idx = (py * tileW + px) * 4;
      const destAlpha = pixels[idx + 3]! / 255;
      const outAlpha = destAlpha + effectiveAlpha * (1 - destAlpha);

      if (alphaLock && destAlpha === 0) continue;
      if (outAlpha <= 0) continue;

      // Alpha-blended compositing
      const srcR = (color[0]! / 255) * effectiveAlpha;
      const srcG = (color[1]! / 255) * effectiveAlpha;
      const srcB = (color[2]! / 255) * effectiveAlpha;

      pixels[idx] = Math.round(
        (((pixels[idx]! / 255) * destAlpha + srcR * (1 - destAlpha)) / outAlpha) * 255,
      );
      pixels[idx + 1] = Math.round(
        (((pixels[idx + 1]! / 255) * destAlpha + srcG * (1 - destAlpha)) / outAlpha) * 255,
      );
      pixels[idx + 2] = Math.round(
        (((pixels[idx + 2]! / 255) * destAlpha + srcB * (1 - destAlpha)) / outAlpha) * 255,
      );
      pixels[idx + 3] = Math.round(outAlpha * 255);
    }
  }
}

export function compositeDabOnNode(
  node: RasterLayerNode,
  dab: BrushDab,
  color: readonly [number, number, number, number],
  alphaLock = false,
): RasterLayerNode {
  const brushMask = createBrushMask(dab.radius, dab.hardness);
  const dabDiameter = Math.ceil(dab.radius * 2);
  const tileKeys = tilesForBounds(
    Math.floor(dab.x - dab.radius),
    Math.floor(dab.y - dab.radius),
    dabDiameter,
    dabDiameter,
  );

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
  };
  return compositeDabOnNode(node, dab, color, alphaLock).tiles;
}
