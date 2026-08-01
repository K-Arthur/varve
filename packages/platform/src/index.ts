/**
 * @strata/platform — public entry point.
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

export type { PlatformKind } from './detect';
export { detectPlatform, detectPlatformKind } from './detect';
export { upsertPreservingMeta } from './filePersist';
export type { MemoryPlatformOptions } from './memory';
export { createMemoryPlatform, makeFileEntry, makeProject } from './memory';
export type { Platform } from './platform';
export {
  compareBy,
  contentHash,
  defaultViewState,
  detectFileKind,
  emptyFilter,
  evaluateSmartCollection,
  extractTrigrams,
  filterRecentByWorkspace,
  formatAbsoluteTime,
  formatBytes,
  formatRelativeTime,
  fuzzyScore,
  fuzzySearch,
  isImportableKind,
  mergeViewState,
  recentFileSections,
  STRATA_EXT,
  stripExtension,
  uuid,
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
  resolveWindowChromeStrategy,
  resetWindowChromeTestOverrides,
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
export type { ContentSearchMatch } from './searchIndex';
export { createTauriPlatform } from './tauri';
export * from './types';
export type { WebPlatformOptions } from './web';
export { createWebPlatform } from './web';
