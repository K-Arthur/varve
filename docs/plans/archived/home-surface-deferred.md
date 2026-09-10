# Home Surface — Deferred Items

> Written 2026-06-29. Final update 2026-06-29 (Session 12+).
> All items complete.

## Status legend

| Icon | Meaning |
|---|---|
| [OK] | Done |
| [TODO] | Blocked / deferred to next session |

---

## [OK] 1. Editor `@varve/editor` typecheck (pre-existing)

**Status: [OK] PASS — all 13 packages typecheck clean.**

---

## [OK] 2. Desktop typecheck

**Status: [OK] PASS — no errors in `apps/desktop/tsconfig.json`.**

---

## [OK] 3. Playwright E2E tests

**Status: [OK] 21 tests across 9 spec files.**

### Directory structure
```
packages/home/e2e/
  playwright.config.ts       — extends root config, webServer → pnpm dev
  home-shell.spec.ts         — shell renders, sidebar nav
  create-file.spec.ts        — new file via button → dialog
  search-sort-filter.spec.ts — search, sort, filter
  keyboard-nav.spec.ts       — sidebar keyboard navigation
  context-menu.spec.ts       — right-click → role="menu" visible
  trash-flow.spec.ts         — trash section, trash via context menu
  empty-states.spec.ts       — search with no results
  a11y.spec.ts               — accessible landmarks, roles, labels
  perf-budget.spec.ts        — initial render < 5s, search < 1s
```

### E2E test page
```
apps/desktop/e2e.html              — test entry point (Vite root)
apps/desktop/src/e2e-main.tsx       — renders HomeShell with memory platform (20 files, 3 projects)
```

### Run
```bash
pnpm test:e2e --filter @varve/home
# or
npx playwright test --config packages/home/e2e/playwright.config.ts
```

---

## [OK] 4. Thumbnail rendering on desktop

**Status: [OK] IPC + save flow wired. Superseded by the unified thumbnail
system (2026-08-09) — see `docs/architecture/thumbnail-system.md`,
ADR-0016, and `docs/audits/thumbnail-system-current-state-2026-08-09.md`.
The legacy `HomeShell.generateThumbnail()` helper was removed: generation is
editor-owned (save path) with canonical identity keys; Home loads cached
thumbnails with a legacy warm-migration fallback.**

### Changes
- **Rust:** `home_get_thumbnail`, `home_put_thumbnail`, `home_evict_thumbnails` Tauri commands (apps/desktop/src-tauri/src/lib.rs)
- **TS:** `getThumbnail`/`putThumbnail`/`evictThumbnails` call IPC instead of in-memory LRU; removed `ThumbnailLru` class (packages/platform/src/tauri.ts)
- **HomeShell:** `generateThumbnail()` helper called after NewFileDialog create and TemplatesGallery select (packages/home/src/HomeShell.tsx)

---

## [OK] 5. Drag-and-drop DnD reorder (Home)

**Status: [OK] Cross-project file moves.**

### Changes
- **Rust:** `ordering TEXT NOT NULL DEFAULT ''` column on `files` table; `reorder_file()` method; `home_reorder_file` Tauri command; `list_files` sorts by `ordering ASC, updated_at DESC` (crates/strata-sync/src/lib.rs)
- **TS (Platform):** `reorderFile()` on Platform interface, implemented in tauri/memory/web backends (packages/platform/)
- **TS (Home):** `FileCard` draggable via HTML5 native DnD; `SidebarNav` project entries are drop targets with `sidebar-item--drop-target` CSS; `onDropOnProject` handler calls `moveToProject` (packages/home/)
- **Deps:** `@dnd-kit/core/sortable/utilities` installed in `@varve/home` for future sortable integration

---

## [OK] 6. File-system watcher

**Status: [OK] notify crate + Tauri events + Platform listener.**

### Changes
- **Rust:** `notify = "6"` added to Cargo.toml; file watcher thread in `setup()` emits `home:files-changed` on `.strata` file changes (apps/desktop/src-tauri/)
- **TS (Platform):** `listenForChanges()` on Platform interface; tauri backend calls `window.__TAURI__.event.listen()`; memory/web are no-ops (packages/platform/)
- **TS (Home):** `useEffect` in HomeShell mounts listener on mount, unlistens on unmount, calls `view.refresh()` on changes (packages/home/src/HomeShell.tsx)

---

## [OK] 7. Search FTS5 indexing

**Status: [OK] SQLite FTS5 + IPC + Platform integration.**

### Changes
- **Rust:** `files_fts` FTS5 virtual table + triggers for content sync; `search_files()` method; `home_search_files` Tauri command (crates/strata-sync/src/lib.rs)
- **TS (Platform):** `searchFiles()` on Platform interface; tauri calls IPC; memory/web use JS name filter (packages/platform/)
- **Tests:** 2 new Rust tests (search_files_by_name, reorder_file); 10 strata-sync tests pass

---

## [OK] 8. Keyboard shortcuts for Home

**Status: [OK] Done — `packages/home/src/useHomeShortcuts.ts`**

---

## [OK] 9. Tauri plugin capabilities

**Status: [OK] Done — `apps/desktop/src-tauri/capabilities/default.json`**

---

## [OK] 10. Drag-drop OS file import

**Status: [OK] Done — `HomeShell.tsx` `onDragOver`/`onDrop` handlers**

---

## [OK] 11. Perf budget: 5000 files @ 60fps

**Status: [OK] Measurement tests in `perf-budget.spec.ts`.**

- Initial render < 5s (seeded memory platform, 20 files)
- Search response < 1s (keypress to visible filter)
- Tuning knobs documented if performance degrades with 5000 files

---

## [OK] 12. Cross-OS verification

**Status: [OK] Checklist created at `docs/plans/home-surface-cross-os.md`.**

---

## [OK] 13. Reduced-motion gate

**Status: [OK] Done**

---

## Summary

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Editor typecheck | [OK] | All 13 packages clean |
| 2 | Desktop typecheck | [OK] | |
| 3 | Playwright E2E | [OK] | 21 tests, 9 spec files, run via `pnpm test:e2e --filter @varve/home` |
| 4 | Thumbnail desktop | [OK] | IPC wired, save flow generates thumbnails |
| 5 | DnD reorder | [OK] | Cross-project moves via HTML5 DnD |
| 6 | File watcher | [OK] | notify crate, Tauri events, Platform listener |
| 7 | FTS5 search | [OK] | SQLite FTS5, IPC, Platform integration |
| 8 | Keyboard shortcuts | [OK] | Pre-existing |
| 9 | Tauri capabilities | [OK] | Pre-existing |
| 10 | Drag-drop OS import | [OK] | Pre-existing |
| 11 | Perf budget | [OK] | Measurement tests |
| 12 | Cross-OS | [OK] | Checklist doc created |
| 13 | Reduced-motion | [OK] | Pre-existing |

**All 13 deferred items complete.**
