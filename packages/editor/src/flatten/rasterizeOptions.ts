/** User-facing options for rasterizing a selected layer or subtree. */
export type RasterizeBackground = 'transparent' | 'white';

export interface RasterizeSelectionOptions {
  /** Output density in pixels per inch over Varve's 96-unit design space. */
  dpi: number;
  /** Include visible effect overflow in the raster bounds. */
  includeEffectOverflow: boolean;
  /** Background used to initialize the output surface. */
  background: RasterizeBackground;
  /** Keep the editable source subtree hidden beside the raster copy. */
  keepOriginal: boolean;
}

export const DEFAULT_RASTERIZE_SELECTION_OPTIONS: RasterizeSelectionOptions = {
  dpi: 300,
  includeEffectOverflow: true,
  background: 'transparent',
  keepOriginal: true,
};
