# Consolidated Final Push — Complete All Deferred Work

> **Goal:** Complete every remaining deferred item across all surface areas with no further deferrals.
> **Total estimated effort:** 30–40 days (multiple sessions required — this plan enables subagent parallelism)

## Scope summary

| Area | Remaining items | Total effort |
|---|---|---|
| **Tools** | Snapping, floating toolbar, NodeEdit, BooleanActions | ~14h |
| **Home** | E2E tests, thumbnails, DnD, file watcher, FTS5, perf, cross-OS | ~11h |
| **Inspector** | Fill stacks+gradients, grid layout, component slots, binding UX, E2E | ~18d |
| **Spec Panel** | Token-aware codegen, cross-platform verify, PDF wire | ~3d |
| **Infrastructure** | Packaging CI matrix (AppImage/deb/dmg/msi/AUR) | ~2d |

---

## PHASE T1 — Tools (highest signal, ~14h)

### T1a: Snapping & Smart Guides (3h)

| File | Action |
|---|---|
| `packages/editor/src/tools/snapping.ts` | NEW — `snapPosition()` with edge/center/grid/spacing snapping |
| `packages/editor/src/components/SnapGuidesOverlay.tsx` | NEW — SVG overlay, red/magenta guide lines with distance labels |
| `packages/editor/src/tools/__tests__/snapping.test.ts` | NEW — grid/edge/center snap tests |
| `packages/editor/src/tools/BaseTool.ts` | MODIFY — integrate snap into `computeDragRect()`/`computeDragLine()` |
| `packages/editor/src/CanvasArea.tsx` | MODIFY — render `SnapGuidesOverlay` |

### T1b: Floating Bottom-Center Toolbar (4h)

| File | Action |
|---|---|
| `packages/editor/src/components/FloatingToolbar/FloatingToolbar.tsx` | NEW — pill toolbar, tool groups with flyouts, keyboard nav |
| `packages/editor/src/components/FloatingToolbar/FloatingToolbar.css` | NEW — backdrop blur, pill shape, responsive overflow |
| `packages/editor/src/components/FloatingToolbar/ToolGroupFlyout.tsx` | NEW — flyout menu per tool group |
| `packages/editor/src/Shell.tsx` | MODIFY — replace `<ToolPanel />` with `<FloatingToolbar />` |
| `packages/editor/src/editor.css` | MODIFY — remove `.editor-toolbar` grid row |
| `packages/editor/src/ToolPanel.tsx` | ARCHIVE |
| `packages/editor/src/components/FloatingToolbar/__tests__/FloatingToolbar.test.tsx` | NEW — APG toolbar keyboard nav, flyout menus |

### T1c: NodeEditTool (4h)

| File | Action |
|---|---|
| `packages/editor/src/tools/NodeEditTool.ts` | NEW — anchor select/move, add/remove, corner <-> smooth, box-select, handle symmetry, arrow nudge |
| `packages/editor/src/tools/__tests__/NodeEditTool.test.ts` | NEW — click selects anchor, drag moves, Enter to commit |

### T1d: BooleanActions (3h)

| File | Action |
|---|---|
| `packages/editor/src/tools/BooleanActions.ts` | NEW — union/subtract/intersect/exclude, 2+ shape nodes required |
| `packages/editor/src/tools/__tests__/BooleanActions.test.ts` | NEW — each op produces correct result shape |

---

## PHASE H1 — Home Surface (~11h)

### H1a: Playwright E2E (2h)

| File | Action |
|---|---|
| `packages/home/e2e/home-shell.spec.ts` | NEW |
| `packages/home/e2e/create-file.spec.ts` | NEW |
| `packages/home/e2e/search-sort-filter.spec.ts` | NEW |
| `packages/home/e2e/keyboard-nav.spec.ts` | NEW |
| `packages/home/e2e/context-menu.spec.ts` | NEW |
| `packages/home/e2e/trash-flow.spec.ts` | NEW |
| `packages/home/e2e/empty-states.spec.ts` | NEW |
| `packages/home/e2e/a11y.spec.ts` | NEW |

### H1b: Thumbnail desktop (1h)

**Superseded by the unified thumbnail system (2026-08-09): canonical
identity keys, editor-owned generation, user-selectable sources, shared
scheduler. See `docs/architecture/thumbnail-system.md`.**

| File | Action |
|---|---|
| `apps/desktop/src-tauri/src/lib.rs` | MODIFY — add `home_put_thumbnail`/`home_get_thumbnail` IPC commands |
| `packages/platform/src/tauri.ts` | MODIFY — use IPC instead of in-memory LRU |
| `packages/home/src/HomeShell.tsx` | MODIFY — call `renderThumbnail()` after `onCreate` |

### H1c: DnD reorder (3h)

| File | Action |
|---|---|
| `packages/home/package.json` | MODIFY — add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `packages/home/src/FileGrid.tsx` | MODIFY — wrap with `DndContext` + `SortableContext`, each card `useSortable` |
| `packages/home/src/Sidebar.tsx` | MODIFY — project entries become `useDroppable` targets |
| `packages/platform/src/platform.ts` | MODIFY — add `reorderFile` method |
| `packages/platform/src/tauri.ts` | MODIFY — wire `reorderFile` to IPC |

