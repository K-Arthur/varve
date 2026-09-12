/**
 * Editor compatibility seam for the shared engine font artifact store.
 * There is one IndexedDB schema and one identity model for all runtimes.
 */

export type { FontStorageMetadata, StoredFontRecord } from '@varve/engine/font';
export {
  getStoredFont,
  getStoredFontByIdentity,
  getStoredFontCount,
  listStoredFonts,
  removeStoredFont,
  removeStoredFontByIdentity,
  storeFont,
} from '@varve/engine/font';
