/**
 * Canonical export domain model (Strata export infrastructure rebuild, M2).
 *
 * This is the single source of truth for export *intent* across the editor,
 * commands, persistence, workers, native encoders, preflight, and tests. Each
 * exporter and dialog must build from these types — no unrelated per-dialog
 * option objects.
 *
 * Design notes:
 *  - Versioned (`version` per configuration) with a migration entry point, so
 *    persisted settings from older documents can be upgraded deterministically.
 *  - Unknown future fields are preserved where safe (`unknownFields`), never
 *    dropped during migration.
 *  - Format-specific settings live in typed sub-objects (color/raster/vector/
 *    print/metadata/background/optimization) rather than a single untyped blob.
 *  - Capabilities are NOT baked into the model — they live in `capabilities.ts`
 *    so the UI can be driven by what the active encoder/platform actually
 *    supports without changing persisted data.
 *
 * The legacy per-node `ExportPreset` / `ExportJob` / `ExportBatch` types in
 * `../export-types.ts` remain as the document-persistence boundary; adapters in
 * `adapter.ts` map them to and from these canonical types.
 */

import type { RenderingIntent } from '../colorManagement';
import type { NodeId } from '../types';
import type {
  ColorConversionOptions,
  DitherOptions,
  MetadataPolicy,
  ResizeOptions,
  SharpenOptions,
} from './pipeline';
import {
  createColorConversionOptions,
  createDitherOptions,
  createMetadataPolicy,
  createResizeOptions,
  createSharpenOptions,
  validateColorConversionOptions,
  validateDitherOptions,
  validateMetadataPolicy,
  validateResizeOptions,
  validateSharpenOptions,
} from './pipeline';

/** Bump when the model shape changes. Persisted configs carry this version. */
export const EXPORT_MODEL_VERSION = 1;

// ── Formats ─────────────────────────────────────────────────────────────────

/**
 * Canonical export formats. Every member must have an entry in the capability
 * contract (`capabilities.ts`); formats without a working encoder are marked
 * `supported: false` there so the UI never advertises them.
 */
export type ExportFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'svg'
  | 'pdf'
  | 'pdf-x1a'
  | 'pdf-x3'
  | 'pdf-x4'
  | 'tiff'
  | 'bmp'
  | 'ico'
  | 'icns'
  | 'eps'
  | 'psd'
  | 'json'
  | 'css'
  | 'html'
  | 'react'
  | 'flutter'
  | 'swiftui';

// ── Targets ─────────────────────────────────────────────────────────────────

export type ExportTargetKind =
  | 'selection'
  | 'node'
  | 'frame'
  | 'slice'
  | 'page'
  | 'pages'
  | 'document';

export type ExportTarget =
  | { type: 'selection'; nodeIds?: NodeId[] }
  | { type: 'node'; nodeId: NodeId }
  | { type: 'frame'; nodeId: NodeId }
  | { type: 'slice'; sliceId: string }
  | { type: 'page'; pageId: string }
  | { type: 'pages'; pageIds: string[] }
  | { type: 'document' };

export function exportTargetKind(target: ExportTarget): ExportTargetKind {
  return target.type;
}

// ── Scale ───────────────────────────────────────────────────────────────────

export type ExportScaleUnit = 'px' | 'in' | 'mm' | 'cm';

export type ExportScale =
  | { mode: 'multiplier'; value: number }
  | { mode: 'width'; value: number; unit: ExportScaleUnit }
  | { mode: 'height'; value: number; unit: ExportScaleUnit }
  | { mode: 'resolution'; dpi: number };

export function isFiniteExportScale(scale: ExportScale): boolean {
  switch (scale.mode) {
    case 'multiplier':
      return Number.isFinite(scale.value) && scale.value > 0;
    case 'width':
    case 'height':
      return Number.isFinite(scale.value) && scale.value > 0;
    case 'resolution':
      return Number.isFinite(scale.dpi) && scale.dpi > 0;
  }
}

// ── Bounds policy ───────────────────────────────────────────────────────────

