/**
 * Archive restorer — extracts and validates archive ZIP contents,
 * with optional decryption and conflict detection.
 *
 * Validates manifest version compatibility, verifies checksums,
 * decodes documents through DocumentCodec, and reports warnings
 * for any issues found during extraction.
 *
 * Research basis: Figma file import validation, VS Code profile import,
 * Chrome profile restore with conflict resolution.
 */

import { type Document, DocumentCodec } from '@varve/scene';
import { unzipSync } from 'fflate';
import type {
  ArchiveConflict,
  ArchiveManifest,
  ArchiveRestoreOptions,
  ArchiveRestoreResult,
  SettingsBackupEntry,
  SettingsCategory,
} from './archiveTypes';
import { ARCHIVE_FORMAT_VERSION } from './archiveTypes';
import { decryptBytes, verifyChecksum } from './encryption';
import { applySettingsBackup, validateSettingsEntry } from './settingsBackup';

/** Maximum uncompressed archive size (100 MB) */
const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024;

/** Maximum number of entries in the archive */
const MAX_ENTRY_COUNT = 1000;

/**
 * Maximum uncompressed size for a single archive entry (200 MB). Checked
 * against the ZIP local header's declared original size *before* fflate
 * inflates the entry, so a maliciously crafted small ZIP with an extreme
 * compression ratio (a decompression bomb) is rejected without ever
 * allocating the expanded buffer.
 */
const MAX_ENTRY_UNCOMPRESSED_SIZE = 200 * 1024 * 1024;

/** Reject `..` segments and absolute paths (POSIX or Windows-drive-letter). */
function isSafeArchivePath(name: string): boolean {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.startsWith('\\') ||
    name.includes('\0') ||
    [...name].some((character) => character.charCodeAt(0) < 0x20)
  )
    return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  const parts = name.split(/[/\\]/);
  return !parts.some(
    (segment) =>
      segment.length === 0 || segment === '.' || segment === '..' || segment.includes(':'),
  );
}

/**
 * Unzip with decompression-bomb and path-traversal guards. Rejects the
 * whole archive (rather than silently skipping entries) so restore never
 * partially applies content from a hostile archive.
 */
function safeUnzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let rejectionReason: string | null = null;
  const files = unzipSync(bytes, {
    filter(file) {
      if (rejectionReason) return false;
      if (!isSafeArchivePath(file.name)) {
        rejectionReason = `Archive entry has an unsafe path: ${file.name}`;
        return false;
      }
      if (file.originalSize > MAX_ENTRY_UNCOMPRESSED_SIZE) {
        rejectionReason = `Archive entry exceeds the maximum allowed size (possible decompression bomb): ${file.name}`;
        return false;
      }
      return true;
    },
  });
  if (rejectionReason) throw new Error(rejectionReason);
  return files;
}

/**
 * Restore from an archive buffer. This is the main entry point for restore.
 */
