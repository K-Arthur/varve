# Mockup System — Vertical Slice Report (2026-08-05)

Status of the non-destructive mockup system after the Level 1 + Level 2
vertical slice. Canonical docs: `docs/architecture/mockup-system.md`,
ADR-0015, `docs/audits/mockup-capability-audit-2026-08-05.md`.

## What shipped

### Scene (`@varve/scene/src/mockup/`)
- Persistent template contract (surfaces, quad/flat geometry, plates,
  overlays, licensing) embedded in `Document.mockupTemplates` — documents
  are self-contained; save/reopen and offline use never touch a library.
- `FrameNode.mockup` instance payload with live-node and embedded-snapshot
  bindings plus per-surface overrides.
- 12 built-in templates: phone (front + angled), tablet, browser window,
  monitor, laptop (angled), poster, business card (front/back — the
  multi-surface case), book cover (angled), packaging box (angled), social
  board, logo board. All original vector art — no device trade dress, no
  brand marks — licensed FSL-1.1-MIT with attribution "Varve contributors".
- Untrusted-input validation with limits (shape/surface counts, geometry
  magnitude, output dimensions); reserved kinds ('mesh', 'cylindrical') and
  reserved mask assets are rejected until implemented.
- Codec integration: sanitize pass on load, template pruning, clipboard
  closure (templates + snapshot assets), `removeNode` GC and
  `isAssetReferenced` cover snapshot bindings.
- Level 5 request contract (typed, validated) in `mockup/multimodal.ts`.

### Engine (`@varve/engine/src/mockup/`, replay)
- `solveHomography` (normalized DLT, round-trip validation), quad
  validation (crossing/concave/collinear/non-finite rejection), inverse,
  point mapping.
- `warpImageToQuad` — per-pixel inverse-homography bilinear warp (true
  projective mapping).
- `fitRect` — contain/cover/stretch/native + alignment.
- `warpedImage` IR primitive with a replay case extracted into
  `mockup/warpReplay.ts` (replay.ts switch gained only case labels; the
  protected hot path was benchmarked — 100 rects p95 33.8ms < 50ms,
  1000 rects p95 64.8ms < 500ms, no regression).

### Editor
- `render/mockup/mockupIr.ts`: `decorateMockupIr` composes mockup frames
  into the IR (plate shapes, baked surface rasters, shadows, glows,
  placeholders). Surface bake replays the live source subtree through the
  structural replay at slot resolution, fitted contain/cover/stretch/native,
  cached LRU by (frame, surface, source digest, bucket) with a byte budget.
  CanvasArea, the worker path, and the export compositor render identical
  items (preview/export parity by construction); export re-renders sources
  at export scale.
- Linked updates: the source digest invalidates only the affected surfaces;
  edits to the source update the mockup without full-document rework.
- UI: Mockups tab in the resources panel (search, category/orientation
  filters, accurate SVG previews, favourites/recents, licence display,
  Apply), canvas context menu ("Apply mockup…"), command palette entries,
  inspector Mockups section (binding status, missing-source warnings,
  Replace, fit controls, Reveal in library, Remove).
- Apply flow: one undoable transaction; multi-surface templates cycle
  sources; the mockup frame is placed beside the first source and selected.

### Tests
- Engine: 37 geometry tests (solve/inverse/degenerates/warp/fit) + 4
  structural goldens for `warpedImage`.
- Scene: 18 tests (catalog validity, dedup, ops, digest, codec round-trip,
  normalization, closure, import limits, multimodal validation).
- Editor: 7 decoration tests + 6 panel RTL tests.
- E2E: `tests/e2e/canvas/mockups.spec.ts` — the full 12-step workflow plus
  the multi-surface workflow (see "E2E caveat" below).

## E2E caveat (concurrent environment)

At the time of writing, master's committed tree references warp modules
(`packages/engine/src/warp*`, `packages/scene/src/warp*`) that only exist
uncommitted in the working tree, so the app cannot boot from a clean
checkout (including this worktree). The E2E spec was exercised to the panel
stage against the running main tree; final green runs must happen after the
concurrent warp modules land. The scene codec round-trip (save/reopen
fidelity) is covered by unit tests that do run.

## Deferred (documented)

| Area | Status | Reference |
|---|---|---|
| Mesh / cylindrical surfaces (Level 3) | schema reserved, validation rejects | `docs/architecture/mockup-system.md` |
| Photographic raster templates, occluders, displacement (Level 4) | schema reserved | same |
| Multimodal detection (Level 5) | request contract shipped; model pipeline designed | `docs/plans/mockup-multimodal-deferred.md` |
| Canvas quad-corner overlay handles | not shipped (numeric inspector + template geometry cover placement) | follow-up |
| Batch variants / multi-template export | not shipped | follow-up |
| Home-surface discovery | not shipped (editor-side discovery is primary) | follow-up |
| Community template packs | not shipped (icon-pack precedent exists) | follow-up |
| Snapshot capture UI (embedded snapshot binding) | binding mode implemented; capture action not wired | follow-up |

## Commits

Milestone commits (master, `[mockups]`-related):
- `174e3789` docs: ADR-0015, capability audit, architecture
- `e25d3b61` engine: homography/quad warp/fit + 37 tests
- `00a8b6c7` scene: mockup schema, catalog, ops, codec + 18 tests
- `1bf0732f` engine: `warpedImage` primitive + goldens + bench
- `02cdc069` editor: mockup IR decoration + export parity + 7 tests
- `4bb55c01` editor: Mockups UI (panel, actions, context menu, inspector)
- `51317875` (branch feat/mockups-vertical-slice) E2E spec + tab-request fix

Note: several commits landed while a concurrent session was actively
committing in the same repository; a small number of its files were swept
into the milestone commits (and repaired/verified). Attribution of the
mockup code itself is the commits listed above.
