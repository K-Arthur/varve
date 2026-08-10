/**
 * ExportService — one execution path for export jobs and reports.
 *
 * The dialog builds jobs; this service renders them, writes them through an
 * optional sink, and returns a report that can drive user-visible results.
 */

import {
  exportNodeToCssModules,
  exportNodeToFlutter,
  exportNodeToSvg,
  exportNodeToSwiftUI,
  exportNodeToTailwind,
} from '@varve/codegen';
import type { Engine } from '@varve/engine';
import { getFontRegistry } from '@varve/engine';
import type { Document, ExportBatch, ExportFormat, ExportJob } from '@varve/scene';
import {
  capabilitiesForFormat,
  type ExportFinding,
  legacyBatchToRequest,
  type PlatformKind,
  runExportPreflight,
} from '@varve/scene/export';
import {
  exportNodeAsPdf,
  exportNodeAsPdfX,
  exportNodeAsRaster,
  type RasterFormat,
} from './components/SpecPanel/export';
import { worldBBox } from './components/SpecPanel/measurement';
import { composeFlattenedRasterAssetsForNode } from './export/compositor';
import { collectGradientMapFlattenWarnings } from './export/gradientMapPreflight';
import { loadSettings } from './settings';

/** Resolve the default export colour space from settings. */
function defaultExportColorProfile(): 'srgb' | 'display-p3' | 'adobe-rgb' | 'pro-photo' {
  try {
    return loadSettings().export.defaultColorProfile;
  } catch {
    return 'srgb';
  }
}

export interface ExportFileReport {
  fileName: string;
  format: ExportFormat;
  nodeId: string;
  status: 'success' | 'failed';
  mimeType: string;
  byteCount: number;
  durationMs: number;
  savedPath?: string;
  error?: string;
  warnings: string[];
  /** Typed raster resource failures (missing/corrupt/CORS/...) from preflight. */
  resourceFailures?: import('./export/resourceReadiness').FailedResource[];
}

export interface ExportReport {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  totalJobs: number;
  successCount: number;
  failureCount: number;
  files: ExportFileReport[];
  /** Preflight findings computed before execution (informational surfacing). */
  findings?: ExportFinding[];
}

export type ExportStage =
  | 'preflight'
  | 'rendering'
  | 'encoding'
  | 'writing'
  | 'completed'
  | 'failed';

export interface ExportProgressEvent {
  stage: ExportStage;
  completed: number;
  failed: number;
  total: number;
  currentFile?: string;
}

export interface ExportRunContext {
  document: Document;
  engine?: Engine | null;
  saveFile?: (
    fileName: string,
    bytes: Uint8Array,
    mimeType: string,
    job: ExportJob,
  ) => Promise<string | null | undefined>;
  /** Receives actual executor transitions; never synthesized from elapsed time. */
  onProgress?: (event: ExportProgressEvent) => void;
}

interface RenderedExport {
  bytes: Uint8Array;
  mimeType: string;
  warnings: string[];
  /** Typed raster resource failures (missing/corrupt/CORS/...) from preflight. */
  resourceFailures?: import('./export/resourceReadiness').FailedResource[];
}

function abortError(): Error {
  const err = new Error('Export aborted');
  err.name = 'AbortError';
  return err;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof Response !== 'undefined') {
    return new Uint8Array(await new Response(blob).arrayBuffer());
  }
  if (typeof blob.text === 'function') {
    return encode(await blob.text());
  }
  throw new Error('Blob byte extraction is not supported in this environment');
}

