/** Downscale source image for AI preview inference; mask is upscaled back to source size. */

type Canvas2dContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas2d(width: number, height: number): Canvas2dContext {
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d');
    if (ctx) return ctx;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return ctx;
}

export function downscaleImageData(imageData: ImageData, maxDim: number): ImageData {
  const { width, height } = imageData;
  if (width <= maxDim && height <= maxDim) return imageData;

  const scale = maxDim / Math.max(width, height);
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const srcCtx = createCanvas2d(width, height);
  srcCtx.putImageData(imageData, 0, 0);

  const dstCtx = createCanvas2d(targetW, targetH);
  dstCtx.drawImage(srcCtx.canvas as CanvasImageSource, 0, 0, targetW, targetH);
  return dstCtx.getImageData(0, 0, targetW, targetH);
}