/**
 * Where the export rectangle comes from. Prevents "guessing" whether effects
 * outside nominal object bounds should be clipped — this is an explicit policy.
 */
export type ExportBoundsPolicy =
  /** Nominal object bounds (no effects bleed). */
  | 'object'
  /** Visual bounds including effects that extend beyond nominal bounds. */
  | 'visual'
  /** Frame bounds. */
  | 'frame'
  /** Explicit custom rectangle. */
  | 'custom'
  /** Slice bounds. */
  | 'slice'
  /** Page bounds. */
  | 'page'
  /** Page plus configured bleed. */
  | 'page-bleed';

// ── Format-specific settings ────────────────────────────────────────────────

export type ExportColorProfile =
  | 'srgb'
  | 'display-p3'
  | 'adobe-rgb'
  | 'pro-photo'
  | 'cmyk'
  | 'grayscale'
  | 'unmanaged';

export interface ExportColorSettings {
  profile: ExportColorProfile;
  /** Named output ICC profile (e.g. 'FOGRA39'); meaningful for cmyk/grayscale. */
  iccProfile?: string;
  renderingIntent: RenderingIntent;
  blackPointCompensation: boolean;
  /** Convert content to the destination profile instead of tagging only. */
  convertToDestination: boolean;
}

export type RasterResizeMode = 'auto' | 'nearest' | 'bilinear' | 'bicubic' | 'lanczos' | 'area';

export interface RasterExportSettings {
  /** 0..1; only meaningful for lossy formats (jpeg/webp/avif). */
  quality?: number;
  transparency: boolean;
  /** Flatten background color as `[r,g,b,a]`; ignored when transparency is on. */
  matte?: [number, number, number, number];
  bitDepth: 8 | 24 | 32;
  resizeMode: RasterResizeMode;
  /** 0..1 optional post-resize sharpening. */
  sharpening?: number;
  /** Strip optional metadata (EXIF/XMP) from output. */
  stripMetadata: boolean;
  /** Dithering for indexed/palette output where supported. */
  dithering: boolean;
  /**
   * Typed processing-stage contracts. Optional for backward compatibility with
   * persisted v1 configurations; when absent the executor falls back to the
   * flat legacy fields above (`resizeMode`, `sharpening`, `dithering`).
   */
  resize?: ResizeOptions;
  sharpen?: SharpenOptions;
  dither?: DitherOptions;
  metadataPolicy?: MetadataPolicy;
  colorConversion?: ColorConversionOptions;
}

export interface VectorExportSettings {
  /** Preserve editable text, or outline to paths. */
  text: 'preserve' | 'outline';
  /** Embed font programs where legally and technically allowed. */
  embedFonts: boolean;
  /** Embed images as data; false may reference externally where supported. */
  embedImages: boolean;
  styleMode: 'inline' | 'presentation' | 'css';
  minify: boolean;
  /** Decimal precision for coordinates. */
  precision: number;
  idMode: 'auto' | 'layer-name';
}

export interface PrintExportSettings {
  bleedMm: number;
  includeCropMarks: boolean;
  includeRegistrationMarks: boolean;
  includeColorBars: boolean;
  includePageInformation: boolean;
  /** Offset of marks from trim, in mm. */
  markOffsetMm: number;
  /** Minimum effective DPI for raster content. */
  enforceDpi: number;
  downsampling: 'none' | 'average' | 'bicubic';
  compression: 'none' | 'auto';
  /** Convert to destination (e.g. CMYK) instead of tagging RGB. */
  convertToDestination: boolean;
  overprint: boolean;
  pageRange?: { from: number; to: number };
  /** Export facing-page spreads rather than single pages. */
  spreads: boolean;
}

export interface ExportMetadataSettings {
  preserveDocumentMetadata: boolean;
  preserveCopyright: boolean;
  preserveCreator: boolean;
  preserveCreationDate: boolean;
  embedColorProfile: boolean;
  stripXmp: boolean;
  stripExif: boolean;
  stripLocalPaths: boolean;
  /** Canonical metadata policy contract (supersedes the flat booleans). */
  policy?: MetadataPolicy;
}

