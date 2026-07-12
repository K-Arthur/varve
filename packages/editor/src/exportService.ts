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
import type { Document, ExportBatch, ExportFormat, ExportJob } from '@strata/scene';
import {
  exportNodeAsPdf,
  exportNodeAsRaster,
  type RasterFormat,
} from './components/SpecPanel/export';
import { worldBBox } from './components/SpecPanel/measurement';

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

async function renderJob(job: ExportJob, context: ExportRunContext): Promise<RenderedExport> {
  const node = context.document.nodes[job.nodeId];
  if (!node) throw new Error(`Node ${job.nodeId} was not found`);

  switch (job.format) {
    case 'svg':
    case 'svg-component':
      return {
        bytes: encode(exportNodeToSvg(node, context.document)),
        mimeType: 'image/svg+xml',
        warnings: [],
      };
    case 'react-tailwind':
      return {
        bytes: encode(exportNodeToTailwind(node, context.document)),
        mimeType: 'text/tsx',
        warnings: [],
      };
    case 'react-cssmodules': {
      const result = exportNodeToCssModules(node, context.document);
      return {
        bytes: encode(`${result.jsx}\n\n/* CSS Module */\n${result.css}`),
        mimeType: 'text/tsx',
        warnings: [],
      };
    }
    case 'flutter':
      return {
        bytes: encode(exportNodeToFlutter(node, context.document)),
        mimeType: 'text/x-dart',
        warnings: [],
      };
    case 'swiftui':
      return {
        bytes: encode(exportNodeToSwiftUI(node, context.document)),
        mimeType: 'text/x-swift',
        warnings: [],
      };
    case 'pdf-screen': {
      const result = await exportNodeAsPdf(node, context.document, 1);
      return {
        bytes: result.bytes,
        mimeType: 'application/pdf',
        warnings: [],
      };
    }
    case 'pdf-x1a':
    case 'pdf-x4':
      throw new Error(`${job.format} export is available through the print pipeline only`);
    case 'avif':
      throw new Error('AVIF export is not available in this runtime');
    default: {
      const mime = rasterMime(job.format);
      if (!mime) throw new Error(`Unsupported export format: ${job.format}`);
      if (!context.engine) throw new Error(`${job.format.toUpperCase()} export requires an engine`);
      const { blob, warnings } = await exportNodeAsRaster(node, context.document, context.engine, {
        format: mime,
        scale: rasterScaleForJob(job, context),
        quality: job.format === 'jpg' ? 0.92 : undefined,
      });
      return {
        bytes: await blobToBytes(blob),
        mimeType: blob.type || mime,
        warnings,
      };
    }
  }
}

export const ExportService = {
  async run(
    batch: ExportBatch,
    context: ExportRunContext,
    signal?: AbortSignal,
  ): Promise<ExportReport> {
    assertNotAborted(signal);
    const startedAt = Date.now();
    const perfStarted = performance.now();
    const files: ExportFileReport[] = [];

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
    };
  },
};
