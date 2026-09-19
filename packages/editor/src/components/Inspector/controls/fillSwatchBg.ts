/**
 * Paint swatch background — the CSS `background` value that previews a Fill
 * inside a swatch face or value pill.
 *
 * Shared by the Fill paint rows and the Typography text-colour view so a
 * paint previews identically wherever it is shown (a solid with alpha, a
 * gradient built from its stops, an image from the document asset store).
 */
import type { DocumentAsset, Fill } from '@varve/scene';
import { managedColorToRgba } from '@varve/shared';

export function fillSwatchBg(fill: Fill, assets?: Record<string, DocumentAsset>): string {
  if (fill.type === 'solid' && fill.color) {
    const [r, g, b, a] = managedColorToRgba(fill.color);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops
      .map((s) => {
        const [r, g, b, a] = managedColorToRgba(s.color);
        return `rgba(${r},${g},${b},${(a / 255).toFixed(2)}) ${(s.position * 100).toFixed(0)}%`;
      })
      .join(', ');
    return `linear-gradient(90deg, ${stops})`;
  }
  if (fill.type === 'image') {
    const canonicalAssetId = fill.image?.src.startsWith('asset:')
      ? fill.image.src.slice('asset:'.length)
      : undefined;
    const assetId =
      (canonicalAssetId && assets?.[canonicalAssetId] ? canonicalAssetId : undefined) ??
      (fill.image?.assetId && assets?.[fill.image.assetId] ? fill.image.assetId : undefined);
    const src = assetId ? assets?.[assetId]?.dataUrl : fill.image?.src;
    if (src && !src.startsWith('asset:')) return `url(${src}) center/cover`;
    return 'var(--color-surface-sunken)';
  }
  return 'var(--color-surface-sunken)';
}
