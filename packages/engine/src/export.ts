export function getCanvasSizeLimit(engine: 'chromium' | 'webkit' | 'gecko'): number {
  switch (engine) {
    case 'chromium':
      return 32767;
    case 'webkit':
      return 16384;
    case 'gecko':
      return 32767;
    default:
      return 16384;
  }
}

export interface TileExportOpts {
  totalW: number;
  totalH: number;
  dpr: number;
}

export interface ExportTile {
  viewport: { x: number; y: number; w: number; h: number };
  image: ImageData;
  row: number;
  column: number;
  rows: number;
  columns: number;
}

function validateTileExportOptions(opts: TileExportOpts): void {
  for (const [dimension, value] of [
    ['width', opts.totalW],
    ['height', opts.totalH],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`Tile export ${dimension} must be a positive safe integer`);
    }
  }
  if (!Number.isFinite(opts.dpr) || opts.dpr <= 0) {
    throw new RangeError('Tile export DPR must be a finite positive number');
  }
}

/**
 * Bounded tile iterator for long comic pages and webtoon episodes. Consumers
 * can encode/write each tile before requesting the next one; no full-height
 * destination image is allocated here.
 */
export async function* streamTiledExport(
  opts: TileExportOpts,
  renderFn: (
    viewport: { x: number; y: number; w: number; h: number },
    dpr: number,
  ) => ImageData | Promise<ImageData>,
  engineType?: 'chromium' | 'webkit' | 'gecko',
): AsyncGenerator<ExportTile> {
  validateTileExportOptions(opts);
  const limit = getCanvasSizeLimit(engineType ?? 'webkit');
  const tileW = Math.min(opts.totalW, limit);
  const tileH = Math.min(opts.totalH, limit);
  const columns = Math.max(1, Math.ceil(opts.totalW / tileW));
  const rows = Math.max(1, Math.ceil(opts.totalH / tileH));
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = column * tileW;
      const y = row * tileH;
      const viewport = {
        x,
        y,
        w: Math.min(tileW, opts.totalW - x),
        h: Math.min(tileH, opts.totalH - y),
      };
      const image = await renderFn(viewport, opts.dpr);
      if (image.width !== viewport.w || image.height !== viewport.h) {
        throw new Error(
          `Tile renderer returned ${image.width}x${image.height}; expected ${viewport.w}x${viewport.h}`,
        );
      }
      yield {
        viewport,
        image,
        row,
        column,
        rows,
        columns,
      };
    }
  }
}

export async function writeTiledExport(
  opts: TileExportOpts,
  renderFn: (
    viewport: { x: number; y: number; w: number; h: number },
    dpr: number,
  ) => ImageData | Promise<ImageData>,
  sink: (tile: ExportTile) => void | Promise<void>,
  engineType?: 'chromium' | 'webkit' | 'gecko',
): Promise<void> {
  for await (const tile of streamTiledExport(opts, renderFn, engineType)) await sink(tile);
}

export async function tiledExport(
  opts: TileExportOpts,
  renderFn: (
    viewport: { x: number; y: number; w: number; h: number },
    dpr: number,
  ) => ImageData | Promise<ImageData>,
  engineType?: 'chromium' | 'webkit' | 'gecko',
): Promise<ImageData> {
  validateTileExportOptions(opts);
  const { totalW, totalH } = opts;
  const result = new ImageData(totalW, totalH);
  for await (const entry of streamTiledExport(opts, renderFn, engineType)) {
    const { x: offsetX, y: offsetY } = entry.viewport;
    const tile = entry.image;

    // Copy tile pixels into result at offset
    for (let ty = 0; ty < tile.height; ty++) {
      for (let tx = 0; tx < tile.width; tx++) {
        const srcIdx = (ty * tile.width + tx) * 4;
        const dstIdx = ((offsetY + ty) * totalW + (offsetX + tx)) * 4;
        result.data[dstIdx] = tile.data[srcIdx]!;
        result.data[dstIdx + 1] = tile.data[srcIdx + 1]!;
        result.data[dstIdx + 2] = tile.data[srcIdx + 2]!;
        result.data[dstIdx + 3] = tile.data[srcIdx + 3]!;
      }
    }
  }

  return result;
}