export interface ExportBackgroundSettings {
  transparent: boolean;
  /** Background color as `[r,g,b,a]` when not transparent. */
  color?: [number, number, number, number];
}

export type ExportOptimizationEffort = 'fastest' | 'balanced' | 'thorough';

export interface ExportOptimizationSettings {
  effort: ExportOptimizationEffort;
}

// ── Destination ─────────────────────────────────────────────────────────────

export type ExportDestination =
  | { kind: 'download' }
  | { kind: 'folder'; path?: string }
  | { kind: 'save-file' }
  | { kind: 'copy' };

// ── Configuration (the canonical unit) ──────────────────────────────────────

export interface ExportConfiguration {
  id: string;
  name?: string;
  target: ExportTarget;
  format: ExportFormat;
  scale: ExportScale;
  suffix?: string;
  /** Filename template; defaults to `{name}{suffix}.{ext}` when absent. */
  filenameTemplate?: string;
  bounds?: ExportBoundsPolicy;
  color?: ExportColorSettings;
  raster?: RasterExportSettings;
  vector?: VectorExportSettings;
  print?: PrintExportSettings;
  metadata?: ExportMetadataSettings;
  background?: ExportBackgroundSettings;
  optimization?: ExportOptimizationSettings;
  destination?: ExportDestination;
  enabled: boolean;
  /** Stable id of the preset this configuration derives from, if any. */
  presetRef?: string;
  /** Model version this configuration was created with. */
  version: number;
  /** Unknown future fields, preserved across migration. */
  unknownFields?: Record<string, unknown>;
}

// ── Batch request (export job) ──────────────────────────────────────────────

export type ConflictPolicy = 'ask' | 'replace' | 'skip' | 'rename';
export type FailurePolicy = 'continue' | 'stop';

export interface ExportBatchRequest {
  id: string;
  configurations: ExportConfiguration[];
  conflictPolicy: ConflictPolicy;
  failurePolicy: FailurePolicy;
  createdAt: number;
  createdBy: string;
}

// ── Resolved job spec (the output of plan normalization) ────────────────────

/**
 * A fully resolved, normalized export unit. Produced by the plan builder from a
 * configuration; consumed by renderers/encoders/writers. The UI never builds
 * these by hand, and renderers never infer ambiguous intent from raw settings.
 */
export interface ExportJobSpec {
  id: string;
  configurationId: string;
  targetKind: ExportTargetKind;
  /** Human/object name used for filename resolution. */
  name: string;
  nodeId?: NodeId;
  pageId?: string;
  format: ExportFormat;
  fileName: string;
  relativePath: string;
  /** Final scale factor applied to nominal bounds. */
  scaleFactor: number;
  /** Output pixel dimensions after clamping. */
  resolvedDimensions: { width: number; height: number };
  /** Requested output pixel dimensions before format-limit clamping. */
  requestedDimensions?: { width: number; height: number };
  /** Whether the output was clamped to a format or raster limit. */
  dimensionsClamped?: boolean;
  /** Output PPI when the scale has physical semantics (undefined for pure multipliers). */
  outputResolutionPpi?: number;
  /** Physical size of the export bounds in inches (for print previews). */
  physicalSizeInches?: { width: number; height: number };
  boundsRect: { x: number; y: number; width: number; height: number };
  color: ExportColorSettings;
  raster?: RasterExportSettings;
  vector?: VectorExportSettings;
  print?: PrintExportSettings;
  metadata?: ExportMetadataSettings;
  background: ExportBackgroundSettings;
  bounds: ExportBoundsPolicy;
  /** True when this format is rasterized end-to-end. */
  rasterized: boolean;
  /** Node ids that must be flattened to raster for this format. */
  rasterizedNodeIds: NodeId[];
  /** True when the encoder requires an image/pattern manifest. */
  requiresImageManifest: boolean;
}

// ── Presets ─────────────────────────────────────────────────────────────────

export type ExportPresetScope = 'builtin' | 'user' | 'workspace' | 'document' | 'object';

