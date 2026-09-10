import type { ArchiveEntry, ArchivePackage } from './types';

export interface ArchiveBuilder {
  addEntry(path: string, data: string, contentType: ArchiveEntry['contentType']): void;
  addBinaryEntry(path: string, data: Uint8Array, contentType: ArchiveEntry['contentType']): void;
  build(): Promise<Uint8Array>;
  entryCount: number;
}

export interface ArchiveExtractor {
  entries(): ArchiveEntry[];
  readEntry(path: string): Promise<string | null>;
  readBinaryEntry(path: string): Promise<Uint8Array | null>;
  manifest: ArchivePackage;
}

export interface ArchiveError {
  entry: string;
  message: string;
}

export interface ArchiveImportResult {
  success: boolean;
  errors: ArchiveError[];
  importedCount: number;
  manifest: ArchivePackage;
  warnings: string[];
}

export function detectArchiveType(data: Uint8Array): 'strata-backup' | 'unknown' {
  const header = new TextDecoder().decode(data.slice(0, 64));
  if (header.includes('"archiveType"')) return 'strata-backup';
  return 'unknown';
}

export function validateArchiveImport(data: Uint8Array): ArchiveImportResult {
  try {
    const text = new TextDecoder().decode(data);
    const pkg: ArchivePackage = JSON.parse(text);
    if (!pkg.formatVersion || !pkg.archiveType || !pkg.entries) {
      return {
        success: false,
        errors: [{ entry: '<root>', message: 'Invalid archive format' }],
        importedCount: 0,
        manifest: pkg,
        warnings: ['Malformed archive structure'],
      };
    }
    const errors: ArchiveError[] = [];
    const warnings: string[] = [];

    for (const entry of pkg.entries) {
      if (entry.path.includes('..')) {
        errors.push({ entry: entry.path, message: 'Path traversal detected' });
      }
    }

    const MAX_ENTRIES = 10_000;
    if (pkg.entries.length > MAX_ENTRIES) {
      errors.push({ entry: '<root>', message: `Archive too many entries: ${pkg.entries.length}` });
    }

    const MAX_TOTAL_SIZE = 10 * 1024 * 1024 * 1024;
    if (pkg.totalUncompressedSize > MAX_TOTAL_SIZE) {
      errors.push({ entry: '<root>', message: 'Archive exceeds 10GB limit' });
    }

    return {
      success: errors.length === 0,
      errors,
      importedCount: pkg.entries.length,
      manifest: pkg,
      warnings,
    };
  } catch (e) {
    return {
      success: false,
      errors: [{ entry: '<root>', message: `Failed to parse: ${(e as Error).message}` }],
      importedCount: 0,
      manifest: null as unknown as ArchivePackage,
      warnings: ['Unparseable archive'],
    };
  }
}
