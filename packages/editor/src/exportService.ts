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
} from '@strata/codegen';
import type { Engine } from '@strata/engine';
import { getFontRegistry } from '@strata/engine';
import type { Document, ExportBatch, ExportFormat, ExportJob } from '@strata/scene';
import {
  capabilitiesForFormat,
  type ExportFinding,
  legacyBatchToRequest,
  type PlatformKind,
  runExportPreflight,
} from '@strata/scene/export';
import {
  exportNodeAsPdf,
  exportNodeAsPdfX,
  exportNodeAsRaster,
  type RasterFormat,
} from './components/SpecPanel/export';
import { worldBBox } from './components/SpecPanel/measurement';
import { composeFlattenedRasterAssetsForNode } from './export/compositor';

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

export interface ExportRunContext {
  document: Document;
  engine?: Engine | null;
  saveFile?: (
    fileName: string,
    bytes: Uint8Array,
    mimeType: string,
    job: ExportJob,
  ) => Promise<string | null | undefined>;
}

interface RenderedExport {
  bytes: Uint8Array;
  mimeType: string;
  warnings: string[];
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
        bytes: encode(exportNodeToSvg(node, context.document, { rasterAssets })),
        mimeType: 'image/svg+xml',
        warnings: fontWarnings,
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
        warnings: fontWarnings,
      };
    }
    case 'pdf-x1a':
    case 'pdf-x4': {
      // Press output goes through the native CMYK/ICC print pipeline. This is
      // desktop-only; exportNodeAsPdfX throws with the capability label when
      // the Tauri bridge is absent rather than emitting an invalid press file.
      const result = await exportNodeAsPdfX(node, context.document, job.format);
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
      const { blob, warnings: rasterWarnings } = await exportNodeAsRaster(
        node,
        context.document,
        context.engine,
        {
          format: mime,
          scale: rasterScaleForJob(job, context),
          quality: job.format === 'jpg' ? 0.92 : undefined,
        },
      );
      const fontWarnings = collectMissingFontWarnings(node);
      return {
        bytes: await blobToBytes(blob),
        mimeType: blob.type || mime,
        warnings: [...fontWarnings, ...rasterWarnings],
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
    const findings = runBatchPreflight(batch, context.document, platform);

    for (const job of batch.jobs) {
      assertNotAborted(signal);
      const jobStarted = performance.now();
      try {
        const rendered = await renderJob(job, context);
        assertNotAborted(signal);
        const saved = await context.saveFile?.(
          job.fileName,
          rendered.bytes,
          rendered.mimeType,
          job,
        );
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
        });
      } catch (err) {
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
