import type { AreaSelectionOperation } from '@varve/engine';

export interface MagicWandSettings {
  /** Product-scale tolerance: 0 = exact; 100 = broad perceptual range. */
  tolerance: number;
  /** Colour-range falloff, distinct from spatial selection feather. */
  edgeFeather: number;
  /** Grow the final coverage so flats can reach under antialiased ink. */
  edgeExpansion: number;
  /** Close narrow non-matching barriers before contiguous visible-artwork sampling. */
  gapClosure: number;
  mode: 'contiguous' | 'global';
  operation: AreaSelectionOperation;
  /** Read from one hit raster/image or the rendered visible artwork in the active surface. */
  sampleSource: 'currentLayer' | 'visibleArtwork';
}

export const DEFAULT_MAGIC_WAND_SETTINGS: Readonly<MagicWandSettings> = Object.freeze({
  tolerance: 8,
  edgeFeather: 0,
  edgeExpansion: 0,
  gapClosure: 0,
  mode: 'contiguous',
  operation: 'replace',
  sampleSource: 'currentLayer',
});
