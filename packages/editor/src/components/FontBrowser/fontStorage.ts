/**
 * Editor compatibility seam for the shared engine font artifact store.
 * There is one IndexedDB schema and one identity model for all runtimes.
 */

export type { FontStorageMetadata, StoredFontRecord } from '@varve/engine/font';
export {
  getStoredFont,
  getStoredFontCount,
  listStoredFonts,
  removeStoredFont,
  storeFont,
} from '@varve/engine/font';
