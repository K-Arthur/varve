/**
 * Comparison projection for find/replace.
 *
 * Find/replace compares a *comparison representation* of the authored text
 * (NFC-normalized, optionally case-folded and diacritic-stripped) but every
 * edit must address the *original* UTF-16 offsets. Those two coordinate
 * systems are not the same: NFC composition, case folding, and combining-mark
 * stripping all change string length (`cafe\u0301` -> `café`, `İ` -> `i̇`).
 *
 * This module builds both representations together, once per text revision,
 * and exposes a total mapping from comparison offsets back to original
 * grapheme-cluster boundaries. Fold transformations are applied per extended
 * grapheme cluster, so a fold can never move across a cluster boundary.
 *
 * Research basis: UAX #15 (normalization), UAX #29 (grapheme clusters),
 * Intl.Segmenter. The grapheme walk reuses `@varve/engine`'s Unicode index map,
 * which already carries the UAX #29 fallback for runtimes without
 * `Intl.Segmenter`.
 */

import { createUnicodeIndexMap } from '@varve/engine';
import type { SearchOptions } from './types';

export interface ComparisonProjection {
  /** Authored text, unchanged. */
  readonly original: string;
  /** Comparison representation. */
  readonly comparison: string;
  /** Comparison cluster boundaries (length clusterCount + 1). */
  readonly comparisonBoundaries: readonly number[];
  /** Original cluster boundaries (length clusterCount + 1). */
  readonly originalBoundaries: readonly number[];
  /** True when no fold transformation changed any cluster. */
  readonly identity: boolean;
  /** True when the runtime offered no `Intl.Segmenter` and the fallback ran. */
  readonly degraded: boolean;
}

function stripCombiningMarks(value: string): string {
  // NFD splits canonical composites; Mn/Mc/Me are the combining classes. Only
  // marks that normalized out of a cluster are removed, never a base scalar.
  return value.normalize('NFD').replace(/\p{M}+/gu, '');
}

/** Fold a single cluster into its comparison form. */
function foldCluster(cluster: string, options: SearchOptions): string {
  let value = cluster.normalize('NFC');
  if (!options.matchDiacritics) value = stripCombiningMarks(value);
  if (!options.caseSensitive) value = value.toLowerCase();
  return value;
}

/**
 * Fold a whole query string with the same rules as {@link buildComparisonProjection}.
 * Regex mode is handled separately (see `matching.ts`) because normalizing a
 * regex subject or pattern would change its meaning.
 */
export function foldQuery(query: string, options: SearchOptions): string {
  if (options.useRegex) return query.normalize('NFC');
  return foldCluster(query, options);
}

export function buildComparisonProjection(
  original: string,
  options: SearchOptions,
): ComparisonProjection {
  if (options.useRegex) {
    // Regex compares against NFC-normalized text only. Case-insensitivity is
    // the regex `i` flag; diacritic-insensitivity is not expressible in the
    // ECMAScript regex dialect and is declared unsupported in regex mode.
    return foldIdentity(original, (value) => value.normalize('NFC'));
  }
  return foldIdentity(original, (cluster) => foldCluster(cluster, options));
}

function foldIdentity(original: string, fold: (cluster: string) => string): ComparisonProjection {
  const map = createUnicodeIndexMap(original);
  const comparisonParts: string[] = [];
  const comparisonBoundaries: number[] = [0];
  const originalBoundaries: number[] = [0];
  let comparisonLength = 0;
  let identity = true;

  for (const grapheme of map.graphemes) {
    const folded = fold(grapheme.segment);
    if (folded !== grapheme.segment) identity = false;
    comparisonParts.push(folded);
    comparisonLength += folded.length;
    comparisonBoundaries.push(comparisonLength);
    originalBoundaries.push(grapheme.index + grapheme.segment.length);
  }

  return {
    original,
    comparison: comparisonParts.join(''),
    comparisonBoundaries,
    originalBoundaries,
    identity,
    degraded: !hasGraphemeSegmenter(),
  };
}

function hasGraphemeSegmenter(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

function lowerBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Map a comparison range to original grapheme-cluster boundaries, expanding
 * outward. A match that begins or ends mid-cluster therefore covers whole
 * clusters in the original text; it can never split a grapheme.
 */
export function comparisonRangeToOriginal(
  projection: ComparisonProjection,
  comparisonStart: number,
  comparisonEnd: number,
): { start: number; end: number } {
  const boundaries = projection.originalBoundaries;
  const clusterCount = boundaries.length - 1;
  const startCluster = Math.min(
    clusterCount,
    Math.max(0, upperBound(projection.comparisonBoundaries, comparisonStart) - 1),
  );
  const endCluster = Math.min(
    clusterCount,
    Math.max(0, lowerBound(projection.comparisonBoundaries, comparisonEnd)),
  );
  const start = boundaries[startCluster] ?? 0;
  const end = Math.max(start, boundaries[endCluster] ?? projection.original.length);
  return { start, end };
}

/** Original UTF-16 offset before `index`, surrogate-pair aware. */
export function scalarBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1] ?? '';
}

/** Original UTF-16 offset at `index`, surrogate-pair aware. */
export function scalarAt(text: string, index: number): string {
  if (index >= text.length) return '';
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return text.slice(index, index + 2);
  }
  return text[index] ?? '';
}

/** Advance one code point, never splitting a surrogate pair. */
export function advanceScalar(text: string, index: number): number {
  if (index >= text.length) return text.length + 1;
  const high = text.charCodeAt(index);
  if (high >= 0xd800 && high <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (low >= 0xdc00 && low <= 0xdfff) return index + 2;
  }
  return index + 1;
}
