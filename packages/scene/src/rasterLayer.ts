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
