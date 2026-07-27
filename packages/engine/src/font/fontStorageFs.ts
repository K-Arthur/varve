/**
 * Tauri filesystem font storage adapter.
 *
 * Mirrors the IndexedDB `fontStorage.ts` interface but persists font
 * binaries in the application data directory via Rust/Tauri IPC.
 *
 * When the Tauri bridge is unavailable (web/test), this adapter falls
 * back to a no-op that reports no fonts stored.
 */

import { listStoredFonts, loadStoredFont, removeStoredFont, storeFont } from './fontStorage';

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
  },
): Promise<FontStorageFsMeta | null> {
  if (!isTauri()) {
    // Fall back to IndexedDB
    await storeFont(family, data, { providerId: meta?.providerId, licenseName: meta?.licenseName });
    return null;
  }

  const result = await tauriInvoke('store_font_on_filesystem', {
    family,
    data: Array.from(new Uint8Array(data)),
    providerId: meta?.providerId ?? null,
    licenseName: meta?.licenseName ?? null,
    licenseUrl: meta?.licenseUrl ?? null,
    attribution: meta?.attribution ?? null,
    version: meta?.version ?? null,
  });

  return result as FontStorageFsMeta;
}

/**
 * Load font data from the filesystem.
 * Falls back to IndexedDB on web.
 */
export async function loadFontFromFilesystem(
  family: string,
): Promise<{ data: Uint8Array; meta: FontStorageFsMeta } | null> {
  if (!isTauri()) {
    const stored = await loadStoredFont(family);
    if (!stored) return null;
    return {
      data: stored.data,
      meta: {
        family: stored.family,
        storedAt: stored.storedAt,
        providerId: stored.providerId,
        licenseName: stored.licenseName,
        fileSizeBytes: stored.data.byteLength,
        sha256: '',
      },
    };
  }

  const result = (await tauriInvoke('load_font_from_filesystem', { family })) as
    | [number[], FontStorageFsMeta]
    | null;
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
      family: s.family,
      storedAt: s.storedAt,
      providerId: s.providerId,
      licenseName: s.licenseName,
      fileSizeBytes: s.data.byteLength,
      sha256: '',
    }));
  }

  return (await tauriInvoke('list_filesystem_fonts')) as FontStorageFsMeta[];
}

/**
 * Remove a font from the filesystem.
 * Falls back to IndexedDB on web.
 */
export async function removeFontFromFilesystem(family: string): Promise<boolean> {
  if (!isTauri()) {
    await removeStoredFont(family);
    return true;
  }

  return (await tauriInvoke('remove_font_from_filesystem', { family })) as boolean;
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
