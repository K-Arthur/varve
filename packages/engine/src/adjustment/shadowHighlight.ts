/**
 * Shadow / Highlight recovery in straight sRGB RGBA.
 *
 * The tonal masks are smooth, overlapping ramps centred around `midpoint`.
 * Recovery is applied to luminance and then returned to RGB with a ratio so
 * hue is retained. Fully transparent pixels are left byte-for-byte intact.
 */

export interface ShadowHighlightParams {
  shadows: number;
  highlights: number;
  tonalWidth: number;
  midpoint: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Apply shadow lift and highlight recovery without changing alpha. */
export function applyShadowHighlight(
  imageData: ImageData,
  params: ShadowHighlightParams,
): ImageData {
  const data = imageData.data;
  const shadows = clamp01((Number.isFinite(params.shadows) ? params.shadows : 0) / 100);
  const highlights = clamp01((Number.isFinite(params.highlights) ? params.highlights : 0) / 100);
  const width = clamp01((Number.isFinite(params.tonalWidth) ? params.tonalWidth : 50) / 100);
  const midpoint = clamp01((Number.isFinite(params.midpoint) ? params.midpoint : 50) / 100);
  const halfWidth = Math.max(0.005, width * 0.5);
  const shadowEdge = midpoint - halfWidth;
  const highlightEdge = midpoint + halfWidth;

  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    if (alpha === 0) continue;

    const r = data[offset]! / 255;
    const g = data[offset + 1]! / 255;
    const b = data[offset + 2]! / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const shadowWeight = 1 - smoothstep(shadowEdge - halfWidth, shadowEdge + halfWidth, luma);
    const highlightWeight = smoothstep(highlightEdge - halfWidth, highlightEdge + halfWidth, luma);

    const recovered = clamp01(
      luma + shadows * shadowWeight * (1 - luma) - highlights * highlightWeight * luma,
    );
    if (Math.abs(recovered - luma) < 1e-7) continue;

    if (luma > 1e-6) {
      const ratio = recovered / luma;
      data[offset] = Math.round(clamp01(r * ratio) * 255);
      data[offset + 1] = Math.round(clamp01(g * ratio) * 255);
      data[offset + 2] = Math.round(clamp01(b * ratio) * 255);
    } else {
      data[offset] = Math.round(recovered * 255);
      data[offset + 1] = Math.round(recovered * 255);
      data[offset + 2] = Math.round(recovered * 255);
    }
  }

  return imageData;
}
