# Home Surface — Deferred Items

> Written 2026-06-29. Last updated 2026-06-29 (Session 8).
> Items 8, 9, 10, 13 are complete. Remaining items for future sessions.

## Status legend

| Icon | Meaning |
|---|---|
| [OK] | Done |
| [WIP] | In progress |
| [TODO] | Not started |
| [NO] | Blocked |

---

## [OK] 1. Editor `@strata/editor` typecheck (pre-existing)

**Status: [WIP] — 9 type errors remain (was resolved then re-introduced by SpecPanel additions)**

### Errors to fix

#### `CanvasArea.tsx:86`
```
TS6133: 'contextAnnounce' is declared but its value is never read.
```
**Fix:** Remove unused variable or prefix with `_`.

#### `sections.test.tsx:3`
```
TS6133: 'useEditor' is declared but its value is never read.
```
**Fix:** Remove unused import.

#### `MeasureOverlay.tsx:14`
```
TS6133: 'AABB' is declared but its value is never read.
```
**Fix:** Remove unused import.

#### `MeasureOverlay.tsx:40`
```
TS2503: Cannot find namespace 'JSX'.
```
**Fix:** Import `JSX` from `react` or use `React.JSX.Element`.

#### `MeasurementReadout.tsx:12`
```
TS6133: 'getAccumulatedTransform' is declared but its value is never read.
```
**Fix:** Remove unused variable.

#### `MeasurementReadout.tsx:23`
```
TS6133: 'parentTransform' is declared but its value is never read.
```
**Fix:** Remove unused variable.

#### `SpecReadouts.tsx:79`
```
TS6133: 'doc' is declared but its value is never read.
```
**Fix:** Remove unused variable.

#### `SpecReadouts.tsx:93-94`
```
TS2339: Property 'w' does not exist on type 'Shape' (kind: "ellipse").
TS2339: Property 'h' does not exist on type 'Shape' (kind: "ellipse").
```
**Root cause:** The `Shape` union type discriminates by `kind`. The code assumes `w`/`h` exist on all shapes but `ellipse` uses `rx`/`ry`, `circle` uses `r`, `line` uses `from`/`to`, etc.
**Fix:** Add a type-safe `shapeWidth`/`shapeHeight` helper (already exists in `@strata/engine` or `@strata/scene`) or add a discriminated switch.

#### `SpecReadouts.tsx:99`
```
TS2322: Type 'number' is not assignable to type 'string'.
TS2362: The left-hand side of an arithmetic operation must be of type 'number'.
```
**Root cause:** A string is being used in arithmetic.
**Fix:** Cast to `number` or fix the variable type.

### Execution order
1. Fix unused variables (easy — just remove or prefix)
2. Fix `JSX` namespace import
3. Fix `SpecReadouts.tsx` shape width/height (add helper)
4. Fix number/string type mismatch

---

## [OK] 2. Desktop typecheck

**Status: [OK] PASS — no errors in `apps/desktop/tsconfig.json`.**

---

## [TODO] 3. Playwright E2E tests

**Status: [TODO] Not started. Dependencies installed at root level.**

### Directory structure
```
packages/home/e2e/
  home-shell.spec.ts       — shell renders, sidebar nav
  create-file.spec.ts      — new file via preset → editor
  search-sort-filter.spec.ts — recents, search, sort
  keyboard-nav.spec.ts     — file grid keyboard navigation
  context-menu.spec.ts     — right-click, Shift+F10
  trash-flow.spec.ts       — delete → trash → restore
  empty-states.spec.ts     — correct headline per section
  a11y.spec.ts             — axe-core zero violations
```

### Setup
1. Create `packages/home/e2e/` directory
2. Add `playwright.config.ts` at `packages/home/` level (or extend root config)
3. Use `createMemoryPlatform({ seed: { files: 20, projects: 3 } })` as the backend
4. Start Vite dev server via `webServer` config

### Test flows
| Flow | Coverage |
|---|---|
| Home shell | All sections render, sidebar nav selects |
| Create file | Dialog opens, preset creates entry, `onOpenFile` called |
| Search/filter | Query narrows results, sort key/direction changes |
| Keyboard nav | Arrow keys, Home/End, Enter on grid cards |
| Context menu | Right-click opens menu, actions fire (rename, duplicate, trash, pin) |
| Trash lifecycle | File → Trash → Restore → back to list |
| Empty states | Each section shows correct headline, CTA works |
| a11y | `axe-core` scan on each section, zero violations |

---

## [TODO] 4. Thumbnail rendering on desktop

**Status: [TODO] Not wired into save flow. Core infrastructure exists.**

