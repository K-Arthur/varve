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
| 5 | Multipage canvas rendering | **Foundation** | `ed900d7e` placed page scene (scene-side contract); editor rendering pending |
| 6 | Page interactions (Page Tool, cross-page) | Pending | |
| 7 | Pages/Spreads panel | Pending | |
| 8 | Master-page hardening (projection fix, overrides UI) | Pending | |
| 9 | Story/frame separation | Pending | |
| 10 | Production text composition | Pending | |
| 11 | Text-thread frontend | Pending | |
| 12 | Page-level print geometry | Pending | |
| 13 | Print marks and PDF boxes | Pending | |
| 14 | Import/export integration | Pending | |
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

## Validation status per commit

Each commit passed the pre-commit gate (biome lint on touched files, emoji
audit, architecture health/dependency-cycle check) and its focused test
suite (129 multipage + version tests green at M5). Repo-wide gates are
blocked by pre-existing mid-flight WIP from other sessions (engine
`./warp` module graph and table/warp goldens not yet committed to master);
those failures predate this program and are tracked separately.

## Known open items (in priority order)

1. M5 editor integration: CanvasArea walks `activePageNodes`; switch to
   `placedPages` with page-level culling, page shadows/backgrounds, labels.
   Must respect the CanvasArea import budget and benchmark the replay path.
2. B3 fix: `activePageNodesWithMaster` still projects hidden/deleted
   master nodes (M8).
3. Text flow: story model, real composition, incremental reflow (M9/M10).
4. Print geometry resolution + canvas preview (M12) and PDF boxes (M13).
5. Page-range export, multipage PDF, spread export (M13/M14).
6. Semantic diff/merge for pages/spreads/masters/stories (M15).
7. Pages/Spreads/Masters panel with lazy thumbnails (M7).
8. Multimodal proposal pipeline (M16).
