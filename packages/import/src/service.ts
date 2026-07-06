/**
 * ImportService — unified import orchestration and compatibility reporting.
 *
 * This sits above individual parsers. It never claims fidelity that a parser
 * cannot provide: every file receives structured warnings, unsupported feature
 * records, timing, size, and artifact metadata for UI/reporting surfaces.
 */

import type { Document } from '@strata/scene';
import { DocumentCodec } from '@strata/scene';
import { createAiParser } from './ai';
import { createEpsParser } from './eps';
import { importFile } from './import';
import { createPdfParser } from './pdf';
import { createPsdParser } from './psd';
import { getParserForData, getParserForExtension, registerParser } from './registry';
import { createSvgParser } from './svg';
import type { ImportOptions } from './types';

export type ImportSource = 'file-picker' | 'drop' | 'clipboard' | 'home' | 'asset-library' | 'api';

export interface ImportFileInput {
  name: string;
  source: ImportSource;
  size?: number;
  relativePath?: string;
  text?: string;
  bytes?: Uint8Array;
}

export interface FidelityIssue {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  path?: string;
}

export interface UnsupportedFeature {
  code: string;
  feature: string;
  message: string;
}

export interface ImportArtifact {
  kind: 'document-fragment';
  document: Document;
  nodeIds: string[];
}

export interface ImportFileReport {
  name: string;
  source: ImportSource;
  format: string;
  status: 'success' | 'partial' | 'failed' | 'unsupported';
  byteCount: number;
  durationMs: number;
  nodeCount: number;
  artifacts: ImportArtifact[];
  warnings: FidelityIssue[];
  unsupportedFeatures: UnsupportedFeature[];
  error?: string;
}

export interface ImportReport {
  startedAt: number;
  completedAt: number;
  durationMs: number;
  totalFiles: number;
  successCount: number;
  partialCount: number;
  failureCount: number;
  unsupportedCount: number;
  files: ImportFileReport[];
  warnings: FidelityIssue[];
}

export interface ImportServiceOptions extends Partial<ImportOptions> {
  onProgress?: (completed: number, total: number, file: ImportFileReport) => void;
}

let builtInsRegistered = false;

function ensureBuiltInsRegistered(): void {
  if (builtInsRegistered) return;
  registerParser(createSvgParser());
  registerParser(createPdfParser());
  registerParser(createPsdParser());
  registerParser(createAiParser());
  registerParser(createEpsParser());
  builtInsRegistered = true;
}

function abortError(): Error {
  const err = new Error('Import aborted');
  err.name = 'AbortError';
  return err;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function extension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && ext !== name.toLowerCase() ? ext : 'unknown';
}

function byteCount(input: ImportFileInput): number {
  if (typeof input.size === 'number') return input.size;
  if (input.bytes) return input.bytes.byteLength;
  if (typeof input.text === 'string') return new TextEncoder().encode(input.text).byteLength;
  return 0;
}

function dataFor(input: ImportFileInput): string | Uint8Array {
  if (input.bytes) return input.bytes;
  return input.text ?? '';
}

function isRasterFallbackFormat(format: string): boolean {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif'].includes(format);
}

function warning(message: string): FidelityIssue {
  return { code: 'parser.warning', message, severity: 'warning' };
}

async function importOne(
  input: ImportFileInput,
  options: ImportServiceOptions,
  signal?: AbortSignal,
): Promise<ImportFileReport> {
  assertNotAborted(signal);
  const started = performance.now();
  const data = dataFor(input);
  const format = extension(input.name);
  ensureBuiltInsRegistered();
  const parser = getParserForExtension(format) ?? getParserForData(data);

  if (!parser && !(data instanceof Uint8Array && isRasterFallbackFormat(format))) {
    return {
      name: input.name,
      source: input.source,
      format,
      status: 'unsupported',
      byteCount: byteCount(input),
      durationMs: performance.now() - started,
      nodeCount: 0,
      artifacts: [],
      warnings: [],
      unsupportedFeatures: [
        {
          code: 'format.unsupported',
          feature: format,
          message: `No importer is registered for ${format}`,
        },
      ],
    };
  }

  try {
    const result = importFile(input.name, data, options);
    assertNotAborted(signal);
    const normalized = DocumentCodec.normalize(result.document);
    const warnings = [
      ...result.warnings.map(warning),
      ...normalized.warnings.map((w) => ({
        code: w.code,
        message: w.message,
        severity: w.severity,
        path: w.path,
      })),
    ];
    return {
      name: input.name,
      source: input.source,
      format: parser?.format ?? format,
      status: result.nodeIds.length > 0 ? 'success' : 'partial',
      byteCount: byteCount(input),
      durationMs: performance.now() - started,
      nodeCount: result.nodeIds.length,
      artifacts: [
        {
          kind: 'document-fragment',
          document: normalized.document,
          nodeIds: result.nodeIds,
        },
      ],
      warnings,
      unsupportedFeatures: [],
    };
  } catch (err) {
    return {
      name: input.name,
      source: input.source,
      format,
      status: 'failed',
      byteCount: byteCount(input),
      durationMs: performance.now() - started,
      nodeCount: 0,
      artifacts: [],
      warnings: [],
      unsupportedFeatures: [],
      error: err instanceof Error ? err.message : 'Unknown import error',
    };
  }
}

export const ImportService = {
  async importFiles(
    inputs: ImportFileInput[],
    options: ImportServiceOptions = {},
    signal?: AbortSignal,
  ): Promise<ImportReport> {
    assertNotAborted(signal);
    const startedAt = Date.now();
    const perfStarted = performance.now();
    const files: ImportFileReport[] = [];

    for (const input of inputs) {
      const fileReport = await importOne(input, options, signal);
      files.push(fileReport);
      options.onProgress?.(files.length, inputs.length, fileReport);
    }

    const completedAt = Date.now();
    const successCount = files.filter((f) => f.status === 'success').length;
    const partialCount = files.filter((f) => f.status === 'partial').length;
    const unsupportedCount = files.filter((f) => f.status === 'unsupported').length;
    const failureCount = files.filter(
      (f) => f.status === 'failed' || f.status === 'unsupported',
    ).length;

    return {
      startedAt,
      completedAt,
      durationMs: performance.now() - perfStarted,
      totalFiles: inputs.length,
      successCount,
      partialCount,
      failureCount,
      unsupportedCount,
      files,
      warnings: files.flatMap((f) => f.warnings),
    };
  },
};
