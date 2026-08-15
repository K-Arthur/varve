/**
 * @varve/platform — public entry point.
 *
 * One `Platform` interface, three implementations (memory / web / tauri), plus
 * the pure helpers every consumer needs. The Home surface imports only from
 * here so it is fully portable across browser, desktop, and test contexts.
 *
 * Research basis: Hexagonal architecture (ports & adapters) — the `Platform`
 * interface is the port; `createWebPlatform` / `createTauriPlatform` /
 * `createMemoryPlatform` are adapters. Feature code depends on the port, never
 * the adapter.
 */

export type {
  AssetEmbeddingDtype,
  AssetEmbeddingIdentity,
  AssetEmbeddingRecord,
} from './assetEmbeddingIndex';
export {
  assetEmbeddingKey,
  decodeFloat32Embedding,
  encodeFloat32Embedding,
  makeAssetEmbeddingRecord,
} from './assetEmbeddingIndex';
export type {
  AssetSearchLane,
  AssetSearchOptions,
  AssetSearchReason,
  AssetSearchResult,
  NormalizedAssetQuery,
} from './assetSearch';
export { normalizeAssetSearchQuery, searchAssets } from './assetSearch';
export type { PlatformKind } from './detect';
export { detectPlatform, detectPlatformKind } from './detect';
export { upsertPreservingMeta } from './filePersist';
export type { MemoryPlatformOptions } from './memory';
export { createMemoryPlatform, makeFileEntry, makeProject } from './memory';
export type { Platform } from './platform';
export {
  classifyTauriSaveError,
  compareBy,
  contentHash,
  DOCUMENT_EXT,
  defaultViewState,
  detectFileKind,
  directoryOfPath,
  displayNameFromPath,
  emptyFilter,
  evaluateSmartCollection,
  extractTrigrams,
  fileKindLabel,
  filterRecentByWorkspace,
  formatAbsoluteTime,
  formatBytes,
  formatRelativeTime,
  fuzzyScore,
  fuzzySearch,
  isImportableKind,
  LEGACY_DOCUMENT_EXT,
  mergeViewState,
  normalizeSaveFileName,
  recentFileSections,
  stripExtension,
  uuid,
  withDocumentExt,
} from './pure';
export type {
  OsKind,
  PlatformCapability,
  PlatformInfo,
  RuntimeKind,
} from './runtime';
export {
  detectRuntimeKind,
  getPlatformInfo,
  hasCapability,
  isMac,
  isTauriRuntime,
  isWebKitGTK,
  isWebRuntime,
  resetPlatformInfo,
  setPlatformInfoForTest,
} from './runtime';
export type { ContentSearchMatch } from './searchIndex';
export type { SemanticIndexHit, SemanticIndexSnapshot } from './semanticAssetIndex';
export { SEMANTIC_INDEX_SCHEMA_VERSION, SemanticAssetIndex } from './semanticAssetIndex';
export type {
  SemanticEmbeddingJob,
  SemanticEmbeddingQueueStats,
} from './semanticEmbeddingQueue';
export { SemanticEmbeddingQueue } from './semanticEmbeddingQueue';
export type { SemanticEmbeddingStore } from './semanticEmbeddingStore';
export {
  IndexedDbSemanticEmbeddingStore,
  MemorySemanticEmbeddingStore,
} from './semanticEmbeddingStore';
export { createTauriPlatform } from './tauri';
export * from './types';
export type { WebPlatformOptions } from './web';
export { createWebPlatform } from './web';
export {
  DB_NAME,
  DB_VERSION,
  KV_VIEW_STATE,
  migrateLegacyIndexedDb,
  openHomeDb,
  STORE_ACTIVITY,
  STORE_ASSET_FOLDERS,
  STORE_ASSETS,
  STORE_BRANCHES,
  STORE_COLLECTION_ENTRIES,
  STORE_COLLECTIONS,
  STORE_FILE_TAGS,
  STORE_FILES,
  STORE_FOLDERS,
  STORE_KV,
  STORE_LIBRARIES,
  STORE_PROJECTS,
  STORE_RECENT_FILES,
  STORE_SAVED_SEARCHES,
  STORE_TAGS,
  STORE_TEMPLATES,
  STORE_THUMBS,
  STORE_VERSION_CONTENT,
  STORE_VERSIONS,
  STORE_WORKSPACES,
} from './web-db';
export type {
  ButtonLayout,
  ControlsPosition,
  DecorationMode,
  DisplayServer,
  MenubarPlacement,
  MenubarStrategy,
  WindowChromeState,
  WindowChromeStrategy,
  WindowEvent,
} from './windowChrome';
export {
  createInitialChromeState,
  detectButtonLayout,
  detectDisplayServer,
  getMenubarHeight,
  getTitleBarHeight,
  getTotalTopChromeHeight,
  resetWindowChromeTestOverrides,
  resolveWindowChromeStrategy,
  setButtonLayoutForTest,
  setDisplayServerForTest,
  shouldRenderCustomMenubar,
  shouldRenderCustomTitleBar,
  shouldUseNativeMenu,
  updateChromeState,
  usesCustomControls,
  usesCustomMenubar,
  usesNativeDecorations,
  usesNativeMenu,
} from './windowChrome';
export {
  type CreateWorkspaceWindowOptions,
  cascadePlacement,
  clampNumber,
  clampPlacementToWorkArea,
  computeRelativeRole,
  createBrowserWindowService,
  createMemoryWindowService,
  createTauriWindowService,
  DEFAULT_MAX_AUXILIARY_WINDOWS,
  DEFAULT_MEMORY_MONITORS,
  type DisplayFingerprint,
  type DisplayInfo,
  deriveWindowLabel,
  fingerprintFromDisplay,
  getWindowService,
  logicalToPhysical,
  MAX_WINDOW_LABEL_LENGTH,
  MIN_DISPLAY_MATCH_SCORE,
  matchDisplayFingerprint,
  type NativeWindowCapability,
  type NativeWindowService,
  type PhysicalPoint,
  type PhysicalSize,
  physicalToLogical,
  pickDisplayForFingerprint,
  resetWindowServiceForTest,
  sanitizeWindowLabel,
  setWindowServiceForTest,
  TITLE_BAR_MARGIN,
  UnsupportedOperationError,
  type WindowPlacement,
  type WindowState,
  type WorkspaceWindowEvent,
  type WorkspaceWindowId,
  type WorkspaceWindowInfo,
} from './windows';
