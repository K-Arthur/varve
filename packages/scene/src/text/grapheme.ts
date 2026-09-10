/**
 * Grapheme-cluster utilities for glyph-level typography.
 *
 * Cluster identity is the grapheme-cluster index (UAX #29) of the node's
 * text — stable across font, size, kerning, and ligature changes. These
 * helpers are dependency-free (Intl.Segmenter with a UTF-16 code-unit
 * fallback) so both the scene package and the editor can share them.
 */

/** Split text into grapheme clusters (no empty segments). */
export function graphemeClusters(text: string): string[] {
  if (text.length === 0) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(text));
    if (segments.length > 0) {
      return segments.map((segment) => segment.segment);
    }
  }
  // Fallback: code points (splits combining marks that Intl would merge).
  return Array.from(text);
}

/** Number of grapheme clusters in the text. */
export function graphemeClusterCount(text: string): number {
  return graphemeClusters(text).length;
}

/** UTF-16 offset of the start of cluster `index` in `text`. */
export function clusterStartUtf16(text: string, index: number): number {
  let offset = 0;
  let current = 0;
  for (const cluster of graphemeClusters(text)) {
    if (current === index) return offset;
    offset += cluster.length;
    current += 1;
  }
  return text.length;
}

/** Cluster index containing the UTF-16 offset (clamped to last cluster). */
export function clusterIndexAtUtf16(text: string, offset: number): number {
  const clusters = graphemeClusters(text);
  if (clusters.length === 0) return 0;
  let running = 0;
  for (let i = 0; i < clusters.length; i += 1) {
    const cluster = clusters[i] as string;
    if (offset < running + cluster.length) return i;
    running += cluster.length;
  }
  return clusters.length - 1;
}

/** Label for a cluster index (e.g. `'m'`, `'é'`) for UI display. */
export function clusterLabel(text: string, index: number): string {
  const clusters = graphemeClusters(text);
  const cluster = clusters[index];
  if (cluster === undefined) return '—';
  if (cluster.trim().length === 0) return cluster.includes('\n') ? '⏎' : '␣';
  return cluster;
}
