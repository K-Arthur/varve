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
import { FontLoader, getFontsourceCatalog } from '@varve/engine/font';
import { listStoredFonts } from './fontStorage';

export async function restoreStoredFonts(): Promise<{
  restored: number;
  failed: number;
}> {
  if (typeof indexedDB === 'undefined') return { restored: 0, failed: 0 };

  const records = await listStoredFonts();
  if (records.length === 0) return { restored: 0, failed: 0 };

  const loader = new FontLoader(undefined, getFontRegistry());
  let restored = 0;
  let failed = 0;

  for (const record of records) {
    try {
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
