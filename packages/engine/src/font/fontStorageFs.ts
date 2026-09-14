/**
 * Tauri filesystem font storage adapter.
 *
 * Mirrors the IndexedDB `fontStorage.ts` interface but persists font
 * binaries in the application data directory via Rust/Tauri IPC.
 *
 * When the Tauri bridge is unavailable (web/test), this adapter falls
 * back to a no-op that reports no fonts stored.
 */

import {
  getStoredFontByIdentity,
  listStoredFonts,
  loadStoredFont,
  removeStoredFont,
  removeStoredFontByIdentity,
  storeFont,
} from './fontStorage';

export interface FontStorageFsMeta {
  family: string;
  providerId?: string;
  licenseName?: string;
  licenseUrl?: string;
  attribution?: string;
  version?: string;
  storedAt: string;
  fileSizeBytes: number;
  sha256: string;
  faceKey?: string;
  collectionIndex?: number;
  postScriptName?: string;
  integrity?: 'verified' | 'corrupt' | 'unknown';
}

function getCore(): {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
} | null {
  try {
    const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as
      | Record<string, unknown>
      | undefined;
    const core = tauri?.core as
      | { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    if (core?.invoke)
      return core as { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  } catch {
    // Not in Tauri
  }
  return null;
}

function isTauri(): boolean {
  return getCore() !== null;
}

async function tauriInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const core = getCore();
  if (!core) throw new Error('Tauri IPC not available');
  return core.invoke(cmd, args);
}

function portableFaceKey(artifactHash: string, collectionIndex?: number): string {
  return `sha256:${artifactHash.replace(/^sha256:/i, '').toLowerCase()}:${collectionIndex ?? 'single'}`;
}

/**
 * Store font data in the filesystem application data directory.
 * Also mirrors to IndexedDB for web fallback.
 */
export async function storeFontOnFilesystem(
  family: string,
  data: ArrayBuffer,
  meta?: {
    providerId?: string;
    licenseName?: string;
    licenseUrl?: string;
    attribution?: string;
    version?: string;
    collectionIndex?: number;
    postScriptName?: string;
    artifactHash?: string;
    faceKey?: string;
  },
): Promise<FontStorageFsMeta | null> {
  if (!isTauri()) {
    // Fall back to IndexedDB
    const stored = await storeFont(family, data, {
      providerId: meta?.providerId ?? 'legacy',
      license: meta?.licenseName,
      licenseUrl: meta?.licenseUrl,
      attribution: meta?.attribution,
      packageVersion: meta?.version,
      collectionIndex: meta?.collectionIndex,
      postScriptName: meta?.postScriptName,
      artifactHash: meta?.artifactHash,
      faceKey: meta?.faceKey,
    });
    return {
      family: stored.familyName,
      storedAt: new Date(stored.storedAt).toISOString(),
      providerId: stored.metadata.providerId,
      licenseName: stored.metadata.license,
      fileSizeBytes: stored.data.byteLength,
      sha256: stored.artifactHash,
      faceKey: stored.faceKey,
      collectionIndex: stored.metadata.collectionIndex,
      postScriptName: stored.metadata.postScriptName,
      integrity: stored.integrity,
    };
  }

  const result = await tauriInvoke('store_font_on_filesystem', {
    family,
    data: Array.from(new Uint8Array(data)),
    providerId: meta?.providerId ?? null,
    licenseName: meta?.licenseName ?? null,
    licenseUrl: meta?.licenseUrl ?? null,
    attribution: meta?.attribution ?? null,
    version: meta?.version ?? null,
    collectionIndex: meta?.collectionIndex ?? null,
    postScriptName: meta?.postScriptName ?? null,
    artifactHash: meta?.artifactHash ?? null,
    faceKey: meta?.faceKey ?? null,
  });

  return result as FontStorageFsMeta;
}

/**
 * Load font data from the filesystem.
 * Falls back to IndexedDB on web.
 */
export async function loadFontFromFilesystem(
  familyOrIdentity: string | { artifactHash: string; collectionIndex?: number },
): Promise<{ data: Uint8Array; meta: FontStorageFsMeta } | null> {
  if (!isTauri()) {
    const stored =
      typeof familyOrIdentity === 'string'
        ? await loadStoredFont(familyOrIdentity)
        : await getStoredFontByIdentity(familyOrIdentity);
    if (!stored) return null;
    return {
      data: new Uint8Array(stored.data),
      meta: {
        family: stored.familyName,
        storedAt: new Date(stored.storedAt).toISOString(),
        providerId: stored.metadata.providerId,
        licenseName: stored.metadata.license,
        fileSizeBytes: stored.data.byteLength,
        sha256: stored.artifactHash,
        faceKey: stored.faceKey,
        collectionIndex: stored.metadata.collectionIndex,
        postScriptName: stored.metadata.postScriptName,
        integrity: stored.integrity,
      },
    };
  }

  const result = (await tauriInvoke('load_font_from_filesystem', {
    family: typeof familyOrIdentity === 'string' ? familyOrIdentity : null,
    faceKey:
      typeof familyOrIdentity === 'string'
        ? null
        : portableFaceKey(familyOrIdentity.artifactHash, familyOrIdentity.collectionIndex),
  })) as [number[], FontStorageFsMeta] | null;
  if (!result) return null;
  return {
    data: new Uint8Array(result[0]),
    meta: result[1],
  };
}

/**
 * List all fonts stored on the filesystem.
 * Falls back to IndexedDB on web.
 */
export async function listFilesystemFonts(): Promise<FontStorageFsMeta[]> {
  if (!isTauri()) {
    const stored = await listStoredFonts();
    return stored.map((s) => ({
      family: s.familyName,
      storedAt: new Date(s.storedAt).toISOString(),
      providerId: s.metadata.providerId,
      licenseName: s.metadata.license,
      fileSizeBytes: s.data.byteLength,
      sha256: s.artifactHash,
      faceKey: s.faceKey,
      collectionIndex: s.metadata.collectionIndex,
      postScriptName: s.metadata.postScriptName,
      integrity: s.integrity,
    }));
  }

  return (await tauriInvoke('list_filesystem_fonts')) as FontStorageFsMeta[];
}

/**
 * Remove a font from the filesystem.
 * Falls back to IndexedDB on web.
 */
export async function removeFontFromFilesystem(
  familyOrIdentity: string | { artifactHash: string; collectionIndex?: number },
): Promise<boolean> {
  if (!isTauri()) {
    if (typeof familyOrIdentity === 'string') {
      await removeStoredFont(familyOrIdentity);
      return true;
    }
    return removeStoredFontByIdentity(familyOrIdentity);
  }

  return (await tauriInvoke('remove_font_from_filesystem', {
    family: typeof familyOrIdentity === 'string' ? familyOrIdentity : null,
    faceKey:
      typeof familyOrIdentity === 'string'
        ? null
        : portableFaceKey(familyOrIdentity.artifactHash, familyOrIdentity.collectionIndex),
  })) as boolean;
}

/**
 * Get storage usage statistics.
 */
export async function getFilesystemFontStorageUsage(): Promise<{
  count: number;
  totalBytes: number;
}> {
  if (!isTauri()) {
    const { getStoredFontCount } = await import('./fontStorage');
    const count = await getStoredFontCount();
    return { count, totalBytes: 0 };
  }

  const [count, totalBytes] = (await tauriInvoke('get_filesystem_font_storage_usage')) as [
    number,
    number,
  ];
  return { count, totalBytes };
}

/**
 * Check if filesystem font storage is available (Tauri only).
 */
export function isFilesystemFontStorageAvailable(): boolean {
  return isTauri();
}