### Current state
- `packages/engine/src/thumbnail.ts` — `renderThumbnail(doc)` works, tested
- `packages/home/src/useThumbnailLoader.ts` — loads via `platform.getThumbnail()`, falls back to `renderThumbnail()` dynamically
- `packages/platform/src/tauri.ts` — thumbnails cached in-memory LRU, NOT persisted to SQLite
- No call to `platform.putThumbnail()` after document save

### Fix
1. **Wire into save flow:** After `platform.upsertFile(entry, documentJson)` in `HomeShell.tsx` (NewFileDialog + TemplatesGallery `onCreate`), call `renderThumbnail(parsedDoc)` and `platform.putThumbnail({ hash, dataUrl, width, height, createdAt })`.
2. **Persist thumbnails on Tauri:** The SQLite `thumbnails` table exists in `strata-sync` via `put_thumbnail()`. Wire the Tauri platform to use it instead of the in-memory LRU. Add a `home_put_thumbnail` / `home_get_thumbnail` IPC command pair.
3. **Optional — freedesktop thumbnails:** Write to `~/.cache/thumbnails/large/<md5-uri>.png` via `home_write_text_file` (interpreting data URL as base64 PNG). This enables OS file-manager previews.

### Execution order
1. Add `home_put_thumbnail` / `home_get_thumbnail` Tauri commands
2. Update `tauri.ts` to use these instead of in-memory LRU
3. Wire `renderThumbnail()` call into `HomeShell`'s `onCreate` paths
4. (Optional) freedesktop thumbnail writing

---

## [TODO] 5. Drag-and-drop DnD reorder (Home)

**Status: [TODO] Not started. Deps installed in `packages/editor/package.json` but not in `packages/home/package.json`.**

### What to implement
- **Drag files between sidebar projects** — drop a file card onto a sidebar project entry to move it to that project
- **Reorder within a project** — drag-and-drop to reorder files (requires ordering key)
- **Note:** OS drag-to-import (item 10) is already [OK] done. This item covers in-app DnD reordering.