export interface ExportPresetDefinition {
  id: string;
  name: string;
  scope: ExportPresetScope;
  configuration: ExportConfiguration;
  /** Built-in presets are immutable but duplicable. */
  builtin?: boolean;
  favorites?: boolean;
  version: number;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export interface ExportDefaults {
  scale: ExportScale;
  filenameTemplate: string;
  bounds: ExportBoundsPolicy;
  color: ExportColorSettings;
  raster: RasterExportSettings;
  vector: VectorExportSettings;
  print: PrintExportSettings;
  metadata: ExportMetadataSettings;
  background: ExportBackgroundSettings;
  optimization: ExportOptimizationSettings;
}

// ── Factories and defaults ──────────────────────────────────────────────────

export const DEFAULT_FILENAME_TEMPLATE = '{name}{suffix}.{ext}';

export function createExportColorSettings(
  partial?: Partial<ExportColorSettings>,
): ExportColorSettings {
  return {
    profile: 'srgb',
    renderingIntent: 'relative',
    blackPointCompensation: true,
    convertToDestination: false,
    ...partial,
  };
}

export function createRasterExportSettings(
  partial?: Partial<RasterExportSettings>,
): RasterExportSettings {
  const { resize, sharpen, dither, metadataPolicy, colorConversion, ...rest } = partial ?? {};
  return {
    transparency: true,
    bitDepth: 32,
    resizeMode: 'auto',
    stripMetadata: true,
    dithering: false,
    ...rest,
    ...(resize ? { resize: createResizeOptions(resize) } : {}),
    ...(sharpen ? { sharpen: createSharpenOptions(sharpen) } : {}),
    ...(dither ? { dither: createDitherOptions(dither) } : {}),
    ...(metadataPolicy ? { metadataPolicy: createMetadataPolicy(metadataPolicy) } : {}),
    ...(colorConversion ? { colorConversion: createColorConversionOptions(colorConversion) } : {}),
  };
}

export function createVectorExportSettings(
  partial?: Partial<VectorExportSettings>,
): VectorExportSettings {
  return {
    text: 'preserve',
    embedFonts: false,
    embedImages: true,
    styleMode: 'inline',
    minify: false,
    precision: 3,
    idMode: 'layer-name',
    ...partial,
  };
}

export function createPrintExportSettings(
  partial?: Partial<PrintExportSettings>,
): PrintExportSettings {
  return {
    bleedMm: 3,
    includeCropMarks: false,
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
    ...partial,
  };
}

export function createExportMetadataSettings(
  partial?: Partial<ExportMetadataSettings>,
): ExportMetadataSettings {
  const { policy, ...rest } = partial ?? {};
  return {
    preserveDocumentMetadata: false,
    preserveCopyright: false,
    preserveCreator: false,
    preserveCreationDate: false,
    embedColorProfile: false,
    stripXmp: true,
    stripExif: true,
    stripLocalPaths: true,
    ...rest,
    ...(policy ? { policy: createMetadataPolicy(policy) } : {}),
  };
}

export function createExportBackgroundSettings(
  partial?: Partial<ExportBackgroundSettings>,
): ExportBackgroundSettings {
  return {
    transparent: true,
    ...partial,
  };
}

export function createExportOptimizationSettings(
  partial?: Partial<ExportOptimizationSettings>,
): ExportOptimizationSettings {
  return { effort: 'balanced', ...partial };
}

export function createExportDefaults(partial?: Partial<ExportDefaults>): ExportDefaults {
  return {
    scale: { mode: 'multiplier', value: 1 },
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    bounds: 'visual',
    color: createExportColorSettings(),
    raster: createRasterExportSettings(),
    vector: createVectorExportSettings(),
    print: createPrintExportSettings(),
    metadata: createExportMetadataSettings(),
    background: createExportBackgroundSettings(),
    optimization: createExportOptimizationSettings(),
    ...partial,
  };
}

export interface CreateConfigurationInput {
  id: string;
  target: ExportTarget;
  format: ExportFormat;
  scale?: ExportScale;
  suffix?: string;
  enabled?: boolean;
  name?: string;
  filenameTemplate?: string;
  bounds?: ExportBoundsPolicy;
  color?: Partial<ExportColorSettings>;
  raster?: Partial<RasterExportSettings>;
  vector?: Partial<VectorExportSettings>;
  print?: Partial<PrintExportSettings>;
  metadata?: Partial<ExportMetadataSettings>;
  background?: Partial<ExportBackgroundSettings>;
  optimization?: Partial<ExportOptimizationSettings>;
  destination?: ExportDestination;
  presetRef?: string;
}

/**
 * Create a fully-defaulted configuration. Sub-objects are defaulted eagerly so
 * consumers never read `undefined` unless they explicitly opt in — this keeps
 * plan normalization deterministic.
 */
export function createExportConfiguration(input: CreateConfigurationInput): ExportConfiguration {
  return {
    id: input.id,
    name: input.name,
    target: input.target,
    format: input.format,
    scale: input.scale ?? { mode: 'multiplier', value: 1 },
    suffix: input.suffix,
    filenameTemplate: input.filenameTemplate,
    bounds: input.bounds,
    color: input.color ? createExportColorSettings(input.color) : undefined,
    raster: input.raster ? createRasterExportSettings(input.raster) : undefined,
    vector: input.vector ? createVectorExportSettings(input.vector) : undefined,
    print: input.print ? createPrintExportSettings(input.print) : undefined,
    metadata: input.metadata ? createExportMetadataSettings(input.metadata) : undefined,
    background: input.background ? createExportBackgroundSettings(input.background) : undefined,
    optimization: input.optimization
      ? createExportOptimizationSettings(input.optimization)
      : undefined,
    destination: input.destination,
    enabled: input.enabled ?? true,
    presetRef: input.presetRef,
    version: EXPORT_MODEL_VERSION,
  };
}

// ── Deterministic serialization ─────────────────────────────────────────────

const SERIALIZED_KEY_ORDER: readonly (keyof ExportConfiguration)[] = [
  'id',
  'name',
  'target',
  'format',
  'scale',
  'suffix',
  'filenameTemplate',
  'bounds',
  'color',
  'raster',
  'vector',
  'print',
  'metadata',
  'background',
  'optimization',
  'destination',
  'enabled',
  'presetRef',
  'version',
];

/**
 * Serialize a configuration with a stable key order so two equal configurations
 * produce identical strings regardless of property insertion order. Used for
 * hashing, change detection, and test determinism.
 */
export function serializeExportConfiguration(
  config: ExportConfiguration,
  options: { pretty?: boolean } = {},
): string {
  const record: Record<string, unknown> = {};
  for (const key of SERIALIZED_KEY_ORDER) {
    const value = config[key];
    if (value !== undefined) record[key] = value;
  }
  if (config.unknownFields) {
    for (const [key, value] of Object.entries(config.unknownFields)) {
      record[`__${key}`] = value;
    }
  }
  return JSON.stringify(record, undefined, options.pretty ? 2 : undefined);
}

export function exportConfigurationsEqual(a: ExportConfiguration, b: ExportConfiguration): boolean {
  return serializeExportConfiguration(a) === serializeExportConfiguration(b);
}

// ── Validation ──────────────────────────────────────────────────────────────

export class ExportConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportConfigurationError';
  }
}

