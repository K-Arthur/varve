/**
 * Shared preset types — a named size/format definition usable for frame
 * creation, frame resizing, and new-document creation alike. Consumers read
 * only the fields relevant to their workflow: frame create/resize never
 * reads colorMode/dpi/bleed, since frames have no color mode (only documents
 * do — see @strata/scene's Document.colorConfig).
 *
 * Lives in @strata/shared (the dependency-free leaf package) so it can be
 * consumed by @strata/editor and @strata/home without either depending on
 * the other. Color profile recommendations are kept as a plain string id
 * here (colorProfileId) rather than @strata/scene's rich ColorProfileRef,
 * since scene depends on shared and not the reverse — @strata/scene resolves
 * the id to a real profile at document-creation time.
 */
import type { DocumentUnit } from './units';

export type PresetCategory =
  | 'photo'
  | 'print'
  | 'web'
  | 'mobile-tablet'
  | 'desktop'
  | 'social'
  | 'video-motion'
  | 'presentation'
  | 'paper'
  | 'icon-asset'
  | 'logo'
  | 'blank'
  | 'custom';

/**
 * 'any' is reserved for presets where orientation isn't a meaningful concept
 * (e.g. a scrollable web breakpoint, where height is a starting point rather
 * than a fixed dimension) — every other preset derives portrait/landscape/
 * square from its actual width/height.
 */
export type PresetOrientation = 'portrait' | 'landscape' | 'square' | 'any';

/** RGB/CMYK/grayscale — canonical definition. @strata/scene re-exports this
 *  rather than defining its own, to remove a prior duplicate type. */
export type ColorMode = 'rgb' | 'cmyk' | 'grayscale';

/** A simplified width:height ratio pair, e.g. { w: 16, h: 9 }. */
export interface PresetAspectRatio {
  w: number;
  h: number;
}

export interface PresetBleed {
  value: number;
  unit: DocumentUnit;
}

export interface PresetSafeArea {
  value: number;
  unit: DocumentUnit;
}

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  width: number;
  height: number;
  unit: DocumentUnit;
  orientation: PresetOrientation;
  /** Fixed aspect ratio, when the format defines one. Omitted for formats
   *  where the underlying standard doesn't fix a ratio (e.g. web breakpoints,
   *  the blank canvas). */
  aspectRatio?: PresetAspectRatio;
  /** Print/export resolution in dots per inch. Meaningful for print/photo
   *  formats; applied to physical sizing and rasterization, not to page/frame
   *  geometry (which always stays a fixed-96dpi world unit). */
  dpi?: number;
  /** Document-level color mode recommendation. Not applicable to frames. */
  colorMode?: ColorMode;
  /** Recommended color profile id (e.g. 'srgb', 'fogra39') — matches an id in
   *  @strata/scene's RGB_PROFILES/CMYK_PROFILES registry. */
  colorProfileId?: string;
  /** Bit depth, where the application genuinely supports more than 8bpc. */
  bitDepth?: 8 | 16 | 32;
  bleed?: PresetBleed;
  safeArea?: PresetSafeArea;
  background?: 'white' | 'transparent';
  /** Non-square pixel aspect ratio, for legacy/broadcast video formats that
   *  use one (e.g. NTSC DV). Omit for square-pixel formats. */
  pixelAspectRatio?: number;
  /** Frame rate — informational metadata for video/motion presets, seeds
   *  export-dialog defaults; the engine has no document/frame-level fps. */
  fps?: number;
  /** Suggested clip duration in seconds — informational metadata only. */
  durationSeconds?: number;
  tags?: string[];
  description?: string;
  /** Short hint about the intended workflow, shown in the picker (e.g. "Print & mail"). */
  workflowHint?: string;
}

export interface PresetGroup {
  category: PresetCategory;
  label: string;
  presets: Preset[];
}
