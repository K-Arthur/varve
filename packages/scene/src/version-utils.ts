// COMPLEXITY: 12 — constants, interfaces, stampVersion, serializeDocument,
// isForwardCompatible, detectForwardCompatWarning. All under 15-line functions.
import { normalizeLegacyBackgroundRemoval, stripEmbeddedAssetPayloads } from './version-migrations';

export const CURRENT_DOCUMENT_VERSION = '2.7';

export const SUPPORTED_VERSIONS = [
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '1.8',
  '1.9',
  '1.10',
  '2.0',
  '2.1',
  '2.2',
  '2.3',
  '2.4',
  '2.5',
  '2.6',
  '2.7',
];

export interface DocumentMigration {
  from: string;
  to: string;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

export interface MigrationResult {
  document: Record<string, unknown>;
  fromVersion: string;
  toVersion: string;
  migrated: boolean;
  warnings: string[];
}

function parseVersion(v: string): number[] {
  return v.split('.').map((s) => {
    const n = parseInt(s, 10);
    return Number.isNaN(n) ? 0 : n;
  });
}

export function isVersionLessThan(a: string, b: string): boolean {
  const [aMajor = 0, aMinor = 0] = parseVersion(a);
  const [bMajor = 0, bMinor = 0] = parseVersion(b);
  return aMajor < bMajor || (aMajor === bMajor && aMinor < bMinor);
}

export function stampVersion<T extends { formatVersion?: string }>(
  doc: T,
): T & { formatVersion: string } {
  return { ...doc, formatVersion: CURRENT_DOCUMENT_VERSION };
}

export function serializeDocument(doc: Record<string, unknown> | unknown): string {
  const target = doc as Record<string, unknown>;
  return JSON.stringify(
    stripEmbeddedAssetPayloads(stampVersion(normalizeLegacyBackgroundRemoval(target))),
  );
}

export function isForwardCompatible(fileVersion: string): boolean {
  const [fMajor = 0, fMinor = 0] = parseVersion(fileVersion);
  const [cMajor = 0, cMinor = 0] = parseVersion(CURRENT_DOCUMENT_VERSION);
  return fMajor < cMajor || (fMajor === cMajor && fMinor <= cMinor);
}

export function detectForwardCompatWarning(fileVersion: string): string | null {
  if (!isForwardCompatible(fileVersion)) {
    return `File version ${fileVersion} is newer than current version ${CURRENT_DOCUMENT_VERSION}. Some features may not be supported.`;
  }
  return null;
}