const KNOWN_FORMATS = new Set<ExportFormat>([
  'png',
  'jpeg',
  'webp',
  'avif',
  'gif',
  'svg',
  'pdf',
  'pdf-x1a',
  'pdf-x3',
  'pdf-x4',
  'tiff',
  'bmp',
  'ico',
  'eps',
  'psd',
  'json',
  'css',
  'html',
  'react',
  'flutter',
  'swiftui',
]);

export function isValidExportFormat(format: unknown): format is ExportFormat {
  return typeof format === 'string' && KNOWN_FORMATS.has(format as ExportFormat);
}

export function isValidExportTarget(target: unknown): target is ExportTarget {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { type?: unknown; nodeId?: unknown; nodeIds?: unknown };
  switch (t.type) {
    case 'selection':
      return (
        t.nodeIds === undefined ||
        (Array.isArray(t.nodeIds) && t.nodeIds.every((n) => typeof n === 'string'))
      );
    case 'node':
    case 'frame':
      return typeof t.nodeId === 'string';
    case 'slice':
      return typeof (target as { sliceId?: unknown }).sliceId === 'string';
    case 'page':
      return typeof (target as { pageId?: unknown }).pageId === 'string';
    case 'pages':
      return (
        Array.isArray((target as { pageIds?: unknown }).pageIds) &&
        ((target as { pageIds: unknown[] }).pageIds as unknown[]).every(
          (p) => typeof p === 'string',
        )
      );
    case 'document':
      return true;
    default:
      return false;
  }
}

