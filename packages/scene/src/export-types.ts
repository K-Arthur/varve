/**
 * Export system types (Strata plan §2.5, P0.2).
 *
 * Export presets are per-node and stackable (multiple presets per node).
 * Settings hold global defaults (per-document). Jobs represent a batch queue.
 *
 * No dependency on @varve/engine — these live at the scene layer so editor,
 * codegen, and print can all import them.
 */

import type { RenderingIntent } from './colorManagement';
import type {
  DitherOptions,
  MetadataPolicy,
  ResizeOptions,
  SharpenOptions,
} from './export/pipeline';

export type { RenderingIntent };

export type ExportFormat =
  | 'png'
  | 'jpg'
  | 'webp'
  | 'avif'
  | 'svg'
  | 'pdf-screen'
  | 'pdf-x1a'
  | 'pdf-x4'
  | 'react-tailwind'
  | 'react-cssmodules'
  | 'flutter'
  | 'swiftui'
  | 'svg-component';

export type ExportScale =
  | { type: 'factor'; value: number }
  | { type: 'width'; pixels: number }
  | { type: 'height'; pixels: number };

export interface RasterOptions {
  scale: ExportScale;
  quality?: number;
  bitDepth?: 8 | 24 | 32;
  transparency?: boolean;
  matteColor?: [number, number, number, number];
  /**
   * Destination colour space for the exported raster. When set to a
   * wide-gamut space, the rendered sRGB composite is analytically converted
   * and an ICC profile is embedded (PNG/JPEG). 'srgb' is the portable
   * baseline and matches pre-2.19 behaviour exactly.
   */
  colorProfile?: 'srgb' | 'display-p3' | 'adobe-rgb' | 'pro-photo';
  pixelPerfect?: boolean;
  /**
   * Canonical processing-stage contracts (bridge into the legacy persistence
   * boundary). Optional; when absent the executor uses the legacy flat fields.
   */
  resize?: ResizeOptions;
  sharpen?: SharpenOptions;
  dither?: DitherOptions;
  metadataPolicy?: MetadataPolicy;
}

export interface VectorOptions {
  precision?: number;
  outlineText?: boolean;
  minify?: boolean;
  embedImages?: boolean;
  styleMode?: 'inline' | 'presentation' | 'css';
  includeHidden?: boolean;
  idMode?: 'auto' | 'layer-name';
}

export interface PrintOptions {
  iccProfile?: string;
  renderingIntent?: RenderingIntent;
  blackPointCompensation?: boolean;
  bleedMm?: number;
  includeCropMarks?: boolean;
  includeRegistrationMarks?: boolean;
  includeColorBars?: boolean;
  enforceDpi?: number;
  overprintBlack?: boolean;
  outlineText?: boolean;
}

export interface CodeOptions {
  units?: 'px' | 'rem';
  colorFormat?: 'hex' | 'rgba' | 'hsla';
  stylingMode?: 'tailwind' | 'css-modules' | 'styled-components';
  namingConvention?: 'kebab' | 'camelCase' | 'PascalCase';
  componentType?: 'component' | 'fragment';
  tokenAware?: boolean;
}

export interface ExportPreset {
  id: string;
  format: ExportFormat;
  scale: ExportScale;
  suffix: string;
  enabled: boolean;
  raster?: RasterOptions;
  vector?: VectorOptions;
  print?: PrintOptions;
  code?: CodeOptions;
}

export interface ExportJob {
  presetId: string;
  nodeId: string;
  nodeName: string;
  format: ExportFormat;
  fileName: string;
  /** Preset scale used to compute raster output. Kept on the job for workers. */
  scale?: ExportScale;
  /** Filename suffix persisted by the source configuration. */
  suffix?: string;
  /** Format-specific options carried from the source configuration. */
  raster?: RasterOptions;
  vector?: VectorOptions;
  code?: CodeOptions;
  dimensions: { w: number; h: number };
  estimatedSize: number;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
  result?: Uint8Array | string;
  /** Press/print settings for PDF-family jobs (bleed, marks, DPI, profile). */
  print?: PrintOptions;
}

export interface ExportBatch {
  jobs: ExportJob[];
  destinationFolder: string | null;
  filenameTemplate: string;
  folderRule: 'flat' | 'by-preset' | 'by-node';
}

export interface ExportSettings {
  defaultScale: ExportScale;
  defaultFormat: ExportFormat;
  defaultColorProfile: 'srgb' | 'display-p3';
  defaultDestination: string | null;
  defaultFilenameTemplate: string;
  defaultOutlineText: boolean;
  defaultIccProfile: string;
  defaultBleedMm: number;
  defaultRenderingIntent: RenderingIntent;
  lastUsedPerDocument: Record<string, { destination: string; format: ExportFormat }>;
}
