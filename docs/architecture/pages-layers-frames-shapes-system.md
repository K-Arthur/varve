# Pages, Layers, Frames, and Shapes System

Last updated: 2026-07-14

## Current Architecture

The shared document model lives in `@varve/scene` and is target-agnostic. The editor, renderer, layers tree, hit tester, export code, recovery, and platform adapters all consume the same `Document` object.

### Page Model v2.0

The page model uses stable fractional-indexing for page ordering:

- `Document.pages`: ordered `Page[]`, each with stable `Page.id`, dimensions, backgrounds, and a `contentRoot`.
- `Page.order`: stable fractional-indexing key (`PageOrder` type) via `generateKeyBetween`. Pages are sorted by `order.localeCompare()`, not array index.
- `Document.activePageId`: canonical active page id. This must point to a `Page.id`, not a content root node id.
- `Page.contentRoot`: a `GroupNode` that owns the page's layer tree.
- `Document.globalChildren`: shared nodes shown on every page.
- `activePageNodes(doc)`: the active renderer/hit-test traversal entry point, returning globals plus the active page content root's children.
- `activePageNodesWithMaster(doc, pageId)`: returns visible nodes including applied master content with override filtering.

### Master Pages

Master pages provide reusable layout templates:

- `Document.masters`: `Record<NodeId, MasterPage>` — master page definitions keyed by id.
- `MasterPage`: id, name, width, height, contentRoot (GroupNode), appliesTo ('all'|'left'|'right').
- `Page.masterPageId`: which master is applied to this page.
- `Page.masterOverrides`: `Record<NodeId, MasterOverride>` — per-node overrides against the applied master.
- `MasterOverride`: type ('modified'|'hidden'|'deleted'), optional localNodeId for modified nodes.

Master content propagation: `activePageNodesWithMaster` returns globals → master content (filtered by overrides) → page-local content. Modified overrides replace the master node with a local copy. Hidden/deleted overrides filter the master node.

### Facing Pages & Spreads

Editorial spreads for print layout:

- `Document.facingPages`: `FacingPagesConfig` with enabled, startOnRight, autoInsertBlank.
- `Document.spreads`: `Spread[]` — each spread has one or two page IDs.
- `rebuildSpreads(doc, config?)`: sorts pages by order, pairs into spreads. `startOnRight` puts first page alone.
- `getPageSide(doc, pageId, config)`: returns 'left', 'right', or 'none' based on spread position.
- `PageSection`: section-aware numbering with styles (decimal/upperRoman/lowerRoman/upperAlpha/lowerAlpha) and optional prefix.

### Page Numbering

- `getPageNumber(doc, pageId)`: returns 1-indexed number within section.
- `getFormattedPageNumber(doc, pageId)`: returns formatted string using section style and prefix.

## Target I/O Boundary

Shared model behavior should not diverge between desktop and web. The I/O adapters do diverge:

- Web target: `@varve/platform/src/web.ts` stores home files in IndexedDB, uses File System Access API when available, and falls back to `<input type=file>` or Blob downloads.
- Tauri target: `@varve/platform/src/tauri.ts` persists through Tauri IPC into the native SQLite store, uses `tauri-plugin-dialog` for native open/save dialogs, and uses native file writes.
- Drag and drop: browser code uses HTML5 `DataTransfer`; Tauri config currently does not set `dragDropEnabled`, so Tauri's default native file-drop handling can differ from browser drop behavior.
- Clipboard: editor clipboard uses browser Clipboard API and DOM paste-event fallbacks. A dedicated Tauri clipboard adapter is not present in this slice.
- Multi-document: current product behavior is in-app sessions/tabs in one JS heap. Browser cross-tab and Tauri multi-window shared-state semantics are not yet implemented.
- Context menus: current editor/page/layer menus are custom in-app UI, not native Tauri menus.

## Research Notes

Access date for all links: 2026-07-12.