export function isValidExportScale(scale: unknown): scale is ExportScale {
  if (typeof scale !== 'object' || scale === null) return false;
  const s = scale as { mode?: unknown; value?: unknown; dpi?: unknown; unit?: unknown };
  switch (s.mode) {
    case 'multiplier':
      return typeof s.value === 'number' && Number.isFinite(s.value) && s.value > 0;
    case 'width':
    case 'height':
      return (
        typeof s.value === 'number' &&
        Number.isFinite(s.value) &&
        s.value > 0 &&
        (s.unit === 'px' || s.unit === 'in' || s.unit === 'mm' || s.unit === 'cm')
      );
    case 'resolution':
      return typeof s.dpi === 'number' && Number.isFinite(s.dpi) && s.dpi > 0;
    default:
      return false;
  }
}

/**
 * Validate a parsed configuration. Throws {@link ExportConfigurationError} on
 * the first structural problem so callers can surface a precise message.
 */
export function validateExportConfiguration(config: ExportConfiguration): void {
  if (typeof config.id !== 'string' || config.id.length === 0) {
    throw new ExportConfigurationError('Export configuration id must be a non-empty string');
  }
  if (!isValidExportFormat(config.format)) {
    throw new ExportConfigurationError(`Unknown export format: ${String(config.format)}`);
  }
  if (!isValidExportTarget(config.target)) {
    throw new ExportConfigurationError('Export configuration has an invalid target');
  }
  if (!isValidExportScale(config.scale)) {
    throw new ExportConfigurationError('Export configuration has an invalid scale');
  }
  if (config.version > EXPORT_MODEL_VERSION) {
    throw new ExportConfigurationError(
      `Export configuration version ${config.version} is newer than this app supports (${EXPORT_MODEL_VERSION})`,
    );
  }
  validateConfigProcessingStages(config);
}

/**
 * Validate the typed processing-stage contracts on a configuration. Legacy
 * flat fields (`resizeMode`, `sharpening`, `dithering`) have no runtime
 * constraints beyond their union types; the new contracts carry their own.
 */
function validateConfigProcessingStages(config: ExportConfiguration): void {
  const raster = config.raster;
  if (!raster) return;
  const guard = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ExportConfigurationError(`Invalid raster export option (${label}): ${message}`);
    }
  };
  if (raster.resize)
    guard('resize', () => validateResizeOptions(raster.resize as ResizeOptions, 'raster.resize'));
  if (raster.sharpen) {
    guard('sharpen', () =>
      validateSharpenOptions(raster.sharpen as SharpenOptions, 'raster.sharpen'),
    );
  }
  if (raster.dither)
    guard('dither', () => validateDitherOptions(raster.dither as DitherOptions, 'raster.dither'));
  if (raster.metadataPolicy) {
    guard('metadataPolicy', () =>
      validateMetadataPolicy(raster.metadataPolicy as MetadataPolicy, 'raster.metadataPolicy'),
    );
  }
  if (raster.colorConversion) {
    guard('colorConversion', () =>
      validateColorConversionOptions(
        raster.colorConversion as ColorConversionOptions,
        'raster.colorConversion',
      ),
    );
  }
  const metadata = config.metadata;
  if (metadata?.policy) {
    guard('metadata.policy', () =>
      validateMetadataPolicy(metadata.policy as MetadataPolicy, 'metadata.policy'),
    );
  }
}

// ── Migration ───────────────────────────────────────────────────────────────

