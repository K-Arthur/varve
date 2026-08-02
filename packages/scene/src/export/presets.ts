/**
 * Built-in export presets (Strata export rebuild, M6).
 *
 * Reusable, target-agnostic configurations at three scopes the product
 * understands: web, print, and developer. Presets are immutable but
 * duplicable — materializing one creates a *new* concrete configuration with
 * its own id, so later edits to a preset never change already-persisted
 * document output (explicit linkage model with safe fallback).
 *
 * A preset may also be a *bundle*: several configurations applied together
 * (e.g. an iOS icon set at 1x/2x/3x, or "SVG + PNG@1x + PNG@2x").
 *
 * Every preset must configure real backend behavior (validated against the
 * capability contract) — presets are not just renamed defaults.
 */

import {
  createExportConfiguration,
  EXPORT_MODEL_VERSION,
  type ExportConfiguration,
  type ExportFormat,
  type ExportScale,
  type ExportTarget,
} from './model';

// ── Types ───────────────────────────────────────────────────────────────────

export type BuiltinPresetCategory = 'web' | 'print' | 'developer';

export interface BuiltinPresetDefinition {
  /** Stable slug (never change — persisted presetRefs reference it). */
  id: string;
  name: string;
  category: BuiltinPresetCategory;
  description?: string;
  format: ExportFormat;
  scale: ExportScale;
  /** Defaults applied when the configuration is materialized. */
  config: Omit<ExportConfiguration, 'id' | 'target' | 'format' | 'scale' | 'version'>;
}

export interface BuiltinPresetBundle {
  id: string;
  name: string;
  category: BuiltinPresetCategory;
  description?: string;
  presetIds: string[];
}

// ── Web presets ─────────────────────────────────────────────────────────────

const webPngTransparent = {
  config: {
    color: {
      profile: 'srgb' as const,
      renderingIntent: 'relative' as const,
      blackPointCompensation: true,
      convertToDestination: false,
    },
    raster: {
      transparency: true,
      bitDepth: 32 as const,
      resizeMode: 'auto' as const,
      stripMetadata: true,
      dithering: false,
    },
    background: { transparent: true },
    metadata: {
      preserveDocumentMetadata: false,
      preserveCopyright: false,
      preserveCreator: false,
      preserveCreationDate: false,
      embedColorProfile: false,
      stripXmp: true,
      stripExif: true,
      stripLocalPaths: true,
    },
    bounds: 'visual' as const,
    enabled: true,
  },
};

// ── Preset catalog ──────────────────────────────────────────────────────────

