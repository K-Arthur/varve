/**
 * ImportService — unified import orchestration and compatibility reporting.
 *
 * This sits above individual parsers. It never claims fidelity that a parser
 * cannot provide: every file receives structured warnings, unsupported feature
 * records, timing, size, and artifact metadata for UI/reporting surfaces.
 */

import type { Document } from '@varve/scene';
import { DocumentCodec } from '@varve/scene';
import { createAiParser } from './ai';
import { detectImageMime } from './bitmap';
import { createEpsParser } from './eps';
import { createFigmaParser } from './figma';
import { importFile } from './import';
import { createPdfParser } from './pdf';
import { createPsdParser } from './psd';
import { inspectRasterBytes } from './rasterInspection';
import { getParserForData, getParserForExtension, registerParser } from './registry';
import { createSketchParser } from './sketch';
import { createSvgParser } from './svg';
import type { ImportOptions } from './types';
import { validateImport } from './validation';

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
  registerParser(createFigmaParser());
  registerParser(createSketchParser());
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

function featureCode(feature: string): string {
  return `feature.${feature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')}`;
}

function unsupportedFeature(feature: string): UnsupportedFeature {
  return {
    code: featureCode(feature),
    feature,
    message: feature,
  };
}

function dedupeWarnings(warnings: FidelityIssue[]): FidelityIssue[] {
  const seen = new Set<string>();
  const result: FidelityIssue[] = [];
  for (const item of warnings) {
    const key = `${item.code}:${item.path ?? ''}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
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
  const reportFormat = parser?.format ?? format;
  const rasterCandidate =
    data instanceof Uint8Array &&
    (isRasterFallbackFormat(format) || detectImageMime(data) !== null);

  if (!parser && !rasterCandidate) {
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
    if (!parser && data instanceof Uint8Array) inspectRasterBytes(data);
    const validation = parser ? await validateImport(data, input.name) : null;
    assertNotAborted(signal);
    const result = importFile(input.name, data, options);
    assertNotAborted(signal);
    const normalized = DocumentCodec.normalize(result.document);
    // Parser-level degradation is more precise than the cheap preflight
    // heuristic.  Keep both: validation catches format-level risks while the
    // parser reports what this particular document actually lost.
    const unsupportedFeatures = dedupeUnsupportedFeatures([
      ...(validation?.unsupportedFeatures.map(unsupportedFeature) ?? []),
      ...(result.unsupportedFeatures?.map(unsupportedFeature) ?? []),
    ]);
    const warnings = dedupeWarnings([
      ...(validation?.warnings.map(warning) ?? []),
      ...result.warnings.map(warning),
      ...normalized.warnings.map((w) => ({
        code: w.code,
        message: w.message,
        severity: w.severity,
        path: w.path,
      })),
    ]);
    const opaqueBinary = unsupportedFeatures.some(
      (feature) => feature.feature === 'opaque native .fig binary',
    );
    const status = opaqueBinary
      ? 'unsupported'
      : result.nodeIds.length === 0
        ? unsupportedFeatures.length > 0
          ? 'partial'
          : 'failed'
        : unsupportedFeatures.length === 0
          ? 'success'
          : 'partial';
    return {
      name: input.name,
      source: input.source,
      format: reportFormat,
      status,
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
      unsupportedFeatures,
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

function dedupeUnsupportedFeatures(features: UnsupportedFeature[]): UnsupportedFeature[] {
  const seen = new Set<string>();
  const result: UnsupportedFeature[] = [];
  for (const feature of features) {
    const key = `${feature.code}:${feature.feature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(feature);
  }
  return result;
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
