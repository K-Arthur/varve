import type { AreaSelectionOperation } from '@varve/engine';

export interface MagicWandSettings {
  /** Product-scale tolerance: 0 = exact; 100 = broad perceptual range. */
  tolerance: number;
  /** Colour-range falloff, distinct from spatial selection feather. */
  edgeFeather: number;
  mode: 'contiguous' | 'global';
  operation: AreaSelectionOperation;
}

export const DEFAULT_MAGIC_WAND_SETTINGS: Readonly<MagicWandSettings> = Object.freeze({
  tolerance: 8,
  edgeFeather: 0,
  mode: 'contiguous',
  operation: 'replace',
});
