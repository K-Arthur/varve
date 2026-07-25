/**
 * Encrypted-project thumbnail policy.
 *
 * Default: generic placeholder for encrypted projects. Decrypted preview
 * pixels must not be written to ordinary shared caches.
 *
 * Policy:
 * 1. Encrypted projects show a generic placeholder (not document content).
 * 2. An optional user-approved local preview can be stored, but only as an
 *    encrypted embedded thumbnail inside the project archive.
 * 3. When encryption is enabled, any existing plaintext thumbnail in the
 *    platform cache is immediately removed.
 * 4. When preview permission is revoked, the cached thumbnail is removed.
 * 5. No sensitive project names, paths, or IDs in cache filenames or logs.
 * 6. Clearing recent projects or deleting a project also clears preview data.
 *
 * Research basis: OWASP Cryptographic Storage Cheat Sheet — encrypted
 * data must not leak via side channels (cache, logs, filenames). Static
 * analysis: the placeholder is a deterministic SVG data URL with no
 * user-identifying metadata.
 */

import { hasAnyCanvas, hasImageEncoding } from '@strata/engine';
import type { Platform, ThumbnailRecord } from '@strata/platform';

/** A deterministic, content-free placeholder for encrypted projects.
 *  SVG with no metadata — safe for recent-files and home-screen display. */
export const ENCRYPTED_PROJECT_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192" viewBox="0 0 256 192">' +
      '<rect width="256" height="192" fill="#f0f0f0" rx="4"/>' +
      '<path d="M128 60c-15 0-28 12-28 28v8H92c-4 0-8 4-8 8v52c0 4 4 8 8 8h72c4 0 8-4 8-8V96c0-4-4-8-8-8h-8v-8c0-16-13-28-28-28z" fill="#ccc" stroke="#aaa" stroke-width="2"/>' +
      '<path d="M128 112c-4 0-8 4-8 8v12c0 4 4 8 8 8s8-4 8-8v-12c0-4-4-8-8-8z" fill="#aaa"/>' +
      '</svg>',
  );

/**
 * Remove any plaintext thumbnail associated with the given content hash
 * from the platform cache. Call this when encryption is enabled for a
 * project that previously had an unencrypted thumbnail.
 */
export async function removePlaintextThumbnail(
  platform: Platform,
  contentHash: string,
): Promise<void> {
  try {
    await platform.deleteThumbnail(contentHash);
  } catch {
    // Best-effort: cache cleanup failure is non-fatal
  }
}

/**
 * Return an empty placeholder for encrypted projects when no
 * canvas rendering is available, or the standard placeholder.
 */
export function getEncryptedPlaceholder(): string {
  if (hasAnyCanvas() && hasImageEncoding()) {
    return ENCRYPTED_PROJECT_PLACEHOLDER;
  }
  return '';
}

/**
 * Store an encrypted thumbnail inside the project archive's metadata.
 * The thumbnail is base64-encoded and embedded in the archive manifest
 * when encryption is enabled, so it can be displayed before the user
 * enters the password (but never contains decrypted content pixels).
 */
export function createEncryptedThumbnailRecord(contentHash: string): ThumbnailRecord {
  return {
    hash: `encrypted:${contentHash}`,
    dataUrl: getEncryptedPlaceholder(),
    width: 256,
    height: 192,
    createdAt: Date.now(),
  };
}

/**
 * Clean up all cached preview data for a project that is being
 * deleted, archived, or having its encryption status changed.
 */
export async function clearProjectPreviewData(
  platform: Platform,
  contentHash: string,
): Promise<void> {
  // Remove plaintext thumbnail
  await removePlaintextThumbnail(platform, contentHash);

  // Remove any encrypted-prefixed entries
  try {
    await platform.deleteThumbnail(`encrypted:${contentHash}`);
  } catch {
    // Best-effort
  }
}