const MIGRATION_KNOWN_KEYS = new Set<string>([
  'id',
  'name',
  'target',
  'format',
  'scale',
  'suffix',
  'filenameTemplate',
  'bounds',
  'color',
  'raster',
  'vector',
  'print',
  'metadata',
  'background',
  'optimization',
  'destination',
  'enabled',
  'presetRef',
  'version',
]);

/**
 * Migrate an unknown-shaped persisted object into a valid {@link ExportConfiguration}.
 *
 * - Preserves unknown future fields under `unknownFields` instead of dropping them.
 * - Fills defaulted sub-objects and scalar fields so output is always valid.
 * - Throws {@link ExportConfigurationError} for structurally unrecoverable input.
 *
 * Currently only version 1 exists; the structure is ready for future migrations
 * to chain off `input.version`.
 */
export function migrateExportConfiguration(input: unknown): ExportConfiguration {
  if (typeof input !== 'object' || input === null) {
    throw new ExportConfigurationError('Export configuration must be an object');
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new ExportConfigurationError('Export configuration id must be a non-empty string');
  }
  if (!isValidExportFormat(raw.format)) {
    throw new ExportConfigurationError(
      `Unsupported export format in configuration ${raw.id}: ${String(raw.format)}`,
    );
  }
  if (!isValidExportTarget(raw.target)) {
    throw new ExportConfigurationError(`Invalid export target in configuration ${raw.id}`);
  }
  if (!isValidExportScale(raw.scale)) {
    throw new ExportConfigurationError(`Invalid export scale in configuration ${raw.id}`);
  }

  const unknownFields: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!MIGRATION_KNOWN_KEYS.has(key)) unknownFields[key] = raw[key];
  }

  const version =
    typeof raw.version === 'number' && Number.isInteger(raw.version) ? raw.version : 1;

  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    target: raw.target as ExportTarget,
    format: raw.format as ExportFormat,
    scale: raw.scale as ExportScale,
    suffix: typeof raw.suffix === 'string' ? raw.suffix : undefined,
    filenameTemplate: typeof raw.filenameTemplate === 'string' ? raw.filenameTemplate : undefined,
    bounds: isValidBoundsPolicy(raw.bounds) ? raw.bounds : undefined,
    color: isRecord(raw.color)
      ? createExportColorSettings(raw.color as Partial<ExportColorSettings>)
      : undefined,
    raster: isRecord(raw.raster)
      ? createRasterExportSettings(raw.raster as Partial<RasterExportSettings>)
      : undefined,
    vector: isRecord(raw.vector)
      ? createVectorExportSettings(raw.vector as Partial<VectorExportSettings>)
      : undefined,
    print: isRecord(raw.print)
      ? createPrintExportSettings(raw.print as Partial<PrintExportSettings>)
      : undefined,
    metadata: isRecord(raw.metadata)
      ? createExportMetadataSettings(raw.metadata as Partial<ExportMetadataSettings>)
      : undefined,
    background: isRecord(raw.background)
      ? createExportBackgroundSettings(raw.background as Partial<ExportBackgroundSettings>)
      : undefined,
    optimization: isRecord(raw.optimization)
      ? createExportOptimizationSettings(raw.optimization as Partial<ExportOptimizationSettings>)
      : undefined,
    destination: isValidDestination(raw.destination) ? raw.destination : undefined,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    presetRef: typeof raw.presetRef === 'string' ? raw.presetRef : undefined,
    version,
    unknownFields: Object.keys(unknownFields).length > 0 ? unknownFields : undefined,
  };
}

const VALID_BOUNDS_POLICIES = new Set<ExportBoundsPolicy>([
  'object',
  'visual',
  'frame',
  'custom',
  'slice',
  'page',
  'page-bleed',
]);

function isValidBoundsPolicy(value: unknown): value is ExportBoundsPolicy {
  return typeof value === 'string' && VALID_BOUNDS_POLICIES.has(value as ExportBoundsPolicy);
}

function isValidDestination(value: unknown): value is ExportDestination {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'download' || kind === 'folder' || kind === 'save-file' || kind === 'copy';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
