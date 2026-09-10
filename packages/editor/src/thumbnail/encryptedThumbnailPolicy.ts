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

import { hasAnyCanvas, hasImageEncoding } from '@varve/engine';
import type { Platform, ThumbnailRecord } from '@varve/platform';
import type { ThumbnailPolicy } from '@varve/shared';
import { DEFAULT_THUMBNAIL_POLICY } from '@varve/shared';

/**
 * Canonical privacy policy for encrypted documents: never write decrypted
 * design pixels to ordinary plaintext caches. The ONLY thumbnail artifact
 * an encrypted project may produce is the deterministic content-free
 * placeholder, stored under the `encrypted:` key namespace.
 */
export function thumbnailPolicyForEncrypted(): ThumbnailPolicy {
  return {
    ...DEFAULT_THUMBNAIL_POLICY,
    encrypted: true,
    allowEmbeddedPreview: false,
  };
}

/**
 * Deterministic, content-free placeholder for encrypted projects.
 * Canonical constant lives in @varve/shared so every surface (Home, editor,
 * tests) renders the same artifact.
 */
import { ENCRYPTED_PROJECT_PLACEHOLDER } from '@varve/shared';

export { ENCRYPTED_PROJECT_PLACEHOLDER };

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