- Figma frames are layers that act as containers, can nest, and can hold shapes/images/text. This supports Strata's `FrameNode` as a renderable container, not a separate page concept. Source: https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
- Figma distinguishes groups from frames: groups combine layers and their bounds follow children, while frames can act as more explicit parent objects. Source: https://help.figma.com/hc/en-us/articles/360039832054-The-difference-between-frames-and-groups
- Sketch 2025 frames/graphics support full styling like fills, borders, shadows, and blur, unlike legacy artboard background semantics. Source: https://developer.sketch.com/plugins/updates/new-in-sketch-20251
- Tauri 2 exposes native drag/drop events such as `tauri://drag-drop`, `tauri://drag-enter`, `tauri://drag-over`, and `tauri://drag-leave`. Source: https://v2.tauri.app/reference/javascript/api/namespaceevent/
- Tauri 2 `dragDropEnabled` defaults to true; docs say disabling it is required to use HTML5 drag and drop on the frontend on Windows. Source: https://v2.tauri.app/reference/config/
- Tauri dialog plugin provides native file open/save dialogs and returns filesystem paths on Linux, Windows, and macOS. Source: https://v2.tauri.app/plugin/dialog/
- Browser File System Access requires user-granted handles for user-visible files; OPFS is origin-private and subject to browser quota. Sources: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API and https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Browser storage quotas and eviction differ by browser and origin. Source: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Clipboard API works in secure contexts and reads are constrained by user activation or browser permission behavior. Source: https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
- BroadcastChannel supports same-origin browsing-context communication and can support future cross-tab coordination, but Strata does not yet implement it. Source: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
- WAI-ARIA tree view guidance distinguishes focus from selection, especially in multi-select trees. This remains relevant for LayersPanel behavior. Source: https://www.w3.org/WAI/ARIA/apg/patterns/treeview/

## Shipped In This Slice

- `removePage` now removes the page record before deleting its content root, so development validation never observes a transient page pointing at deleted nodes.
- Removing the active page now retargets `activePageId` to a surviving neighboring page.
- `setActivePage` rejects ids that do not exist in `Document.pages`.
- `validateDocument` now reports stale `activePageId` values.
- `DocumentCodec.normalize` repairs persisted page metadata by creating an empty content-root group for pages whose root is missing, filtering missing page background references, restoring content roots into `rootChildren`, and selecting a valid active page.
- Page navigation now reads `document.activePageId` as canonical, calls `setActivePage` on click/keyboard activation, and keeps `currentPageId` only as UI mirror state.

## Prioritized Backlog

High:

- Add a Tauri file-drop adapter or explicitly set `dragDropEnabled` per intended behavior, then test OS file drop on Linux/Wayland, Windows, and macOS.
- Add browser/Tauri clipboard capability documentation and target-specific tests for custom Strata JSON, SVG, PNG, and permission-denied paths.
- Extend codec repair to detect duplicate parentage and cycles in untrusted documents before editor state consumes them.
- Add Playwright page-workflow coverage: create page, switch page, create shape, delete active page, save/reopen, and assert rendered/layer state.

Medium:

- Decide and implement cross-tab or multi-window coordination. Browser likely needs BroadcastChannel or equivalent; Tauri multi-window needs explicit backend coordination.
- Clarify page background ownership in rendering/export so background ids are either owned by page metadata or normal layer-tree nodes, not both by accident.
- Add page export/print ordering contract tests for multi-page documents.
- Add large-page-count performance fixtures for PageNav and LayersPanel.

Lower:

- Native Tauri context menus for desktop if product direction requires OS-native menus.
- Visual regression fixtures for nested frames/groups, page switching, clipping, and exported output.

## Verification Notes

Directly executed this session:

- `pnpm vitest run packages/scene/src/documentCodec.test.ts packages/scene/src/__tests__/page.test.ts packages/editor/src/components/PageNav/PageNav.test.tsx packages/editor/src/__tests__/pageConfig.test.tsx packages/editor/src/layout/__tests__/cycleDetection.test.ts packages/editor/src/startup/bootManager.test.ts packages/editor/src/startup/startupTimer.test.ts --reporter=verbose`
- `pnpm --filter @varve/scene typecheck`
- `pnpm --filter @varve/editor typecheck`
- `pnpm typecheck`
- `pnpm exec biome check` on touched implementation and test files
- `pnpm test`
- `pnpm audit:emoji`
- `pnpm audit:tokens`

Blocked by existing dirty-tree issues:

- `just format-check` stops on untracked Rust formatting drift in `crates/strata-bridge/tests/wgsl_validation.rs`.
- `pnpm lint` stops on six existing Biome error-level diagnostics outside the page-model slice: one settings tab-panel `tabIndex`, one `NumberInput` dependency warning promoted to error, and four duplicate generated custom properties in `packages/ui/src/tokens/tokens.css`.
