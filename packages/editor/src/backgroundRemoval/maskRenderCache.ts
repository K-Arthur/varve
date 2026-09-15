/**
 * Keep full-resolution raster masks in the document while caching a bounded
 * preview image for interactive canvas rendering. A source-resolution mask
 * can otherwise consume width * height * 4 decoded bytes in WebKit in
 * addition to the decoded source image (an 8803x5919 pair is about 398 MiB).
 */

export const MAX_MASK_RENDER_DIMENSION = 2048;

const maskRenderUrls = new Map<string, string>();
const MAX_MASK_RENDER_URLS = 32;

interface MaskImageCache {
  isLoaded(url: string): boolean;
  getImage(url: string): HTMLImageElement | ImageBitmap | null;
  load(url: string): Promise<HTMLImageElement | ImageBitmap>;
  setLoaded(url: string, image: HTMLImageElement | ImageBitmap): void;
}

export function maskRenderDimensions(
  width: number,
  height: number,
  maxDimension = MAX_MASK_RENDER_DIMENSION,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxDimension) ||
    maxDimension <= 0
  ) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Resolve the bounded live-canvas asset without changing the document asset. */
export function maskRenderUrl(maskDataUrl: string): string {
  return maskRenderUrls.get(maskDataUrl) ?? maskDataUrl;
}

function rememberMaskRenderUrl(maskDataUrl: string, renderUrl: string): void {
  maskRenderUrls.delete(maskDataUrl);
  maskRenderUrls.set(maskDataUrl, renderUrl);
  while (maskRenderUrls.size > MAX_MASK_RENDER_URLS) {
    const oldest = maskRenderUrls.keys().next().value;
    if (oldest === undefined) break;
    maskRenderUrls.delete(oldest);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode mask render proxy'));
    image.src = url;
  });
}

async function createMaskRenderProxy(
  maskDataUrl: string,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const target = maskRenderDimensions(width, height);
  const response = await fetch(maskDataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: target.width,
    resizeHeight: target.height,
    resizeQuality: 'high',
  });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D unavailable for mask render proxy');
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    return await loadImage(canvas.toDataURL('image/png'));
  } finally {
    bitmap.close();
  }
}

async function createMaskRenderProxyFromImage(
  image: HTMLImageElement | ImageBitmap,
  width: number,
  height: number,
): Promise<HTMLImageElement> {
  const target = maskRenderDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D unavailable for mask render proxy');
  context.drawImage(image, 0, 0, target.width, target.height);
  return loadImage(canvas.toDataURL('image/png'));
}

/**
 * Warm the renderer cache without retaining a second source-resolution RGBA
 * image. The full PNG remains untouched in RasterMaskAsset.dataUrl for mask
 * editing, persistence, and export.
 */
export async function warmMaskRenderCache(
  cache: MaskImageCache,
  maskDataUrl: string | null | undefined,
  width: number,
  height: number,
): Promise<void> {
  if (!maskDataUrl) return;
  const target = maskRenderDimensions(width, height);
  if (target.width === width && target.height === height) {
    maskRenderUrls.delete(maskDataUrl);
    if (!cache.isLoaded(maskDataUrl)) await cache.load(maskDataUrl);
    return;
  }

  try {
    const loaded = cache.getImage(maskDataUrl);
    const proxy = loaded
      ? await createMaskRenderProxyFromImage(loaded, width, height)
      : await createMaskRenderProxy(maskDataUrl, width, height);
    // The live canvas resolves this separate proxy URL. Export and mask-editing
    // paths continue to resolve the authoritative full-resolution data URL.
    rememberMaskRenderUrl(maskDataUrl, proxy.src);
    cache.setLoaded(proxy.src, proxy);
  } catch {
    // Older WebKit builds may not support createImageBitmap resize options.
    // Decode once with HTMLImageElement, then register a separate bounded
    // proxy before the review UI is shown.
    try {
      const fullImage = await cache.load(maskDataUrl);
      const proxy = await createMaskRenderProxyFromImage(fullImage, width, height);
      rememberMaskRenderUrl(maskDataUrl, proxy.src);
      cache.setLoaded(proxy.src, proxy);
    } catch {
      // The renderer can retry the authoritative URL. Preview creation must
      // not fail merely because an optional cache warm-up was unavailable.
    }
  }
}
