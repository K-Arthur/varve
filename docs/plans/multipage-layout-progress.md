# Multi-Page Layout Program — Progress Tracker (2026-08-05)

Status of the shared multi-page canvas, master pages, linked text flow, and
page-level print geometry program. Canonical docs: the audit
(`docs/audits/multipage-layout-audit-2026-08-05.md`) and ADRs 0122-0154.

## Milestone tracker

| # | Milestone | Status | Commits (feat/multipage-layout) |
|---|---|---|---|
| 1 | Audit and baselines | **Done** | `0e48a0dc` test(layout) baselines; `44910708` docs(layout) audit + ADRs |
| 2 | Coordinate architecture | **Done** | `ac794646` feat(scene): page-aware coordinate spaces |
| 3 | Page ownership and placement | **Done** | `6a2e34e8` ownership/deletion/duplicate remap; `2a9ce091` page.* ops + v2.17 migration |
| 4 | Spread and section model | **Done** | `004d8474` persistent spread topology + numbering resolver |
| 5 | Multipage canvas rendering | **Done** | foundation `ed900d7e`; editor integration `b7ce54f5`, `aa28b072`, `5ab5456e`, `9954902a`, `e2e` spec |
| 6 | Page interactions (Page Tool, cross-page) | **Done** | `91253130` PageTool/cross-page/snapping/fit; `aa28b072`-era overlays |
| 7 | Pages/Spreads panel | **Done** | PagesPanel (windowed rows, thumbnails, reorder, a11y) |
| 8 | Master-page hardening (projection fix, overrides UI) | **Done (projection)** | `7df1d198` B3 fix + master rendering with per-page placement; override UI in a later pass |
| 9 | Story/frame separation | **Done** | `fa877f04` story model + v2.18 migration + ops |
| 10 | Production text composition | **Done (core)** | `a414888d` deterministic composition + keys; worker/incremental reflow pending |
| 11 | Text-thread frontend | **Done** | `d2279ed8` overlay + link/unlink commands + overset badges |
| 12 | Page-level print geometry | **Done** | `f4d47376` resolution + previews + inspector |
| 13 | Print marks and PDF boxes | **Partial** | `40076986` page ranges + filename tokens; crate-side multipage PDF pending |
| 14 | Import/export integration | **Partial** | `788768a8` capability reporting; `462d8fa7` page-based start mode; native multipage PDF import pending |
| 15 | History/diff/merge/collab integration | Pending (depends on the history package now landed by the workspace track) | |
| 16 | Multimodal layout assistance | Pending | |
| 17 | Hardening | In progress | `reports/multipage-screenshots/` review captures |
| 15 | History/diff/merge/collab integration | Pending | |
| 16 | Multimodal layout assistance | Pending | |
| 17 | Hardening | Pending | |

## Delivered so far

### M1 — audit + baselines
- Evidence-backed audit of the page model, spread topology, master pages,
  text chains, canvas, print, frontend, and persistence surfaces
  (`multipage-layout-audit-2026-08-05.md`), including the active-page
  assumption inventory and capability matrices.
- 33 ADRs (0122-0154) covering every mandated decision topic.
- `multipageBaseline.test.ts`: 15 pins of current behavior, including the
  known defects the program must fix:
  - B1 no pasteboard placement, B2 spread-id instability, B3 hidden/deleted
    override projection bug, B4 char-count text flow, B5 duplicate chain
    staleness, B6 silent content deletion on page removal.

### M2 — coordinate architecture
- `Page.placement` / `Spread.placement` (layout metadata, never content).
- `pasteboardLayout.ts`: deterministic auto layout (vertical spread stack,
  gaps 96/144), placement resolution, page/spread/pasteboard bounds.
- `coordinateService.ts`: `pageToWorld`/`worldToPage`/`spreadToWorld`/
  `worldToSpread`/`nodeBoundsOnPage`.
- `setPagePlacement` with finite/bounded-coordinate validation.
- Property tests: round-trip inverses, placement never mutates content,
  reorder never touches content/placement, determinism, cross-page world
  preservation.

### M3 — page ownership and placement
- `pageOwnership.ts`: `resolveOwnership` (page/master/pasteboard/global),
  `validatePageOwnership` invariant checks.
- `deletePageWithPolicy`: delete-content / move-to-pasteboard / move-to-page.
- `duplicatePage` remaps text chains onto the cloned frames (B5 fixed).
- `operations/ops/pageOps.ts`: `page.create` (after-page insertion),
  `page.delete` (policy), `page.duplicate`, `page.reorder`, `page.resize`
  (scaleContent), `page.move-on-pasteboard` — registered in the bootstrap.