export async function restoreArchive(
  options: ArchiveRestoreOptions,
): Promise<ArchiveRestoreResult> {
  const { bytes, password, onConflict, onProgress, signal } = options;
  const warnings: string[] = [];
  const conflicts: ArchiveConflict[] = [];
  let restoredCategories: SettingsCategory[] = [];

  onProgress?.('validating', 0.1);

  // 1. Validate archive size
  if (bytes.byteLength > MAX_ARCHIVE_SIZE) {
    throw new Error('Archive exceeds maximum size');
  }
  if (bytes.byteLength === 0) {
    throw new Error('Archive is empty');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 2. Try to decrypt if password provided
  onProgress?.('decrypting', 0.2);
  let archiveBytes: Uint8Array;
  if (password) {
    try {
      archiveBytes = await decryptBytes(bytes, password);
    } catch {
      throw new Error('Decryption failed — wrong password or corrupted data');
    }
  } else {
    archiveBytes = bytes;
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 3. Unzip
  onProgress?.('extracting', 0.3);
  let files: Record<string, Uint8Array>;
  try {
    files = safeUnzip(archiveBytes);
  } catch (err) {
    if (err instanceof Error && /unsafe path|decompression bomb/i.test(err.message)) throw err;
    throw new Error('Invalid ZIP archive');
  }

  const entryCount = Object.keys(files).length;
  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error('Archive contains too many entries');
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 4. Parse manifest
  onProgress?.('reading-manifest', 0.4);
  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) {
    throw new Error('Archive missing manifest.json');
  }

  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ArchiveManifest;
  } catch {
    throw new Error('Invalid manifest.json');
  }

  // 5. Validate manifest
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    throw new Error(`Invalid manifest: ${validation.error}`);
  }

  // 6. Verify checksums
  onProgress?.('verifying-checksums', 0.5);
  for (const [path, expectedHash] of Object.entries(manifest.checksums)) {
    const fileBytes = files[path];
    if (!fileBytes) {
      warnings.push(`Missing file for checksum: ${path}`);
      continue;
    }
    if (!(await verifyChecksum(fileBytes, expectedHash))) {
      warnings.push(`Checksum mismatch for ${path}`);
    }
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 7. Extract document
  let document: Document | undefined;
  if (manifest.kind === 'full') {
    onProgress?.('decoding-document', 0.6);
    const docResult = extractArchiveDocument(manifest, files);
    if (docResult.document) {
      document = docResult.document;
    }
    warnings.push(...docResult.warnings);
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 8. Extract settings
  onProgress?.('extracting-settings', 0.8);
  const settingsResult = extractArchiveSettings(manifest, files);
  const settings = settingsResult.entries;
  restoredCategories = settingsResult.categories;
  warnings.push(...settingsResult.warnings);

  // 9. Apply settings if requested
  if (settings.length > 0 && onConflict) {
    onProgress?.('applying-settings', 0.9);
    const result = applySettingsBackup(settings, { onConflict });
    conflicts.push(...result.conflicts);
    warnings.push(`Applied ${result.applied} settings, skipped ${result.skipped}`);
  }

  return {
    document,
    settings,
    warnings,
    conflicts,
    restoredCategories,
  };
}

/** Validate archive integrity without extracting. */
export async function validateArchive(bytes: Uint8Array): Promise<{
  valid: boolean;
  manifest?: ArchiveManifest;
  error?: string;
}> {
  try {
    if (bytes.byteLength > MAX_ARCHIVE_SIZE) {
      return { valid: false, error: 'Archive exceeds maximum size' };
    }

    const files = safeUnzip(bytes);
    const manifestBytes = files['manifest.json'];
    if (!manifestBytes) {
      return { valid: false, error: 'Missing manifest.json' };
    }

    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ArchiveManifest;
    const validation = validateManifest(manifest);
    if (!validation.ok) {
      return { valid: false, error: validation.error, manifest };
    }

    // Verify checksums
    for (const [path, expectedHash] of Object.entries(manifest.checksums)) {
      const fileBytes = files[path];
      if (!fileBytes) {
        return { valid: false, error: `Missing file: ${path}`, manifest };
      }
      if (!(await verifyChecksum(fileBytes, expectedHash))) {
        return { valid: false, error: `Checksum mismatch: ${path}`, manifest };
      }
    }

    return { valid: true, manifest };
  } catch (err) {
    if (err instanceof Error && /unsafe path|decompression bomb/i.test(err.message)) {
      return { valid: false, error: err.message };
    }
    return { valid: false, error: 'Invalid ZIP archive' };
  }
}

/**
 * Decrypt an encrypted archive. Returns decrypted bytes.
 */
export async function decryptArchive(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  return decryptBytes(bytes, password);
}

/**
 * Extract and decode a document from archive files.
 */
export function extractArchiveDocument(
  _manifest: ArchiveManifest,
  files: Record<string, Uint8Array>,
): { document?: Document; warnings: string[] } {
  const warnings: string[] = [];
  const docBytes = files['document.strata'];
  if (!docBytes) {
    warnings.push('Archive contains no document.strata');
    return { warnings };
  }

  const docJson = new TextDecoder().decode(docBytes);
  const result = DocumentCodec.decode(docJson);
  if (!result.ok) {
    warnings.push(`Document decode failed: ${result.error}`);
    return { warnings };
  }

  warnings.push(...result.warnings.map((w) => `${w.code}: ${w.message}`));
  return { document: result.document, warnings };
}

/**
 * Extract settings entries from archive files.
 */
export function extractArchiveSettings(
  manifest: ArchiveManifest,
  files: Record<string, Uint8Array>,
): {
  entries: SettingsBackupEntry[];
  categories: SettingsCategory[];
  warnings: string[];
} {
  const entries: SettingsBackupEntry[] = [];
  const categories: SettingsCategory[] = [];
  const warnings: string[] = [];

  if (!manifest.settings) {
    return { entries, categories, warnings };
  }

  for (const category of manifest.settings.categories) {
    const path = `settings/${category}.json`;
    const fileBytes = files[path];
    if (!fileBytes) {
      warnings.push(`Missing settings file for category: ${category}`);
      continue;
    }

    try {
      const parsed = JSON.parse(new TextDecoder().decode(fileBytes)) as unknown[];
      if (!Array.isArray(parsed)) {
        warnings.push(`Invalid settings format for category: ${category}`);
        continue;
      }

      for (const item of parsed) {
        if (validateSettingsEntry(item)) {
          entries.push(item);
          if (!categories.includes(item.category)) {
            categories.push(item.category);
          }
        } else {
          warnings.push(`Invalid settings entry in category: ${category}`);
        }
      }
    } catch {
      warnings.push(`Failed to parse settings for category: ${category}`);
    }
  }

  return { entries, categories, warnings };
}

/**
 * Detect conflicts between archive settings and existing localStorage.
 */
export function detectConflicts(
  archiveSettings: SettingsBackupEntry[],
  existingSettings: SettingsBackupEntry[],
): ArchiveConflict[] {
  const conflicts: ArchiveConflict[] = [];
  const existingMap = new Map(existingSettings.map((e) => [`${e.key}:${e.category}`, e]));

  for (const archiveEntry of archiveSettings) {
    const key = `${archiveEntry.key}:${archiveEntry.category}`;
    const existing = existingMap.get(key);
    if (existing && JSON.stringify(existing.value) !== JSON.stringify(archiveEntry.value)) {
      conflicts.push({
        category: archiveEntry.category,
        key: archiveEntry.key,
        existingValue: existing.value,
        archiveValue: archiveEntry.value,
      });
    }
  }

  return conflicts;
}

/**
 * Apply a restore result to the application state.
 */
export async function applyRestore(
  result: ArchiveRestoreResult,
  options: {
    onConflict?: 'overwrite' | 'skip' | 'merge';
  } = {},
): Promise<{ applied: number; warnings: string[] }> {
  const warnings: string[] = [...result.warnings];

  if (!result.settings || result.settings.length === 0) {
    return { applied: 0, warnings };
  }

  const applyResult = applySettingsBackup(result.settings, {
    onConflict: options.onConflict,
  });

  warnings.push(...applyResult.conflicts.map((c) => `Conflict in ${c.category}/${c.key}`));

  return {
    applied: applyResult.applied,
    warnings,
  };
}

// ── Internal validation ─────────────────────────────────────────────────────

function validateManifest(manifest: ArchiveManifest): { ok: boolean; error?: string } {
  if (!manifest.formatVersion) {
    return { ok: false, error: 'Missing format version' };
  }

  if (manifest.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported archive format version: ${manifest.formatVersion}`,
    };
  }

  if (manifest.kind !== 'full' && manifest.kind !== 'settings-only') {
    return { ok: false, error: `Invalid archive kind: ${manifest.kind}` };
  }

  if (manifest.kind === 'full' && !manifest.document) {
    return { ok: false, error: 'Full archive missing document metadata' };
  }

  return { ok: true };
}