### H1d: File watcher (1h)

| File | Action |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | MODIFY — add `notify` crate |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFY — spawn `notify::RecommendedWatcher`, emit `home:files-changed` |
| `packages/platform/src/tauri.ts` | MODIFY — listen for `home:files-changed` event |

### H1e: FTS5 search (1h)

| File | Action |
|---|---|
| `crates/strata-sync/src/lib.rs` | MODIFY (already partially done) — wire search to Tauri |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFY — add `home_search_files` command |

### H1f: Perf + cross-OS (3h)

| File | Action |
|---|---|
| `docs/plans/home-surface-deferred.md` | MODIFY — record perf measurement results |
| `tests/e2e/platform/cross-os.spec.ts` | NEW — basic OS-specific path checks |

---

## PHASE I1 — Inspector Final Push (~18d)

See `docs/plans/inspector-final.md` for full phase breakdown. Summary:

| Track | Description | Effort |
|---|---|---|
| **I-A** | Fill stacks + gradient editor (model → render → UI → tests) | 8d |
| **I-B** | Grid layout + fluid sizing (Taffy grid → TS model → UI) | 4d |
| **I-C** | Component slots + binding UX + corner smoothing | 3d |
| **I-D** | E2E + axe-core tests | 3d |

High-value parallelization:
- Track A (fills) can run independently from B/C/D
- Track B (grid) can run independently from A/C/D
- Track C (slots) can run independently from A/B/D
- Track D (tests) should run after A/B/C

---

## PHASE S1 — Spec Panel (~3d)

| Phase | Description | Effort |
|---|---|---|
| **D5** | Token-aware codegen — replace hardcoded values with variable tokens in generated code | 1d |
| **D6** | Cross-platform verification — test Spec Panel on macOS + Windows | 1d |
| **D7** | PDF export wiring — verify `export_node_pdf` Tauri command end-to-end | 1d |

---

## PHASE X1 — Infrastructure (~2d)

| Item | Description | Effort |
|---|---|---|
| **0.11** | CI/CD packaging matrix: AppImage (linux), .deb, .dmg (macOS), .msi (Windows), AUR PKGBUILD | 2d |

---

## Recommended execution order (subagent-parallelizable)

Each session has a self-contained prompt document:

| Session | Prompt | Agents | Items |
|---|---|---|---|
| **1** | `docs/plans/session-01-tools-home.md` | 3 parallel | Snapping + Floating Toolbar + Home Surface + Inspector Fill Stacks |
| **2** | `docs/plans/session-02-tools-inspector.md` | 3 parallel | NodeEdit + Boolean + Grid Layout + Component Slots |
| **3** | `docs/plans/session-03-inspector-e2e-spec.md` | 2 parallel | Inspector E2E/axe-core + Spec Panel D5-D7 |
| **4** | `docs/plans/session-04-packaging.md` | 1 agent | CI/CD packaging matrix + AUR PKGBUILD |

### Per-agent isolation rules

| Agent pairs | Safe in parallel? | Boundary |
|---|---|---|
| Tools × Home | YES | `packages/editor` vs `packages/home` + `apps/desktop` |
| Tools × Inspector | YES | `tools/` vs `Inspector/` |
| Home × Inspector | YES | `packages/home` + `platform` vs `packages/editor/Inspector` |
| Inspector internal (A×B) | YES | `FillSection` vs `LayoutSection` (independent files) |
| Inspector internal (C×D) | PARTIAL | C modifies context & NumberField; D tests those |
| Spec × anything | YES | `packages/codegen` + `packages/editor/SpecPanel` vs everything else |
| Infrastructure × anything | YES | `apps/desktop` CI config vs everything else |

---

## Pre-requisite checks before each session

```bash
# Verify current state
git log --oneline -3
pnpm typecheck
cargo test --workspace
npx vitest run packages/editor packages/codegen packages/engine packages/scene
```

## Post-session gate checklist

```bash
just gate          # format-check + lint + test + audits
pnpm typecheck     # zero TS errors
cargo test --workspace  # all Rust tests pass
pnpm audit:emoji   # zero emoji violations
pnpm audit:tokens  # 51/51 WCAG AA pairs
```

---

## What to block (risks)

| Risk | Mitigation |
|---|---|
| Floating toolbar conflicts with existing ToolPanel code | Archive ToolPanel.tsx, update all imports to point to FloatingToolbar |
| Taffy 0.11 grid API mismatch | Pin version, check `grid_template_columns` API before coding |
| Fill migration breaks existing documents | `migrateDocument()` in scene, backward compat fallback path |
| axe-core finds pre-existing violations | Fix as found; block only violations in changed code |
| E2E flaky on async rendering | `toPass()` retry, `waitForSelector` patterns |
| This plan is too large for one agent session | Use the subagent dispatch strategy above |

---

## Status tracking

After completing each phase, mark it in this document and update the individual deferred plan files.
Then archive each completed deferred plan by moving to `docs/plans/archived/`.
