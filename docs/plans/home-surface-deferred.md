# Home Surface — Deferred Items

> Written 2026-06-29. Items not addressed in the initial implementation that
> should land in a follow-up session.

## 1. Editor `@strata/editor` typecheck (pre-existing)

`CanvasArea.tsx`, `PositionSizeSection.tsx`, `component.ts` have type errors
(GroupNode vs FrameNode, missing `Shape` export, FrameNode missing `strokes`/
`effects` etc.). These are upstream issues in `@strata/scene` and `@strata/engine`
not caused by the Home surface work. Fix order:
1. Sync `GroupNode` fields with `FrameNode`
2. Re-export `Shape` from `@strata/scene`
3. Update `component.ts` FrameNode initializers

## 2. `apps/desktop` desktop typecheck

`apps/desktop/tsconfig.json` typecheck may fail because `@strata/home` and
`@strata/platform` dependencies were added to `package.json` but the desktop
`tsconfig.json` might need updating. Verify and fix if needed.

## 3. Playwright E2E tests

Install `@playwright/test` and `@axe-core/playwright`. Write test flows:
- Home shell renders, sidebar nav works
- Create new file via preset dialog → opens editor
- Open recents, search/filter/sort
- Full keyboard nav on file grid (arrows, Home/End, type-ahead)
- Context menu (right-click, Shift+F10, long-press)
- Delete → Trash → Restore flow
- Empty states render correctly
- axe-core zero violations per page

## 4. Thumbnail rendering on desktop

The `renderThumbnail()` function exists and works in tests. Wire it into the
desktop save flow: after saving a document, generate a thumbnail and store via
`platform.putThumbnail()`. Optionally write freedesktop-compliant thumbnails
to `~/.cache/thumbnails/large/<md5-uri>.png` for OS file-manager previews.

## 5. Drag-and-drop DnD reorder

`@dnd-kit/core` and `@dnd-kit/sortable` are installed but not wired.
Implement:
- Drag files between projects in sidebar
- Reorder within a project
- Drag from OS desktop onto Strata window (import/open)

## 6. File-system watcher

Use Tauri's `plugin:fs|watch` (or `notify` crate) to watch the app data
directory for external file changes. Update the recents list when a file is
moved, renamed, or deleted outside Strata.

## 7. Search FTS5 indexing

The SQLite `files_fts` virtual table is defined in the plan but not implemented
in `strata-sync`. Add FTS5 for full-text search over file names and tags.

## 8. Keyboard shortcuts for Home

- `Ctrl+N` → New file
- `Ctrl+O` → Open from disk
- `Ctrl+F` or `/` → Focus search
- `Ctrl+Shift+T` → Templates
- `Escape` → Close dialogs / deselect
- `Ctrl+A` → Select all files in grid

## 9. `tauri-plugin-dialog` and `tauri-plugin-opener` capabilities

The plugins are added to `Cargo.toml` but `capabilities/default.json` needs
expanding with `dialog:allow-open`, `dialog:allow-save`, `opener:allow-reveal-item-in-dir`.

## 10. Drag-drop OS file import

The Home shell should accept files dragged from the OS onto the window
(`onDragOver`/`onDrop` handlers). Parse `.strata` files by reading dropped
File objects; import `.fig`/`.ai`/`.svg`/images with a placeholder.

## 11. Perf budget: 5000 files @ 60fps

Measure with DevTools Performance flame chart. The `@tanstack/react-virtual`
skeleton is in place; verify overscan, row estimation, and scroll smoothness
at scale.

## 12. Cross-OS verification

Test on:
- **Linux:** WebKitGTK (Wayland + X11) — primary dev OS
- **macOS:** `~/Library/Application Support` paths, Finder reveal
- **Windows:** `%APPDATA%` paths, Explorer reveal, native dialogs

## 13. Reduced-motion gate

Verify that `@media (prefers-reduced-motion: reduce)` disables all
animations (skeleton shimmer, transition effects) on the home surface.
The token system already handles this via `--duration-*` zeroing.
