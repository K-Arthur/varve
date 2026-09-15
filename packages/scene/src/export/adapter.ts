/**
 * Adapter between the legacy export types (`../export-types.ts`, the current
 * document-persistence boundary) and the canonical export model (`./model.ts`).
 *
 * The app still stores per-node `ExportPreset[]` and the dialog still builds
 * legacy `ExportJob[]`. Until those are migrated to canonical configurations,
 * this module is the single place that converts between the two worlds so no
 * dialog or exporter defines its own unrelated option mapping.
 *
 * Conversions are total for the legacy side: every legacy preset/job/scale maps
 * to a canonical value. Reverse conversions return `undefined` only when the
 * canonical value has no legacy representation (new formats) — callers must
 * not silently drop those; they should surface them.
 */

import type {
  ExportBatch,
  ExportFormat as LegacyExportFormat,
  ExportJob as LegacyExportJob,
  ExportPreset as LegacyExportPreset,
  ExportScale as LegacyExportScale,
  RasterOptions as LegacyRasterOptions,
  VectorOptions as LegacyVectorOptions,
} from '../export-types';
import type { NodeId } from '../types';
import {
  createExportColorSettings,
  createExportConfiguration,
  createPrintExportSettings,
  createRasterExportSettings,
  createVectorExportSettings,
  type ExportBatchRequest,
  type ExportConfiguration,
  type ExportFormat,
  type ExportJobSpec,
  type ExportScale,
} from './model';

// ── Format mapping ──────────────────────────────────────────────────────────

const LEGACY_TO_CANONICAL: Record<LegacyExportFormat, ExportFormat> = {
  png: 'png',
  jpg: 'jpeg',
  webp: 'webp',
  avif: 'avif',
  svg: 'svg',
  'pdf-screen': 'pdf',
  'pdf-x1a': 'pdf-x1a',
  'pdf-x4': 'pdf-x4',
  'react-tailwind': 'react',
  'react-cssmodules': 'react',
  flutter: 'flutter',
  swiftui: 'swiftui',
  'svg-component': 'svg',
};

const CANONICAL_TO_LEGACY: Partial<Record<ExportFormat, LegacyExportFormat>> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
  gif: undefined,
  svg: 'svg',
  pdf: 'pdf-screen',
  'pdf-x1a': 'pdf-x1a',
  'pdf-x4': 'pdf-x4',
  react: 'react-tailwind',
  flutter: 'flutter',
  swiftui: 'swiftui',
};

export function legacyFormatToCanonical(format: LegacyExportFormat): ExportFormat {
  return LEGACY_TO_CANONICAL[format];
}

export function canonicalFormatToLegacy(format: ExportFormat): LegacyExportFormat | undefined {
  return CANONICAL_TO_LEGACY[format];
}

// ── Scale mapping ───────────────────────────────────────────────────────────

export function legacyScaleToCanonical(scale: LegacyExportScale): ExportScale {
  switch (scale.type) {
    case 'factor':
      return { mode: 'multiplier', value: scale.value };
    case 'width':
      return { mode: 'width', value: scale.pixels, unit: 'px' };
    case 'height':
      return { mode: 'height', value: scale.pixels, unit: 'px' };
    case 'resolution':
      return { mode: 'resolution', dpi: scale.dpi };
  }
}

export function canonicalScaleToLegacy(scale: ExportScale): LegacyExportScale | undefined {
  switch (scale.mode) {
    case 'multiplier':
      return { type: 'factor', value: scale.value };
    case 'width':
      return { type: 'width', pixels: scale.value };
    case 'height':
      return { type: 'height', pixels: scale.value };
    case 'resolution':
      return { type: 'resolution', dpi: scale.dpi };
  }
}

// ── Preset → configuration ──────────────────────────────────────────────────

/**
 * Convert a legacy per-node preset into a canonical node-target configuration.
 * `suffix` is normalized so the legacy `'@2x'` form round-trips to `'@2x'`.
 */
