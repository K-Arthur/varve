/**
 * Token source discovery and multi-file merging (ADR-0107).
 *
 * Pure logic for Phase 1-2 sources: a single DTCG file or a directory with
 * entry files, include/exclude patterns, and a resolver document. Multiple
 * token files merge last-wins in entry order (same semantics as resolver
 * sets). Never auto-imports every JSON file in a repository.
 */

import { parseFormatDocument } from './parse';
import type { ResolverDocument } from './resolver';
import type { DtcgDocument, TokenDiagnostic } from './types';

export interface SourceDiscoveryOptions {
  /** Entry files to parse (absolute or root-relative paths). */
  entryFiles: string[];
  /** Resolver document path, when the source is a resolver project. */
  resolverFile?: string;
  /** Glob patterns: include beats exclude. */
  include?: string[];
  exclude?: string[];
}

export interface DiscoveredFile {
  fileId: string;
  kind: 'token' | 'resolver';
}

export interface MergedSource {
  /** Last-wins merged token document. */
  document: DtcgDocument;
  resolver?: ResolverDocument;
  diagnostics: TokenDiagnostic[];
  /** Files that were parsed, in order. */
  parsedFiles: string[];
  /** Candidate token files that were skipped by include/exclude. */
  skippedFiles: string[];
}

/**
 * Detect candidate token files among a directory listing.
 * Only .tokens / .tokens.json / .resolver.json / .json files with DTCG
 * entry signatures are candidates; include/exclude patterns filter them.
 */
export function detectTokenFiles(
  files: readonly string[],
  options: { include?: string[]; exclude?: string[]; entryFiles?: string[] } = {},
): { candidates: string[]; skipped: string[] } {
  const entryFiles = new Set(options.entryFiles ?? []);
  const candidates: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const base = basename(file);
    const isTokenFile = base.endsWith('.tokens.json') || base.endsWith('.tokens');
    const isResolverFile = base.endsWith('.resolver.json');
    const isGenericJson = base.endsWith('.json') && /token/i.test(base);
    if (!isTokenFile && !isResolverFile && !isGenericJson && !entryFiles.has(file)) continue;
    if (options.exclude?.some((pattern) => globMatch(pattern, file))) {
      skipped.push(file);
      continue;
    }
    if (
      options.include &&
      options.include.length > 0 &&
      !options.include.some((pattern) => globMatch(pattern, file))
    ) {
      skipped.push(file);
      continue;
    }
    candidates.push(file);
  }
  return { candidates, skipped };
}

/**
 * Parse and merge multiple token files into one document.
 * Files merge in order, last wins (resolver-set semantics). Structural
 * errors in any file are reported; the merge continues with valid files.
 */
export function mergeTokenFiles(files: ReadonlyArray<{ fileId: string; text: string }>): {
  document: DtcgDocument;
  diagnostics: TokenDiagnostic[];
  parsedFiles: string[];
} {
  const diagnostics: TokenDiagnostic[] = [];
  const parsedFiles: string[] = [];
  const mergedTree: Record<string, unknown> = {};
  for (const file of files) {
    const doc = parseFormatDocument(file.text, { sourceFileId: file.fileId });
    diagnostics.push(...doc.diagnostics);
    const hasErrors = doc.diagnostics.some((d) => d.severity === 'error');
    if (hasErrors) continue;
    const tree = doc.sourceRoot as Record<string, unknown> | undefined;
    if (!tree) continue;
    parsedFiles.push(file.fileId);
    mergeTrees(mergedTree, tree);
  }
  const mergedText = JSON.stringify(mergedTree);
  const document = parseFormatDocument(mergedText, { sourceFileId: 'merged-source' });
  return { document, diagnostics: [...diagnostics, ...document.diagnostics], parsedFiles };
}

/** Deep last-wins merge (identical to resolver flattening). */
function mergeTrees(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      mergeTrees(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

/** Minimal glob matcher: supports `*` (within a segment) and `**` (any
 * depth). Case-sensitive. No shell semantics. */
export function globMatch(pattern: string, path: string): boolean {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '(?:[^/]*/)*';
        i += 2;
        if (pattern[i] === '/') i += 1; // '**/' consumes its separator
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`${out}$`).test(path);
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export type { DtcgDocument, ResolverDocument };
