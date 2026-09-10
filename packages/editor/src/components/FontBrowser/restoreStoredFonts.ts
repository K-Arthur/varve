/**
 * Restore stored fonts — reloads all IndexedDB-persisted fonts on app start.
 *
 * Call this once during application initialisation (after the FontRegistry
 * is available) to re-register any fonts the user downloaded in a previous
 * session.
 *
 * Platform behaviour:
 *   - Web: fonts are restored from IndexedDB and loaded into document.fonts
 *   - Tauri: fonts are restored from the same IndexedDB (webview), or
 *     from a dedicated filesystem directory in the app-data folder
 *   - Memory/test: no-op (no storage available)
 */

import { getFontRegistry } from '@varve/engine';
import {
  FontLoader,
  getFontsourceCatalog,
  isFilesystemFontStorageAvailable,
  listFilesystemFonts,
  loadFontFromFilesystem,
} from '@varve/engine/font';
import { listStoredFonts } from './fontStorage';

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function restoreStoredFonts(): Promise<{
  restored: number;
  failed: number;
}> {
  const loader = new FontLoader(undefined, getFontRegistry());
  let restored = 0;
  let failed = 0;

  // Desktop storage is authoritative when available. IndexedDB remains the
  // browser fallback; reading both would restore duplicate faces after a
  // migration from the webview store.
  if (isFilesystemFontStorageAvailable()) {
    try {
      const records = await listFilesystemFonts();
      for (const record of records) {
        try {
          const stored = await loadFontFromFilesystem(record.family);
          if (!stored) {
            failed++;
            continue;
          }
          const data = asArrayBuffer(stored.data);
          if (record.sha256) {
            const actual = await sha256Hex(data);
            if (actual && actual !== record.sha256.toLowerCase()) throw new Error('hash mismatch');
          }
          const result = await loader.loadFromArrayBufferPublic(
            record.family,
            data,
            'local',
            record.providerId === 'fontsource'
              ? 'fontsource'
              : record.providerId === 'google'
                ? 'google'
                : 'user',
          );
          if (result.success) restored++;
          else failed++;
        } catch {
          failed++;
        }
      }
      return { restored, failed };
    } catch {
      // Fall through to IndexedDB when the desktop directory is unavailable.
    }
  }

  if (typeof indexedDB === 'undefined') return { restored: 0, failed: 0 };
  const records = await listStoredFonts();
  if (records.length === 0) return { restored: 0, failed: 0 };

  for (const record of records) {
    try {
      const dataHash = record.metadata.contentHash ? await sha256Hex(record.data) : '';
      if (record.metadata.contentHash && dataHash && dataHash !== record.metadata.contentHash) {
        failed++;
        continue;
      }
      const result = await loader.restoreFont(record.familyName, record.data, record.metadata);
      if (result.success) {
        restored++;
        if (record.metadata.providerId === 'fontsource' && record.metadata.familyId) {
          getFontsourceCatalog().setInstalled(record.metadata.familyId, true);
        }
      } else failed++;
    } catch {
      failed++;
    }
  }

  return { restored, failed };
}
