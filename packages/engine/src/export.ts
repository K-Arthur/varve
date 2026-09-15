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

export async function tiledExport(
  opts: TileExportOpts,
  renderFn: (viewport: { x: number; y: number; w: number; h: number }, dpr: number) => ImageData,
  engineType?: 'chromium' | 'webkit' | 'gecko',
): Promise<ImageData> {
  const limit = getCanvasSizeLimit(engineType ?? 'webkit');
  const { totalW, totalH, dpr } = opts;

  if (totalW <= limit && totalH <= limit) {
    return renderFn({ x: 0, y: 0, w: totalW, h: totalH }, dpr);
  }

  const tileW = Math.min(totalW, limit);
  const tileH = Math.min(totalH, limit);

  const cols = Math.ceil(totalW / tileW);
  const rows = Math.ceil(totalH / tileH);

  const result = new ImageData(totalW, totalH);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * tileW;
      const y = row * tileH;
      const w = Math.min(tileW, totalW - x);
      const h = Math.min(tileH, totalH - y);

      const tile = await renderFn({ x, y, w, h }, dpr);

      // Copy tile pixels into result at offset
      for (let ty = 0; ty < tile.height; ty++) {
        for (let tx = 0; tx < tile.width; tx++) {
          const srcIdx = (ty * tile.width + tx) * 4;
          const dstIdx = ((y + ty) * totalW + (x + tx)) * 4;
          result.data[dstIdx] = tile.data[srcIdx]!;
          result.data[dstIdx + 1] = tile.data[srcIdx + 1]!;
          result.data[dstIdx + 2] = tile.data[srcIdx + 2]!;
          result.data[dstIdx + 3] = tile.data[srcIdx + 3]!;
        }
      }
    }
  }

  return result;
}
