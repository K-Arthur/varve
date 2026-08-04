/**
 * Technical grouping fingerprint for crash deduplication and triage.
 *
 * Built from normalized exception type, top sanitized stack modules, crash
 * category, release, and runtime. Never includes user identity, document
 * names, paths, IPs, or any persistent device identifier. The fingerprint is
 * a compact hash of technical fields only — it cannot be used to correlate
 * sessions across releases or to identify a user.
 */

import type { CrashReport } from './schema';

/** FNV-1a 32-bit hash — compact, deterministic, non-cryptographic. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export const FINGERPRINT_MAX_LENGTH = 80;

/** Top frame modules that contribute to grouping (bounded, sanitized). */
const GROUP_FRAME_COUNT = 5;

export function computeGroupFingerprint(report: CrashReport): string {
  const type = report.crash.type;
  const category = report.crash.category.slice(0, 60);
  const frames = report.crash.stack
    .slice(0, GROUP_FRAME_COUNT)
    .map((f) => f.module.slice(0, 40))
    .join('|');
  const release = report.release.releaseId.slice(0, 40);
  const runtime = report.runtime.runtime;
  const subsystem = report.crash.subsystem ? `:${report.crash.subsystem.slice(0, 40)}` : '';
  const material = `${type}:${category}:${runtime}:${release}:${subsystem}:${frames}`;
  return `g-${fnv1a(material)}`.slice(0, FINGERPRINT_MAX_LENGTH);
}

/** Groups a list of reports by fingerprint for dedup reporting. */
export function groupByFingerprint(reports: CrashReport[]): Map<string, CrashReport[]> {
  const groups = new Map<string, CrashReport[]>();
  for (const report of reports) {
    const key = report.groupFingerprint ?? computeGroupFingerprint(report);
    const bucket = groups.get(key);
    if (bucket) bucket.push(report);
    else groups.set(key, [report]);
  }
  return groups;
}