export function legacyPresetToConfiguration(
  nodeId: NodeId,
  preset: LegacyExportPreset,
): ExportConfiguration {
  const raster = preset.raster ? mapLegacyRasterOptions(preset.raster) : undefined;
  const vector = preset.vector ? mapLegacyVectorOptions(preset.vector) : undefined;
  const print = preset.print
    ? createPrintExportSettings({
        bleedMm: preset.print.bleedMm,
        includeCropMarks: preset.print.includeCropMarks,
        includeRegistrationMarks: preset.print.includeRegistrationMarks,
        includeColorBars: preset.print.includeColorBars,
        enforceDpi: preset.print.enforceDpi,
        overprint: preset.print.overprintBlack,
        convertToDestination: preset.format === 'pdf-x1a',
      })
    : undefined;

  const color = preset.raster?.colorProfile
    ? createExportColorSettings({
        profile:
          preset.raster.colorProfile === 'display-p3' ||
          preset.raster.colorProfile === 'adobe-rgb' ||
          preset.raster.colorProfile === 'pro-photo'
            ? preset.raster.colorProfile
            : 'srgb',
        renderingIntent: preset.print?.renderingIntent ?? 'relative',
        blackPointCompensation: preset.print?.blackPointCompensation ?? true,
      })
    : undefined;

  return createExportConfiguration({
    id: preset.id,
    target: { type: 'node', nodeId },
    format: legacyFormatToCanonical(preset.format),
    scale: legacyScaleToCanonical(preset.scale),
    suffix: normalizeSuffix(preset.suffix),
    enabled: preset.enabled,
    color,
    raster,
    vector,
    print,
  });
}

function mapLegacyRasterOptions(
  opts: LegacyRasterOptions,
): ReturnType<typeof createRasterExportSettings> {
  return createRasterExportSettings({
    quality: opts.quality,
    transparency: opts.transparency,
    matte: opts.matteColor,
    bitDepth: opts.bitDepth ?? 32,
    resize: opts.resize,
    sharpen: opts.sharpen,
    dither: opts.dither,
    metadataPolicy: opts.metadataPolicy,
  });
}

function mapLegacyVectorOptions(
  opts: LegacyVectorOptions,
): ReturnType<typeof createVectorExportSettings> {
  return createVectorExportSettings({
    text: opts.outlineText ? 'outline' : 'preserve',
    embedImages: opts.embedImages,
    styleMode: opts.styleMode ?? 'inline',
    minify: opts.minify,
    precision: opts.precision,
    idMode: opts.idMode ?? 'layer-name',
  });
}

/**
 * Normalize a legacy suffix: the legacy default was `'@2x'`, which produces
 * `name@2x.png` (no extra hyphen). Preserve that convention.
 */
function normalizeSuffix(suffix: string): string {
  if (suffix.length === 0) return '';
  if (suffix.startsWith('@')) return suffix;
  return `-${suffix}`;
}

export function legacyPresetsToConfigurations(
  nodeId: NodeId,
  presets: LegacyExportPreset[] | undefined,
): ExportConfiguration[] {
  if (!presets) return [];
  return presets.map((preset) => legacyPresetToConfiguration(nodeId, preset));
}

// ── Configuration → legacy preset (round-trip for persistence) ──────────────

/**
 * Convert a canonical configuration back to a legacy preset. Returns
 * `undefined` when the canonical value has no legacy representation (new
 * formats) — the caller must not silently drop it.
 */