function rasterMime(format: ExportFormat): RasterFormat | null {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

export function rasterScaleForJob(job: ExportJob, context: ExportRunContext): number {
  const node = context.document.nodes[job.nodeId];
  if (!node) return 1;
  const bbox = worldBBox(node, context.document);
  const baseWidth = Math.max(1, bbox.w);
  const baseHeight = Math.max(1, bbox.h);

  if (!job.scale) {
    return Math.max(1 / 16, job.dimensions.w / baseWidth);
  }

  switch (job.scale.type) {
    case 'factor':
      return Math.max(1 / 16, job.scale.value);
    case 'width':
      return Math.max(1 / 16, job.scale.pixels / baseWidth);
    case 'height':
      return Math.max(1 / 16, job.scale.pixels / baseHeight);
  }
}

/**
 * Check a node for missing/restricted fonts and return warning strings.
 */
function collectMissingFontWarnings(node: Document['nodes'][string]): string[] {
  const warnings: string[] = [];
  const registry = getFontRegistry();

  if (node.kind !== 'text') return warnings;

  // Check node-level font family
  const nodeFamily = (node as { fontFamily?: string }).fontFamily;
  if (nodeFamily && registry.isMissing(nodeFamily)) {
    warnings.push(
      `Font "${nodeFamily}" is not available on this device. ` +
        `Text using this font may appear differently.`,
    );
  }

  // Check rich text run fonts
  const richText = (
    node as {
      richText?: { paragraphs: Array<{ runs: Array<{ format?: { fontFamily?: string } }> }> };
    }
  ).richText;
  if (richText) {
    for (const para of richText.paragraphs) {
      for (const run of para.runs) {
        const runFamily = run.format?.fontFamily;
        if (runFamily && registry.isMissing(runFamily)) {
          if (!warnings.some((w) => w.includes(runFamily))) {
            warnings.push(
              `Font "${runFamily}" is not available on this device. ` +
                `Text in some runs may appear differently.`,
            );
          }
        }
      }
    }
  }

  return warnings;
}

async function renderJob(job: ExportJob, context: ExportRunContext): Promise<RenderedExport> {
  const node = context.document.nodes[job.nodeId];
  if (!node) throw new Error(`Node ${job.nodeId} was not found`);

  switch (job.format) {
    case 'svg':
    case 'svg-component': {
      const rasterAssets = await composeFlattenedRasterAssetsForNode(
        node,
        context.document,
        'svg',
        {
          scale: 1,
          engine: context.engine ?? undefined,
        },
      );
      const fontWarnings = collectMissingFontWarnings(node);
      return {
        bytes: encode(
          exportNodeToSvg(node, context.document, {
            rasterAssets,
            minify: job.vector?.minify ?? false,
            preserveColorSpace: job.vector?.embedImages === false,
          }),
        ),
        mimeType: 'image/svg+xml',
        warnings: [
          ...fontWarnings,
          ...collectGradientMapFlattenWarnings(node, context.document, 'svg'),
        ],
      };
    }
    case 'react-tailwind':
      return {
        bytes: encode(exportNodeToTailwind(node, context.document)),
        mimeType: 'text/tsx',
        warnings: collectMissingFontWarnings(node),
      };
    case 'react-cssmodules': {
      const result = exportNodeToCssModules(node, context.document);
      return {
        bytes: encode(`${result.jsx}\n\n/* CSS Module */\n${result.css}`),
        mimeType: 'text/tsx',
        warnings: collectMissingFontWarnings(node),
      };
    }
    case 'flutter':
      return {
        bytes: encode(exportNodeToFlutter(node, context.document)),
        mimeType: 'text/x-dart',
        warnings: collectMissingFontWarnings(node),
      };
    case 'swiftui':
      return {
        bytes: encode(exportNodeToSwiftUI(node, context.document)),
        mimeType: 'text/x-swift',
        warnings: collectMissingFontWarnings(node),
      };
    case 'pdf-screen': {
      const result = await exportNodeAsPdf(node, context.document, 1, context.engine ?? undefined);
      const fontWarnings = collectMissingFontWarnings(node);
      return {
        bytes: result.bytes,
        mimeType: 'application/pdf',
        warnings: [
          ...fontWarnings,
          ...collectGradientMapFlattenWarnings(node, context.document, 'pdf'),
        ],
      };
    }
    case 'pdf-x1a':
    case 'pdf-x4': {
      // Press output goes through the native CMYK/ICC print pipeline. This is
      // desktop-only; exportNodeAsPdfX throws with the capability label when
      // the Tauri bridge is absent rather than emitting an invalid press file.
      const result = await exportNodeAsPdfX(node, context.document, job.format, {
        bleedMm: job.print?.bleedMm,
        includeCropMarks: job.print?.includeCropMarks,
        includeRegistrationMarks: job.print?.includeRegistrationMarks,
        colorBars: job.print?.includeColorBars,
        enforceDpi: job.print?.enforceDpi,
        outlineText: job.print?.outlineText,
        iccProfile: job.print?.iccProfile,
      });
      return {
        bytes: result.bytes,
        mimeType: 'application/pdf',
        warnings: collectMissingFontWarnings(node),
      };
    }
    case 'avif': {
      const capability = capabilitiesForFormat('avif');
      throw new Error(
        capability.reasonUnsupported ?? 'AVIF export is not available in this runtime',
      );
    }
    default: {
      const mime = rasterMime(job.format);
      if (!mime) throw new Error(`Unsupported export format: ${job.format}`);
      if (!context.engine) throw new Error(`${job.format.toUpperCase()} export requires an engine`);
      const rasterOpts = job.raster;
      // Map canonical processing-stage contracts from the legacy job boundary
      // onto the engine pipeline. Structure is shared; only the resize stage
      // needs explicit target dimensions, which come from the rendered size.
      const pipeline = buildRasterPipeline(rasterOpts);
      const metadata = buildRasterMetadata(rasterOpts);
      // Colour policy: the legacy `colorProfile` option now drives a real
      // conversion + profile embedding; absent, the settings default applies.
      // 'srgb' keeps the prior behaviour exactly (no conversion, no tag).
      const chosenProfile = rasterOpts?.colorProfile ?? defaultExportColorProfile();
      const color =
        chosenProfile !== 'srgb' ? { destination: chosenProfile, embedProfile: true } : undefined;
      const {
        blob,
        warnings: rasterWarnings,
        resourceFailures,
      } = await exportNodeAsRaster(node, context.document, context.engine, {
        format: mime,
        scale: rasterScaleForJob(job, context),
        quality: rasterOpts?.quality ?? (job.format === 'jpg' ? 0.92 : undefined),
        transparency: rasterOpts?.transparency,
        matteColor: rasterOpts?.matteColor,
        pipeline,
        metadata,
        color,
      });
      const fontWarnings = collectMissingFontWarnings(node);
      return {
        bytes: await blobToBytes(blob),
        mimeType: blob.type || mime,
        warnings: [...fontWarnings, ...rasterWarnings],
        ...(resourceFailures.length > 0 ? { resourceFailures } : {}),
      };
    }
  }
}

/**
 * Build a font-availability set from the shared registry, or `undefined` when
 * the registry exposes no usable data (preflight then skips font checks).
 */
function availableFontFamilies(): Set<string> | undefined {
  try {
    const registry = getFontRegistry();
    const families = registry.families();
    return families.length > 0 ? new Set(families) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run the shared export preflight over a legacy batch. Converts jobs to
 * canonical configurations, so the plan, capabilities, and findings pipeline
 * apply to the existing dialog flow without a full migration.
 */
export function runBatchPreflight(
  batch: ExportBatch,
  document: Document,
  platform: PlatformKind = 'web',
): ExportFinding[] {
  const request = legacyBatchToRequest(batch);
  const result = runExportPreflight(document, request, {
    platform,
    availableFonts: availableFontFamilies(),
  });
  return result.findings;
}

/**
 * Build the canonical raster pipeline contract from legacy job raster options.
 * The resize stage only becomes active when a caller supplied explicit target
 * dimensions via the typed `resize` contract; otherwise it is omitted so the
 * existing vector-render path is untouched (no double resampling).
 */
function buildRasterPipeline(
  raster: ExportJob['raster'],
): import('@varve/engine').RasterPipelineOptions | undefined {
  const resize = raster?.resize;
  const sharpen = raster?.sharpen;
  const dither = raster?.dither;
  if (!resize && !sharpen && !dither) return undefined;
  return {
    ...(resize
      ? { resize: resize as import('@varve/engine').RasterPipelineOptions['resize'] }
      : {}),
    ...(sharpen ? { sharpen } : {}),
    ...(dither ? { dither } : {}),
  };
}

function buildRasterMetadata(raster: ExportJob['raster']):
  | {
      policy: import('@varve/scene/export').MetadataPolicy;
      content?: import('@varve/engine').MetadataContent;
    }
  | undefined {
  if (!raster?.metadataPolicy) return undefined;
  return {
    policy: raster.metadataPolicy,
    content: {
      title: undefined,
      keywords: [],
    },
  };
}

export const ExportService = {
  async run(
    batch: ExportBatch,
    context: ExportRunContext,
    signal?: AbortSignal,
    platform: PlatformKind = 'web',
  ): Promise<ExportReport> {
    assertNotAborted(signal);
    const startedAt = Date.now();
    const perfStarted = performance.now();
    const files: ExportFileReport[] = [];
    let completedJobs = 0;
    let failedJobs = 0;
    const emit = (stage: ExportStage, currentFile?: string) => {
      context.onProgress?.({
        stage,
        completed: completedJobs,
        failed: failedJobs,
        total: batch.jobs.length,
        currentFile,
      });
    };

    emit('preflight');
    const findings = runBatchPreflight(batch, context.document, platform);

    for (const job of batch.jobs) {
      assertNotAborted(signal);
      const jobStarted = performance.now();
      try {
        emit('rendering', job.fileName);
        const rendered = await renderJob(job, context);
        assertNotAborted(signal);
        // Render helpers return encoded bytes today. This event identifies the
        // real encode boundary without pretending to know fractional progress.
        emit('encoding', job.fileName);
        emit('writing', job.fileName);
        let saved: string | null | undefined;
        try {
          saved = await context.saveFile?.(job.fileName, rendered.bytes, rendered.mimeType, job);
        } catch (err) {
          // Permission denial (browser save dialog blocked) must not read as
          // "Export cancelled" — that hides the fix from the user.
          if (err instanceof Error && err.name === 'NotAllowedError') {
            throw new Error(
              'Save permission was denied; allow the browser save dialog, then export again.',
            );
          }
          throw err;
        }
        if (context.saveFile && saved === null) throw abortError();
        files.push({
          fileName: job.fileName,
          format: job.format,
          nodeId: job.nodeId,
          status: 'success',
          mimeType: rendered.mimeType,
          byteCount: rendered.bytes.byteLength,
          durationMs: performance.now() - jobStarted,
          savedPath: typeof saved === 'string' ? saved : undefined,
          warnings: rendered.warnings,
          ...(rendered.resourceFailures && rendered.resourceFailures.length > 0
            ? { resourceFailures: rendered.resourceFailures }
            : {}),
        });
        completedJobs += 1;
        emit('completed', job.fileName);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        files.push({
          fileName: job.fileName,
          format: job.format,
          nodeId: job.nodeId,
          status: 'failed',
          mimeType: 'application/octet-stream',
          byteCount: 0,
          durationMs: performance.now() - jobStarted,
          error: err instanceof Error ? err.message : 'Unknown export error',
          warnings: [],
        });
        failedJobs += 1;
        emit('failed', job.fileName);
      }
    }

    const completedAt = Date.now();
    const successCount = files.filter((f) => f.status === 'success').length;
    const failureCount = files.length - successCount;

    return {
      startedAt,
      completedAt,
      durationMs: performance.now() - perfStarted,
      totalJobs: batch.jobs.length,
      successCount,
      failureCount,
      files,
      findings,
    };
  },
};