### Dependencies needed
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` need to be added to `packages/home/package.json`
- The shared ordering facade (`@strata/shared` `generateKeyBetween`/`midPoint`) is built but not used for file ordering yet
- The `files` table in SQLite needs an `ordering` column (or use `updatedAt` for ordering)

### Implementation approach
1. Add `@dnd-kit/*` deps to `packages/home/package.json`
2. Wrap `FileGrid` with `DndContext` + `SortableContext` (vertical grid)
3. Each `FileCard` becomes a `useSortable` item
4. Sidebar project entries become drop targets via `useDroppable`
5. On `onDragEnd`, call `platform.moveToProject(fileId, projectId)` for cross-project moves
6. For reorder: add `ordering` column to files table, update on drag end

---

## [TODO] 6. File-system watcher

**Status: [TODO] Not started.**

### Approach (Tauri plugin)
- Use `tauri-plugin-fs`'s `watch` API if available, or the `notify` Rust crate
- Watch `app_data_dir` for file changes (rename, delete, create)
- Emit Tauri events to the webview
- HomeShell listens and calls `view.refresh()`

### If using `notify` crate
1. Add `notify` to `apps/desktop/src-tauri/Cargo.toml`
2. In `setup()`, spawn a thread with `notify::RecommendedWatcher`
3. On file events, emit `app.emit("home:files-changed", ())`
4. In `tauri.ts`, listen: `window.__TAURI__.event.listen("home:files-changed", () => refresh)`

### If using `tauri-plugin-fs`
- Investigate `fs:watch` capability in Tauri 2.2+
- May need to add `"fs:allow-watch"` to capabilities

---

## [TODO] 7. Search FTS5 indexing

**Status: [TODO] Not started. Pre-requisite: SQLite FTS5 is available via `rusqlite` `bundled` feature (already enabled).**

### Implementation
1. In `strata-sync/src/lib.rs` `DocumentStore::new()`, add after table creation:
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
     name, kind,
     content='files',
     content_rowid='rowid'
   );
   ```
2. Add triggers to keep FTS5 in sync:
   ```sql
   CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
     INSERT INTO files_fts(rowid, name, kind) VALUES (new.rowid, new.name, new.kind);
   END;
   CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
     INSERT INTO files_fts(files_fts, rowid, name, kind) VALUES('delete', old.rowid, old.name, old.kind);
   END;
   CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
     INSERT INTO files_fts(files_fts, rowid, name, kind) VALUES('delete', old.rowid, old.name, old.kind);
     INSERT INTO files_fts(rowid, name, kind) VALUES (new.rowid, new.name, new.kind);
   END;
   ```
3. Add `search_files(&self, query: &str) -> Result<Vec<FileRow>>` method
4. Add `home_search_files` Tauri command in `lib.rs`
5. (Optional) Wire into `tauri.ts` and `useHomeView.ts`

### Risk
- FTS5 content-sync triggers require `rowid` which SQLite auto-generates but must be used carefully
- Migration path: existing files won't have FTS5 entries until re-indexed. Add a `REINDEX` on startup.

---

## [OK] 8. Keyboard shortcuts for Home

**Status: [OK] Done — `packages/home/src/useHomeShortcuts.ts`**

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New File dialog |
| `Ctrl+O` | Open from disk |
| `Ctrl+F` / `/` | Focus search |
| `Ctrl+Shift+T` | Templates section |
| `Escape` | Close dialogs / context menu |
| `Ctrl+A` | Select all (placeholder) |

---

## [OK] 9. Tauri plugin capabilities

**Status: [OK] Done — `apps/desktop/src-tauri/capabilities/default.json`**

```json
"permissions": [
  "core:default",
  "dialog:allow-open",
  "dialog:allow-save",
  "opener:allow-reveal-item-in-dir"
]
```

---

## [OK] 10. Drag-drop OS file import

**Status: [OK] Done — `HomeShell.tsx` `onDragOver`/`onDrop` handlers**

- Visual drop zone with dashed outline + accent color
- Parses `.strata` files by reading dropped `File` objects
- Imports `.fig`/`.ai`/`.svg`/images with `detectFileKind` and upserts
- Refresh after drop

---

## [TODO] 11. Perf budget: 5000 files @ 60fps

**Status: [TODO] Measurement exercise.**

### How to measure
1. Use `createMemoryPlatform({ seed: { files: 5000, projects: 50 } })`
2. Mount `HomeShell` in a Chromium browser
3. DevTools Performance tab:
   - Record initial render (empty → 5000 files)
   - Record scroll performance (rapid scroll through virtualized list)
   - Record search/filter performance (query narrows 5000→10)
4. Metrics to capture:
   - First Contentful Paint
   - Longest frame (ms)
   % dropped frames during scroll
   - Search response time (keypress → visible filter)

### If perf is poor
- Tune `@tanstack/react-virtual` `overscan` (default 5 → try 3)
- Tune `estimateSize` in `FileGrid`/`FileList`
- Memoize `visibleFiles` computation in `useHomeView`
- Add `React.memo` to `FileCard` and `FileRow` (check if already memoized)

---

## [TODO] 12. Cross-OS verification

**Status: [TODO] Manual testing — platform-dependent.**

### Linux (CachyOS/Arch — primary dev OS)
- [ ] WebKitGTK window renders correctly (Wayland + X11)
- [ ] `app_data_dir` resolves to `~/.local/share/strata/`
- [ ] Native file picker (dialog plugin) works
- [ ] Reveal in Files (opener plugin) works

### macOS
- [ ] `app_data_dir` resolves to `~/Library/Application Support/strata/`
- [ ] `Reveal in Finder` label appears
- [ ] Native file picker works
- [ ] Window decoration (traffic lights) doesn't clip content

### Windows
- [ ] `app_data_dir` resolves to `%APPDATA%/strata/`
- [ ] `Reveal in Explorer` label appears
- [ ] Native file picker works
- [ ] Backslash paths handled correctly in IPC

### Pre-requisites
- Cross-OS CI build (GitHub Actions matrix with `ubuntu-latest`, `macos-latest`, `windows-latest`)
- Automated smoke test via Playwright on each OS

---

## [OK] 13. Reduced-motion gate

**Status: [OK] Done**

- `@media (prefers-reduced-motion: reduce)` disables `.strata-home__sidebar` `transition`
- Token system already sets `--duration-*` to `0ms` when reduced-motion is active (in `tokens.css`)
- Skeleton shimmer animation in `home.css` uses `--duration-shimmer` which is zeroed by the token system
- **Verify:** Add `@media (prefers-reduced-motion: reduce)` blocks for any remaining animation rules

---

## Summary

| # | Item | Status | Effort |
|---|---|---|---|
| 1 | Editor typecheck | [OK] Done | — |
| 2 | Desktop typecheck | [OK] Done | — |
| 3 | Playwright E2E | [TODO] 8 spec files | ~2 hr |
| 4 | Thumbnail desktop | [TODO] Wire into save flow | ~1 hr |
| 5 | DnD reorder | [TODO] Home + sidebar | ~3 hr |
| 6 | File watcher | [TODO] Tauri plugin | ~1 hr |
| 7 | FTS5 search | [TODO] strata-sync | ~1 hr |
| 8 | Keyboard shortcuts | [OK] Done | — |
| 9 | Tauri capabilities | [OK] Done | — |
| 10 | Drag-drop OS import | [OK] Done | — |
| 11 | Perf budget | [TODO] Measure only | ~30 min |
| 12 | Cross-OS | [TODO] Manual test | ~2 hr |
| 13 | Reduced-motion | [OK] Done | — |

**Total remaining effort:** ~11 hours
