/**
 * Decode a mask PNG data URL into a single-channel Uint8Array.
 * DOM-dependent — main thread only.
 */

export async function decodeMaskDataUrl(
  dataUrl: string,
): Promise<{ mask: Uint8Array; width: number; height: number }> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to decode mask image'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const mask = new Uint8Array(img.width * img.height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = imageData.data[i * 4] ?? 0;
  }
  return { mask, width: img.width, height: img.height };
}
