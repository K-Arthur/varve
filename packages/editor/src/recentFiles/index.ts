export {
  addEntry,
  clearEntries,
  computeEntryId,
  hashLocator,
  labelWithFallback,
  loadEntries,
  loadHandle,
  removeEntry,
  sanitizeLabel,
  saveEntries,
  storeHandle,
  togglePinEntry,
  updateEntryLocator,
} from './store';
export type { FileLocator, RecentEntry } from './types';
export { MAX_ENTRIES, SCHEMA_KEY } from './types';
export type { RecentFilesActions } from './useRecentFiles';
export { useRecentFiles } from './useRecentFiles';