export function configurationToLegacyPreset(
  config: ExportConfiguration,
): LegacyExportPreset | undefined {
  const format = canonicalFormatToLegacy(config.format);
  const scale = canonicalScaleToLegacy(config.scale);
  if (!format || !scale) return undefined;

  const raster: LegacyRasterOptions | undefined = config.raster
    ? {
        scale,
        quality: config.raster.quality,
        bitDepth: config.raster.bitDepth,
        transparency: config.raster.transparency,
        matteColor: config.raster.matte ?? config.background?.color,
        colorProfile:
          config.color?.profile === 'display-p3' ||
          config.color?.profile === 'adobe-rgb' ||
          config.color?.profile === 'pro-photo'
            ? config.color.profile
            : 'srgb',
        resize: config.raster.resize,
        sharpen: config.raster.sharpen,
        dither: config.raster.dither,
        metadataPolicy: config.raster.metadataPolicy ?? config.metadata?.policy,
      }
    : undefined;

  const vector: LegacyVectorOptions | undefined = config.vector
    ? {
        precision: config.vector.precision,
        outlineText: config.vector.text === 'outline',
        minify: config.vector.minify,
        embedImages: config.vector.embedImages,
        styleMode: config.vector.styleMode,
        idMode: config.vector.idMode,
      }
    : undefined;

  const print = config.print
    ? {
        iccProfile: config.color?.iccProfile,
        renderingIntent: config.color?.renderingIntent,
        blackPointCompensation: config.color?.blackPointCompensation,
        bleedMm: config.print.bleedMm,
        includeCropMarks: config.print.includeCropMarks,
        includeRegistrationMarks: config.print.includeRegistrationMarks,
        includeColorBars: config.print.includeColorBars,
        enforceDpi: config.print.enforceDpi,
        overprintBlack: config.print.overprint,
        outlineText: config.vector?.text === 'outline',
      }
    : undefined;

  return {
    id: config.id,
    format,
    scale,
    suffix: stripSuffixPrefix(config.suffix ?? ''),
    enabled: config.enabled,
    raster,
    vector,
    print,
  };
}

/**
 * Convert a legacy batch into a canonical export request so the plan builder
 * and preflight can operate on legacy data without a full migration.
 */
export function legacyBatchToRequest(batch: ExportBatch): ExportBatchRequest {
  return {
    id: `legacy-${batch.jobs.length}-jobs`,
    configurations: batch.jobs.map((job, index) =>
      createExportConfiguration({
        id: job.presetId || `job-${index}`,
        target: { type: 'node', nodeId: job.nodeId },
        format: legacyFormatToCanonical(job.format),
        scale: job.scale ? legacyScaleToCanonical(job.scale) : { mode: 'multiplier', value: 1 },
        filenameTemplate: batch.filenameTemplate,
        raster: job.raster ? mapLegacyRasterOptions(job.raster) : undefined,
        vector: job.vector ? mapLegacyVectorOptions(job.vector) : undefined,
        print: job.print
          ? createPrintExportSettings({
              bleedMm: job.print.bleedMm,
              includeCropMarks: job.print.includeCropMarks,
              includeRegistrationMarks: job.print.includeRegistrationMarks,
              includeColorBars: job.print.includeColorBars,
              enforceDpi: job.print.enforceDpi,
              overprint: job.print.overprintBlack,
            })
          : undefined,
        enabled: true,
      }),
    ),
    conflictPolicy: 'ask',
    failurePolicy: 'continue',
    createdAt: Date.now(),
    createdBy: 'legacy-batch',
  };
}

function stripSuffixPrefix(suffix: string): string {
  return suffix.startsWith('@') ? suffix : suffix.replace(/^-/, '');
}

// ── Legacy job → job spec ───────────────────────────────────────────────────

/**
 * Convert a legacy batch job into a canonical job spec. Legacy jobs carry only
 * filename + dimensions; the canonical spec adds defaulted color/background/
 * bounds. Returns `undefined` for formats with no canonical representation.
 */
export function legacyJobToJobSpec(job: LegacyExportJob): ExportJobSpec | undefined {
  const format = legacyFormatToCanonical(job.format);
  if (!format) return undefined;

  return {
    id: job.fileName,
    configurationId: job.presetId,
    targetKind: 'node',
    name: job.nodeName,
    nodeId: job.nodeId,
    format,
    fileName: job.fileName,
    relativePath: job.fileName,
    scaleFactor: 1,
    requestedDimensions: { width: job.dimensions.w, height: job.dimensions.h },
    resolvedDimensions: { width: job.dimensions.w, height: job.dimensions.h },
    dimensionsClamped: false,
    outputResolutionPpi: job.outputPpi,
    boundsRect: { x: 0, y: 0, width: job.dimensions.w, height: job.dimensions.h },
    color: createExportColorSettings(),
    background: { transparent: true },
    bounds: 'object',
    rasterized: format === 'png' || format === 'jpeg' || format === 'webp',
    rasterizedNodeIds: [],
    requiresImageManifest: format === 'pdf' || format === 'pdf-x1a' || format === 'pdf-x4',
  };
}