- Document version 2.17: placement materialization migration + binding
  direction default (B-series; also fixed the pre-existing
  `version.test.ts` chain-end failures).

### M4 — spread and section model
- `Spread.kind` (single/facing/foldout/custom), `spreadModel`
  (derived/custom), `FacingPagesConfig.bindingDirection` (ltr/rtl).
- `spreadsFromProjection`: stable spread ids (`spread-<index>`), never
  regenerated (B2 fixed); `rebuildSpreads` never clobbers custom spreads.
- `getPageSide` honors RTL binding direction.
- `pageNumbering.ts`: single-pass `computePageNumbering` (section, number,
  formatted string, parity from display number, first/last-in-section);
  legacy `getPageNumber`/`getFormattedPageNumber` delegate to it.

### M5 foundation — placed page scene
- `pageScene.ts`: `placedPages` (resolved placement, bounds, content/
  background nodes, page number, spread origin, export flag),
  `pagesVisibleInWorldRect` (page-level culling),
  `worldToPageAtPoint` (world → page + page-local).
- Pure, deterministic, no hub-file changes; the editor renderer consumes
  this contract in the M5 rendering milestone.

### M5 — multipage canvas rendering (2026-08-07)

Editor integration of the placed page scene, committed on master:

- `multipageRootNodes` (scene): paint-order root list — globals, pasteboard
  items, then per-page backgrounds + content — with viewport-level page
  culling; flat documents fall back to `activePageNodes` semantics.
- `buildPlacedScene` single-pass refactor: placement, numbering, spread
  membership and bounds resolve once per document (kills the per-page
  `autoPageLayout` O(n²) re-scan).
- Placed world space (ADR-0123): `pagePlacement.ts` node→placement map;
  `transformCache` and editor `world.ts` append the placement translation,
  so renderer transforms, spatial index, hit testing, selection overlays,
  snapping and dirty regions all see the pasteboard. `invalidationPlan`
  treats page placement/size changes as structural (transform-cache wipe);
  the IR hash already includes the world transform, so per-node IR caches
  invalidate correctly on placement changes.
- Dirty regions: `page-before`/`page-after` rects (expanded by the
  decoration label band) for placement/size changes — page moves now
  repaint instead of leaving stale pixels.
- `drawPageDecorations`: per-page drop shadow, trim fill, active-page
  accent ring and label band (page number / name), painted between the
  board fill and content replay in the fallback path and via a
  `paintUnderlays` hook on the present-only worker path. Colors resolve
  from design tokens cached per theme revision.
- CanvasArea walks the multipage scene with a `viewportWorldRect` culling
  rect; HitTestEngine hits content on any placed page (cross-page
  selection).
- Tests: scene root-builder suite (paint order, culling, determinism),
  pageDecorations mock-ctx suite, placed-world transform suite, dirty-
  region placement cases, cross-page hit-test case; canvas10k bench and
  engine replay bench green. E2E spec `tests/e2e/canvas/multipage-canvas.spec.ts`
  verifies multi-page rendering + cross-page selection (blocked in-tree
  while unrelated WIP breaks app boot; run once the tree settles).

## Validation status per commit

Each commit passed the pre-commit gate (biome lint on touched files, emoji
audit, architecture health/dependency-cycle check) and its focused test
suite (129 multipage + version tests green at M5). Repo-wide gates are
blocked by pre-existing mid-flight WIP from other sessions (engine
`./warp` module graph and table/warp goldens not yet committed to master);
those failures predate this program and are tracked separately.

## Known open items (in priority order)

1. M6 page interactions: Page Tool, cross-page drag/marquee, page-aware
   snapping, page/spread/pasteboard rulers, guides, zoom-to-page/spread
   commands, active-page background selection (canvas-side: select page by
   clicking its trim; hit-test scoping is ready).
2. M7 Pages/Spreads/Masters panel with lazy thumbnails; Pages panel must
   not compose every page.
3. B3 fix: `activePageNodesWithMaster` still projects hidden/deleted
   master nodes (M8).
4. Text flow: story model, real composition, incremental reflow (M9/M10).
5. Print geometry resolution + canvas preview (M12) and PDF boxes (M13).
6. Page-range export, multipage PDF, spread export (M13/M14).
7. Semantic diff/merge for pages/spreads/masters/stories (M15).
8. Multimodal proposal pipeline (M16).
9. Perf follow-up: `placedPages` is still recomputed per consumer per frame
   (decorations + scene roots); share one placed scene per frame when the
   page count grows. Page labels use a single 11px token font; label
   kerning/measurement can batch later.
10. Minimap, layers tree, and thumbnails still resolve the active page
    only (M6/M7 scope); they now disagree with the canvas (which shows all
    pages) — expected mid-migration state, tracked by the audit inventory.
