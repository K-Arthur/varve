/**
 * Stable Finding Fingerprint — collision-resistant identity for audit findings.
 *
 * A fingerprint survives re-scans, app restarts, and document save/load cycles.
 * It changes only when the rule's semantics change (ruleVersion bump) or the
 * subject genuinely differs (different node, different property, etc.).
 *
 * Design:
 *   fingerprint = hash128(ruleId + NUL + ruleVersion + NUL + normalizedSubject + NUL + discriminator)
 *
 * The normalized subject is a deterministic string representation of the
 * FindingSubject discrimated union. The discriminator is a per-rule string
 * that captures "what makes two findings about the same subject distinct" —
 * e.g., for a contrast rule it encodes the two color roles (text color vs.
 * background color), NOT the actual color values.
 *
 * Cross-platform guarantee:
 *   - Uses FNV-1a 64-bit × 2 (128-bit total) — pure arithmetic, no
 *     Math.random, Date.now, or object-key iteration order dependence
 *   - Codepoint sort for any array normalization
 *   - Deterministic across all JS engines (no BigInt overflow ambiguity:
 *     we mask to 64 bits explicitly)
 */

import type { NodeId } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Opaque, stable, collision-resistant fingerprint string (128-bit hex). */
export type FindingFingerprint = string & { __brand: 'FindingFingerprint' };

/** Identifies what a finding is about — the subject of the audit concern. */
export type FindingSubject =
  | { kind: 'node'; nodeId: NodeId; property?: string }
  | { kind: 'nodePair'; a: NodeId; b: NodeId }
  | { kind: 'nodeSet'; nodeIds: NodeId[] }
  | { kind: 'document' }
  | { kind: 'page'; pageId: string };

// ---------------------------------------------------------------------------
// 128-bit deterministic hash (FNV-1a 64-bit × 2)
// ---------------------------------------------------------------------------

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Compute a 128-bit FNV-1a hash of the input string.
 * Produces a 32-character hex string (16 hex chars × 2 = 128 bits).
 * Deterministic across all JS engines.
 */
export function hash128(input: string): string {
  let h1 = FNV_OFFSET_64;
  let h2 = FNV_OFFSET_64 ^ 0x9e3779b97f4a7c15n;

  for (let i = 0; i < input.length; i++) {
    const code = BigInt(input.charCodeAt(i));
    h1 ^= code;
    h1 = (h1 * FNV_PRIME_64) & MASK_64;
    h2 ^= code;
    h2 = (h2 * FNV_PRIME_64) & MASK_64;
  }

  return h1.toString(16).padStart(16, '0') + h2.toString(16).padStart(16, '0');
}

/** Dev-mode collision detector. Call after batch fingerprinting. */
export function assertNoCollisions(
  fingerprints: readonly FindingFingerprint[],
  labels?: readonly string[],
): void {
  if (process.env.NODE_ENV === 'production') return;
  const seen = new Map<string, number>();
  fingerprints.forEach((fp, i) => {
    const existing = seen.get(fp);
    if (existing !== undefined) {
      const a = labels?.[existing] ?? `index ${existing}`;
      const b = labels?.[i] ?? `index ${i}`;
      console.error(
        `[fingerprint] COLLISION: "${fp}" produced by both ${a} and ${b}. ` +
          `Hash input collision — consider adding more discriminator data.`,
      );
    }
    seen.set(fp, i);
  });
}

// ---------------------------------------------------------------------------
// Subject normalization
// ---------------------------------------------------------------------------

/**
 * Convert a FindingSubject to a deterministic string suitable for hashing.
 * Uses codepoint sort for arrays to ensure order-independence.
 */
export function normalizeSubject(subject: FindingSubject): string {
  switch (subject.kind) {
    case 'node':
      return subject.property !== undefined
        ? `node:${subject.nodeId}:${subject.property}`
        : `node:${subject.nodeId}`;
    case 'nodePair': {
      const [a, b] = subject.a < subject.b ? [subject.a, subject.b] : [subject.b, subject.a];
      return `nodePair:${a}:${b}`;
    }
    case 'nodeSet': {
      const sorted = [...subject.nodeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `nodeSet:${sorted.join(',')}`;
    }
    case 'document':
      return 'document';
    case 'page':
      return `page:${subject.pageId}`;
  }
}

// ---------------------------------------------------------------------------
// Fingerprint computation
// ---------------------------------------------------------------------------

const NUL = '\0';

/**
 * Compute a stable fingerprint for a finding.
 *
 * @param ruleId - Rule identifier (e.g. 'contrast/aa-fail')
 * @param ruleVersion - Rule schema version (bump to invalidate all fingerprints)
 * @param subject - What the finding is about
 * @param discriminator - Rule-specific string distinguishing findings on the
 *   same subject (e.g. color role pair, not the color values themselves)
 */
export function computeFingerprint(
  ruleId: string,
  ruleVersion: number,
  subject: FindingSubject,
  discriminator: string,
): FindingFingerprint {
  const input = [ruleId, String(ruleVersion), normalizeSubject(subject), discriminator].join(NUL);
  return hash128(input) as FindingFingerprint;
}

/**
 * Build a FindingSubject from a finding's nodeId/pageId.
 * For single-node findings. Rule discriminators can override or refine this.
 */
export function subjectFromFinding(finding: { nodeId?: NodeId; pageId?: string }): FindingSubject {
  if (finding.nodeId !== undefined) {
    return { kind: 'node', nodeId: finding.nodeId };
  }
  if (finding.pageId !== undefined) {
    return { kind: 'page', pageId: finding.pageId };
  }
  return { kind: 'document' };
}

/**
 * Check if two fingerprints are equivalent.
 * Currently just exact string comparison. Could be extended for fuzzy
 * matching (e.g. truncation to N hex chars for category-level grouping).
 */
export function fingerprintsAreEquivalent(a: FindingFingerprint, b: FindingFingerprint): boolean {
  return a === b;
}