export const BUILTIN_EXPORT_PRESETS: Record<string, BuiltinPresetDefinition> = {
  // Web
  'web-png-1x': {
    id: 'web-png-1x',
    name: 'PNG 1×',
    category: 'web',
    description: 'Transparent PNG at 1×, sRGB, metadata stripped.',
    format: 'png',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      ...webPngTransparent.config,
      filenameTemplate: '{name}.{ext}',
    },
  },
  'web-png-2x': {
    id: 'web-png-2x',
    name: 'PNG 2×',
    category: 'web',
    description: 'Transparent PNG at 2× for HiDPI displays.',
    format: 'png',
    scale: { mode: 'multiplier', value: 2 },
    config: {
      ...webPngTransparent.config,
      suffix: '@2x',
    },
  },
  'web-png-transparent': {
    id: 'web-png-transparent',
    name: 'PNG transparent',
    category: 'web',
    format: 'png',
    scale: { mode: 'multiplier', value: 1 },
    config: webPngTransparent.config,
  },
  'web-jpeg-high': {
    id: 'web-jpeg-high',
    name: 'JPEG high quality',
    category: 'web',
    description: 'High-quality JPEG with a white flatten background.',
    format: 'jpeg',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'visual',
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      raster: {
        quality: 0.92,
        transparency: false,
        bitDepth: 24,
        resizeMode: 'bicubic',
        stripMetadata: true,
        dithering: false,
      },
      background: { transparent: false, color: [255, 255, 255, 255] },
      metadata: {
        preserveDocumentMetadata: false,
        preserveCopyright: false,
        preserveCreator: false,
        preserveCreationDate: false,
        embedColorProfile: false,
        stripXmp: true,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'web-webp-optimized': {
    id: 'web-webp-optimized',
    name: 'WebP optimized',
    category: 'web',
    description: 'Lossy WebP, balanced effort.',
    format: 'webp',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'visual',
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      raster: {
        quality: 0.8,
        transparency: true,
        bitDepth: 32,
        resizeMode: 'bicubic',
        stripMetadata: true,
        dithering: false,
      },
      background: { transparent: true },
      metadata: {
        preserveDocumentMetadata: false,
        preserveCopyright: false,
        preserveCreator: false,
        preserveCreationDate: false,
        embedColorProfile: false,
        stripXmp: true,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'web-social': {
    id: 'web-social',
    name: 'Social image (1200×630)',
    category: 'web',
    description: 'JPEG sized to 1200×630 with a dark background.',
    format: 'jpeg',
    scale: { mode: 'width', value: 1200, unit: 'px' },
    config: {
      bounds: 'visual',
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      raster: {
        quality: 0.9,
        transparency: false,
        bitDepth: 24,
        resizeMode: 'bicubic',
        stripMetadata: true,
        dithering: false,
      },
      background: { transparent: false, color: [24, 24, 27, 255] },
      metadata: {
        preserveDocumentMetadata: false,
        preserveCopyright: false,
        preserveCreator: false,
        preserveCreationDate: false,
        embedColorProfile: false,
        stripXmp: true,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'web-svg-web': {
    id: 'web-svg-web',
    name: 'SVG for web',
    category: 'web',
    description: 'Minified SVG, text preserved, images embedded.',
    format: 'svg',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'visual',
      vector: {
        text: 'preserve',
        embedFonts: false,
        embedImages: true,
        styleMode: 'inline',
        minify: true,
        precision: 3,
        idMode: 'layer-name',
      },
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      enabled: true,
    },
  },
  'web-svg-editable': {
    id: 'web-svg-editable',
    name: 'SVG editable',
    category: 'web',
    description: 'Readable SVG for later editing, text and ids preserved.',
    format: 'svg',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'visual',
      vector: {
        text: 'preserve',
        embedFonts: false,
        embedImages: true,
        styleMode: 'inline',
        minify: false,
        precision: 3,
        idMode: 'layer-name',
      },
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      enabled: true,
    },
  },

  // Print
  'print-pdf-screen': {
    id: 'print-pdf-screen',
    name: 'PDF for screen',
    category: 'print',
    description: 'General-purpose RGB PDF.',
    format: 'pdf',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'page',
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      metadata: {
        preserveDocumentMetadata: true,
        preserveCopyright: false,
        preserveCreator: true,
        preserveCreationDate: true,
        embedColorProfile: false,
        stripXmp: false,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'print-pdf-x4': {
    id: 'print-pdf-x4',
    name: 'PDF/X-4',
    category: 'print',
    description: 'Press-ready PDF/X-4 with 3 mm bleed and crop marks.',
    format: 'pdf-x4',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'page-bleed',
      color: {
        profile: 'srgb',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      print: {
        bleedMm: 3,
        includeCropMarks: true,
        includeRegistrationMarks: false,
        includeColorBars: false,
        includePageInformation: false,
        markOffsetMm: 3,
        enforceDpi: 300,
        downsampling: 'bicubic',
        compression: 'auto',
        convertToDestination: false,
        overprint: false,
        spreads: false,
      },
      metadata: {
        preserveDocumentMetadata: true,
        preserveCopyright: true,
        preserveCreator: true,
        preserveCreationDate: true,
        embedColorProfile: true,
        stripXmp: false,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'print-pdf-x1a': {
    id: 'print-pdf-x1a',
    name: 'PDF/X-1a',
    category: 'print',
    description: 'CMYK PDF/X-1a, Fogra39, flattened.',
    format: 'pdf-x1a',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'page-bleed',
      color: {
        profile: 'cmyk',
        iccProfile: 'FOGRA39',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: true,
      },
      print: {
        bleedMm: 3,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBars: true,
        includePageInformation: false,
        markOffsetMm: 3,
        enforceDpi: 300,
        downsampling: 'bicubic',
        compression: 'auto',
        convertToDestination: true,
        overprint: true,
        spreads: false,
      },
      metadata: {
        preserveDocumentMetadata: true,
        preserveCopyright: true,
        preserveCreator: true,
        preserveCreationDate: true,
        embedColorProfile: true,
        stripXmp: false,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'print-cmyk-proof': {
    id: 'print-cmyk-proof',
    name: 'CMYK proof',
    category: 'print',
    description: 'Soft-proof CMYK conversion without press compliance.',
    format: 'pdf-x4',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'page-bleed',
      color: {
        profile: 'cmyk',
        iccProfile: 'GRACoL2006',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: true,
      },
      print: {
        bleedMm: 3,
        includeCropMarks: true,
        includeRegistrationMarks: false,
        includeColorBars: false,
        includePageInformation: true,
        markOffsetMm: 3,
        enforceDpi: 300,
        downsampling: 'bicubic',
        compression: 'auto',
        convertToDestination: true,
        overprint: true,
        spreads: false,
      },
      metadata: {
        preserveDocumentMetadata: true,
        preserveCopyright: true,
        preserveCreator: true,
        preserveCreationDate: true,
        embedColorProfile: true,
        stripXmp: false,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },
  'print-client-review': {
    id: 'print-client-review',
    name: 'Client review PDF',
    category: 'print',
    description: 'RGB PDF for screen review of a print layout.',
    format: 'pdf',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'page-bleed',
      color: {
        profile: 'srgb',
        renderingIntent: 'perceptual',
        blackPointCompensation: true,
        convertToDestination: false,
      },
      metadata: {
        preserveDocumentMetadata: true,
        preserveCopyright: true,
        preserveCreator: true,
        preserveCreationDate: true,
        embedColorProfile: false,
        stripXmp: false,
        stripExif: true,
        stripLocalPaths: true,
      },
      enabled: true,
    },
  },

  // Developer
  'dev-react': {
    id: 'dev-react',
    name: 'React component',
    category: 'developer',
    format: 'react',
    scale: { mode: 'multiplier', value: 1 },
    config: { bounds: 'visual', enabled: true },
  },
  'dev-svg-component': {
    id: 'dev-svg-component',
    name: 'SVG component',
    category: 'developer',
    format: 'svg',
    scale: { mode: 'multiplier', value: 1 },
    config: {
      bounds: 'visual',
      vector: {
        text: 'preserve',
        embedFonts: false,
        embedImages: true,
        styleMode: 'inline',
        minify: true,
        precision: 3,
        idMode: 'layer-name',
      },
      enabled: true,
    },
  },
  'dev-flutter': {
    id: 'dev-flutter',
    name: 'Flutter widget',
    category: 'developer',
    format: 'flutter',
    scale: { mode: 'multiplier', value: 1 },
    config: { bounds: 'visual', enabled: true },
  },
  'dev-swiftui': {
    id: 'dev-swiftui',
    name: 'SwiftUI view',
    category: 'developer',
    format: 'swiftui',
    scale: { mode: 'multiplier', value: 1 },
    config: { bounds: 'visual', enabled: true },
  },
};

// ── Bundles (multi-configuration presets) ───────────────────────────────────

export const BUILTIN_PRESET_BUNDLES: Record<string, BuiltinPresetBundle> = {
  'bundle-web-asset-set': {
    id: 'bundle-web-asset-set',
    name: 'Web asset set (SVG + PNG 1× + PNG 2×)',
    category: 'web',
    presetIds: ['web-svg-web', 'web-png-1x', 'web-png-2x'],
  },
  'bundle-ios-icon-set': {
    id: 'bundle-ios-icon-set',
    name: 'iOS icon set (1024 + 2× + 3×)',
    category: 'web',
    description: 'App Store master plus 2× and 3× display sizes.',
    presetIds: ['web-png-1x', 'web-png-2x'],
  },
};

// ── Catalog accessors ───────────────────────────────────────────────────────

export function getBuiltinPreset(id: string): BuiltinPresetDefinition | undefined {
  return BUILTIN_EXPORT_PRESETS[id];
}

export function getBuiltinBundle(id: string): BuiltinPresetBundle | undefined {
  return BUILTIN_PRESET_BUNDLES[id];
}

export function builtinPresetList(): BuiltinPresetDefinition[] {
  return Object.values(BUILTIN_EXPORT_PRESETS);
}

export function builtinBundleList(): BuiltinPresetBundle[] {
  return Object.values(BUILTIN_PRESET_BUNDLES);
}

// ── Materialization ─────────────────────────────────────────────────────────

/**
 * Materialize a built-in preset for a concrete target, producing a new
 * configuration with a fresh id. The resulting configuration is detached from
 * the preset: editing the preset later never changes documents that already
 * materialized it.
 */
export function materializePreset(
  preset: BuiltinPresetDefinition,
  target: ExportTarget,
  id: string,
): ExportConfiguration {
  return createExportConfiguration({
    id,
    target,
    format: preset.format,
    scale: preset.scale,
    suffix: preset.config.suffix,
    filenameTemplate: preset.config.filenameTemplate,
    bounds: preset.config.bounds,
    color: preset.config.color,
    raster: preset.config.raster,
    vector: preset.config.vector,
    print: preset.config.print,
    metadata: preset.config.metadata,
    background: preset.config.background,
    optimization: preset.config.optimization,
    destination: preset.config.destination,
    enabled: preset.config.enabled,
    presetRef: preset.id,
  });
}

export function materializePresetById(
  presetId: string,
  target: ExportTarget,
  id: string,
): ExportConfiguration | undefined {
  const preset = getBuiltinPreset(presetId);
  return preset ? materializePreset(preset, target, id) : undefined;
}

/**
 * Materialize a bundle into ordered configurations for one target. Skips
 * missing presets (surfaced by callers as unknown presetRefs). Ids are
 * prefixed with the bundle id for determinism.
 */
export function materializeBundle(
  bundle: BuiltinPresetBundle,
  target: ExportTarget,
  idPrefix: string,
): ExportConfiguration[] {
  const configs: ExportConfiguration[] = [];
  for (const presetId of bundle.presetIds) {
    const preset = getBuiltinPreset(presetId);
    if (!preset) continue;
    configs.push(materializePreset(preset, target, `${idPrefix}-${preset.id}`));
  }
  return configs;
}

/**
 * Create a fresh configuration for a user-created (non-builtin) preset from a
 * template. The template is an existing configuration whose id/target are
 * replaced.
 */
export function createUserPresetConfiguration(
  template: Omit<ExportConfiguration, 'id' | 'target'>,
  target: ExportTarget,
  id: string,
): ExportConfiguration {
  return {
    ...template,
    id,
    target,
    version: EXPORT_MODEL_VERSION,
    presetRef: undefined,
  };
}
