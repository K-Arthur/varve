# Multi-Page Layout System — Current-State Capability Audit (2026-08-05)

Evidence-backed status of every capability required by the shared multi-page
canvas, master pages, linked text flow, and page-level print geometry program,
verified against the working tree at commit `1869cf10` (master, with unrelated
unstaged worktree changes preserved untouched).

Scope: page model, spread topology, master pages, text chains, canvas
architecture, print geometry, frontend, persistence/history/diff/merge/collab.

## 1. Executive summary

Varve already has a **real page model** (per-page width/height, fractional
`order` keys, per-page bleed/safeArea/slug overrides, content roots, master
assignment, master overrides, sections, derived spreads, text chains as ordered
frame lists) — but the system is **active-page-first**: the renderer, hit
testing, layers, minimap, thumbnails, and export all resolve one active page,
and pages have **no pasteboard placement** (every content root sits at world
origin). Master content is **never rendered**, master overrides have **no UI**
and a **hidden/deleted projection bug**, spreads are **recomputed projections
with unstable IDs and no placement**, and linked-text flow is **dead
scaffolding** (`splitRichTextByCharLimit` has zero production callers; the
preflight overset check is hard-coded `unavailable`). PDF export is single-page
only (`maxPageCount: 1`), with no CropBox/ArtBox, no page-range parser, and
bleed sent from the dialog rather than the document. Persistence is
versioned (v2.16) and canonical (ADR-0027), but there are **no semantic
page/master/story operations**, diff is blind to pages/spreads/masters, and
there is **no document three-way merge** (collab is stubbed).

The foundation is sound (persistent IDs, canonical serialization, pure
scene functions, a coordinate service, a strong Rust PDF/X path, real font
enumeration); the work is architectural completion, not a rewrite.

## 2. Page-model inventory

| Fact | Evidence |
| --- | --- |
| `Page` type: id (crypto UUID), name, width, height, `order` (fractional key), bleed/safeArea/slug overrides, backgrounds[], contentRoot, rulerOrigin, masterPageId, masterOverrides, printSettings | `packages/scene/src/types.ts:1573-1598` |
| Page IDs minted with `cryptoId()` = `crypto.randomUUID()`; no counter component (distinct from node ID space) | `packages/scene/src/document-utils.ts:22-25`, `packages/scene/src/identity.ts:104-114` |
| Page CRUD: addPage, removePage, reorderPages, duplicatePage, setPageSize, setPageSizeWithContentScale, migrateToPages, setActivePage | `packages/scene/src/document-pages.ts:33-304, 313-348, 353-382` |
| Per-page dimensions are schema-supported (mixed sizes possible); `setPageSize` changes size without touching content | `packages/scene/src/document-pages.ts:229-242` |
| Page deletion removes contentRoot + descendants + backgrounds; guards last page; **silently deletes content** (no move-to-pasteboard option) | `packages/scene/src/document-pages.ts:75-100` |
| Duplicate deep-clones subtree with new IDs, remaps mask/slots — **does not remap text chains, components/instances, or variable bindings that reference old node IDs** | `packages/scene/src/document-pages.ts:128-224` |
| Page order is authoritative via `order` keys; `reorderPages` reorders the array | `packages/scene/src/document-pages.ts:106-121` |
| Content coordinates: page content lives under `contentRoot`, a group **directly in `rootChildren` at world origin** — page-local == world (no placement) | `packages/scene/src/document-pages.ts:54, 65-66, 341-346` |
| `activePageNodes` = globals + one active page's children; used by renderer, hit test, layers, minimap, thumbnails | `packages/scene/src/document-pages.ts:372-382` |
| No page placement fields on `Page`; no pasteboard layout anywhere in the editor (zero hits for pageGap/pageOffset/pageLayout in editor) | grep; `packages/editor/src/CanvasArea.tsx:1148-1195` (only snap targets) |
| `migrateToPages` wraps flat `rootChildren` into one A4-or-1920x1080 page; keeps appearance (no placement shift needed today) | `packages/scene/src/document-pages.ts:313-348` |

Authoritative vs derived: page order = authoritative (`order` keys); page side,
display number, spreads = derived. Content coordinates are effectively world
coordinates because content roots sit at world origin.

## 3. Page-coordinate inventory

- World space = document space; content roots have identity transform at origin.
- `coordinateService.ts` provides node world/local transforms, reparenting
  (`computeReparentTransform`), artboard (frame-direct-child-of-contentRoot)
  helpers — but **no page→world or spread→world mapping** (none exists).
- Camera: viewport↔world handled in editor (`applyEditorCameraToCtx`,
  `editorToCamera`, CanvasArea.tsx:1459-1461).
- Page-local coordinates == parent-local == world today; mixed sizes work at
  schema level but pages overlap at origin, so multi-page rendering is
  impossible without placement.

## 4. Active-page-assumption inventory

| Assumption | Location | Consequence |
| --- | --- | --- |
| Renderer walks `activePageNodes(doc)` only | `packages/editor/src/CanvasArea.tsx:1447` | Only one page ever renders |
| Hit testing scoped to active page | `packages/editor/src/hitTest/HitTestEngine.ts:147, 290`; `packages/editor/src/scene/findContainingFrame.ts:26` | Cross-page selection impossible |
| Layers tree resolves active page's contentRoot only | `packages/editor/src/components/LayersPanel/useFlatTree.ts:311-327` | No page rows, no inactive pages |
| Minimap builds one active page | `packages/editor/src/components/Minimap/minimapLayout.ts:202-214` | No spread/minimap overview |
| Thumbnails = `activePageNodes` (no master content) | `packages/editor/src/thumbnail/thumbnailSource.ts:39-63` | Thumbnails lie about page content |
| Video/export resolves the active page's contentRoot | `packages/editor/src/components/Export/ExportDialog.tsx:632-634` | Single-page export only |
| Page snap targets = active page only | `packages/editor/src/CanvasArea.tsx:1150-1195` | No cross-page snapping |
| `canvasWidth/canvasHeight` document dims are default page size only; no single canvas-size assumption in scene | `document.ts:203-206` | Fine |

## 5. Spread topology inventory

| Fact | Evidence |
| --- | --- |
| `Spread { id, pageIds: [1|2 pages], guides? }` — max two pages, no placement, no kind | `types.ts:1646-1652` |
| `rebuildSpreads` recomputes spreads from `facingPages` config; **spreads are a derived projection, not persisted semantics** | `document-pages.ts:392-440` |
| Spread IDs are fresh `cryptoId()` per rebuild — **unstable under toggle/reorder**; every toggle orphans prior spread guides | `document-pages.ts:402, 414, 423, 431` |
| Side classification = index 0 → left, 1 → right; single-page spread → right when `startOnRight` | `document-pages.ts:454-477` |
| No foldout (>2 pages), no custom spreads, no RTL binding direction field, no pasteboard placement | types.ts:1644-1662 |
| Sections exist (`PageSection`: startPageOrder, numberStyle, startNumber, showPageNumber, prefix); numbering scans sections per lookup (O(n²)) | `types.ts:1668-1681`, `document-pages.ts:495-604` |
| Display numbers derived; no page-number variables/text for master headers | grep: no page-number variable resolution |

## 6. Master-page behavior matrix

| Capability | Existing | Partial | Missing | Unsafe | Evidence | Proposed owner |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Master CRUD (create/rename/duplicate/delete/reorder) | x | | | | `document-components.ts:31-168` | `@varve/scene` |
| Assignment + clear | x | | | | `document-components.ts:176-200` | `@varve/scene` |
| appliesTo (all/left/right) | x | | | | `document-components.ts:205-221` | `@varve/scene` |
| Side/section/first/last applicability rules | | | x | | only `all\|left\|right` | `@varve/scene` |
| Master content rendered on canvas | | | x | | zero hits in editor render path; `activePageNodesWithMaster` has no production consumers (context.tsx:5496-5500) | `@varve/engine` |
| Projection of overrides (modified/hidden/deleted) | | | | x | `activePageNodesWithMaster` pushes the **master node** for hidden/deleted overrides (document-components.ts:343-349) — hidden items still render | `@varve/scene` |
| Sparse property-level overrides | | | x | | override granularity is whole-node (`MasterOverride` types.ts:1634-1642) | `@varve/scene` |
| Override UI (create/reset/detach per item) | | | x | | MasterPanel counts overrides only (MasterPanel.tsx:182-193); no editor path calls addMasterOverride | `@varve/editor` |
| Detach (per item / whole master) | | x | | | `detachMasterOverride` = removeOverride (document-components.ts:306-315); no content detach-onto-page | `@varve/scene` |
| Master edit mode (edit master content, exit control) | | | x | | no mode anywhere | `@varve/editor` |
| Master deletion policy (detach/reassign/cancel) | | | x | | deleteMaster clears assignments + overrides (document-components.ts:64-94) | `@varve/scene` |
| Multiple master layers / inheritance / cycle prevention | | | x | | single optional master per page | `@varve/scene` |
| Master in hit testing/selection | | | x | | active-page walk only | `@varve/editor` |
| Master in thumbnails/export/diff | | | x | | thumbnails use activePageNodes; no diff awareness | `@varve/editor` |

## 7. Text-flow capability matrix

| Capability | Existing | Partial | Missing | Unsafe | Evidence | Proposed owner |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Chain type (ordered frame list) | x | | | | `typography.ts:86-91` | `@varve/scene` |
| Chain ops (append/insert/remove/reorder/nav) | x | | | | `textFlow.ts:21-90`; wired in context.tsx:2658-2685 (no UI) | `@varve/scene` |
| Story/frame separation (authoritative story) | | | x | | text lives per-frame on `TextNode.richText` (types.ts:1096); chain-level richText never populated (context.tsx:2661) | `@varve/scene` |
| Frame capacity from real geometry | | | x | | no caller computes `fittedChars`; only dead `detectOverset` (textFlow.ts:92-107) | `@varve/engine` |
| Character-count distribution (approx) | | | | x | `splitRichTextByCharLimit` (textFlow.ts:109-154) — scaffolding, zero production callers | `@varve/scene` |
| Overset detection | | | x | | engine sets a boolean `overset` flag (engine/textLayout.ts:76, 186-288); preflight `overset-text` hard-coded unavailable (preflight.ts:115) | `@varve/engine` |
| Real shaping | | x | | | browser-native measureText at paint (replay.ts:2308+); TS shaping bridge + Rust rustybuzz `shape_text` both unused (lib.rs:1670-1676) | `@varve/engine` |
| Line breaking | | x | | | greedy word wrap + per-char fallback (replay.ts:2354-2378); CJK-aware via Intl.Segmenter (textLayout.ts:166-176); no UAX#14 | `@varve/engine` |
| Paragraph composition (keep/widow/orphan/hyphenation/columns) | | | x | | fields declared (types.ts:812-841), unimplemented | `@varve/engine` |
| Incremental reflow | | | x | | full per-frame re-layout each paint; no story-level dirtying | `@varve/engine` |
| Complex scripts / BiDi | | x | | | browser-native BiDi + detectRTL (replay.ts:2082-2115); P2/P3 analyzer not full UBA | `@varve/engine` |
| Threading UI (ports, link/unlink, overset UI) | | | x | | zero UI; context API unreachable from any surface | `@varve/editor` |

## 8. Print-geometry matrix

| Capability | Existing | Partial | Missing | Unsafe | Evidence | Proposed owner |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Bleed/safeArea/slug types + doc defaults + page overrides | x | | | | `colorManagement.ts:396-468`; `document.ts:209-214`; `types.ts:1580-1585` | `@varve/scene` |
| Canvas bleed/slug/safe-area preview | | | x | | PrintOverlays.tsx:29-156 exists but is never mounted; `bleedGuides` flag unconsumed (workspaceTypes.ts:152-153, 447) | `@varve/editor` |
| Page setters wired (no render counterpart) | x | | | | context.tsx:5436-5461 | `@varve/editor` |
| Margins/columns per page | | | x | | no margins/columns on Page; grid overlay draws doc-level columns only | `@varve/scene` |
| Print marks (crop/registration/color bars) in PDF/X | x | | | | `crates/varve-print/src/marks.rs:41-121`, drawn cmyk.rs:72-155 | `varve-print` |
| Print marks on canvas preview | | | x | | orphaned PrintOverlays only | `@varve/editor` |
| MediaBox | x | | | | lib.rs:3027-3032; cmyk.rs:299-304 | `varve-print` |
| TrimBox/BleedBox (PDF/X only, bleed = full page) | x | | | | cmyk.rs:305-316 | `varve-print` |
| CropBox / ArtBox | | | x | | never emitted (grep) | `varve-print` |
| Multi-page PDF | | | x | | `capabilities.ts:313,349` — `multiPage: false, maxPageCount: 1`; Rust emits exactly one page (cmyk.rs:357-361) | `varve-print` |
| Spread export | | | x | | `spreads` option dead (model.ts:220, never consumed) | `varve-print` |
| Page-range parser | | | x | | none exists anywhere | `@varve/export` |
| Page-range/spreads/marks options | | | x | | dead types: pageRange, spreads, includePageInformation, markOffsetMm, downsampling, compression, overprint (model.ts:205-223, presets.ts:329-427) | `@varve/scene` |
| Bleed from document/page (not dialog) | | | x | | bleed sent from dialog printSettings (ExportDialog.tsx:295-306 → SpecPanel/export.ts:714) | `@varve/editor` |
| DPI enforcement in encoder | | | x | | `enforceDpi` deserialized, never applied (lib.rs:1519, 1553-1571) | `varve-print` |
| Slug in export | | | x | | never used | `varve-print` |
| OS print (CUPS) | x | | | | apps/desktop/src-tauri/src/print.rs:47-219 (no UI wiring found) | desktop |
| `@varve/print` facade | | x | | | dormant; editor invokes Tauri directly (SpecPanel/export.ts:637, 727) | `@varve/print` |

## 9. Canvas-rendering impact report

- Render loop: `walkNodes(doc, activePageNodes(doc))` (CanvasArea.tsx:1447) —
  single-page scene; container culling, dirty regions, worker renderer all
  operate on this active-page scene.
- No page placement → no pasteboard background, no page shadows, no page
  labels beyond active page (CanvasArea.tsx:3235-3237 artboardRect).
- Engine IR is per-node; nothing is page-aware (no page partitions in spatial
  indexes; hit test grid is world-space — fine for a pasteboard once placement
  exists, but must be scoped per page-set).
- SubtreeReplayCache/SubtreeIrCache key on node IDs + doc version; adding page
  placement shifts world transforms for all content → cache keys must include
  page placement revision.

## 10. Import/export impact report

- Importers (SVG/PDF/PSD/AI/EPS in `@varve/import`): PDF import is single-page
  (no multipage mapping). Foreign-format artboard mapping: not implemented.
- Export: batch jobs are per-node presets; pages not an export dimension.
  PDF/X-1a/X-4 path is strong (ICC, marks, outlining) but single-page.
- Native Tauri commands take flat `nodes_json` + page_height — no document
  model across IPC (lib.rs:1482+).

## 11. Migration plan (draft)

1. **v2.17 — pasteboard placement:** add optional `placement` to `Page` and
   `Spread`; `migrateToPages`-era docs get deterministic placement (vertical
   stack, 96px gaps, origin at 0,0) via a pure layout function; no content
   transforms change. Old versions: unknown fields are preserved by the
   current pass-through codec (documentCodec.ts:678-687) — forward-compatible.
2. **v2.18 — story model:** promote chain text into `TextStory` entities while
   keeping `TextNode.richText` as the single-frame default; chains reference
   stories; recompose ranges derived (never stored authoritatively).
3. **v2.19 — spreads as persisted semantics:** keep `rebuildSpreads` as a
   projection but persist spread placement/kind; stabilize IDs.
4. **v2.20 — master layers/applicability:** extend `MasterAppliesTo` to the
   applicability union; keep single-master for v1, add layered model behind a
   version gate.

Document codec is additive-safe: pages/spreads/sections/masters/textChains are
opaque pass-through fields today (documentCodec.ts:678-687).

## 12. Performance baseline (existing)

- Renderer prunes containers by world bounds, uses spatial hit grids
  (HitTestEngine CELL_SIZE=64), SubtreeReplayCache, worker renderer with
  profile-based enablement (CanvasArea.tsx:1522-1533), dirty regions computed
  per frame (CanvasArea.tsx:1500-1512).
- Text: no incremental reflow; line layout per paint (replay.ts:2133).
- No page-level culling exists (nothing multi-page renders).
- Bench corpus exists: `packages/editor/src/performance/workloadCorpus.ts`
  (single-page workloads; no multi-page fixtures).
- Baseline numbers must be captured by `pnpm bench` + canvas10k bench before
  M5 changes (see regression protocol).

## 13. Accessibility baseline

- PageNav is keyboard-navigable with roving tabindex and focus restore
  (PageNav.tsx:86-110, 178-222).
- No Pages panel, no spread navigation, no master-edit mode, no thread/overset
  announcements (nothing exists to announce).
- axe gates run per workspace (`just gate`); no page-specific a11y tests yet.

## 14. Security threat model (draft, for new code)

- Untrusted: imported multipage PDFs (decompression bombs, huge image counts,
  page counts > limit), malicious fonts, multimodal model proposals
  (prompt injection in doc text, invented IDs, cyclic threads), malformed
  page/spread/master/story graphs on load.
- Limits to enforce (new): max pages (default 10,000), max masters 500, max
  story length 10M graphemes, max frames per story 5,000, max columns 64,
  coordinate |v| ≤ 1e7 px, bleed ≤ page/2, thumbnail 512px, import bytes,
  composition duration, worker concurrency 2, model request size 5 MB.
- Validation failures must not partially mutate the document (scene ops are
  pure; apply through the transaction coordinator).
- Workers: reject stale composition responses by (story, frame, font-manifest,
  request) revision tuple.

## 15. Architecture decision records

Created alongside this audit: ADR-0171 … ADR-0203 (docs/adr/) covering the
33 mandated topics — page vs frame semantics, page-local vs world coordinates,
pasteboard placement, order vs placement, node ownership, global content,
explicit vs derived spreads, facing topology, mixed sizes, sections/numbering,
master projection, override representation, multiple layers, inheritance and
cycles, story/frame separation, composition engine, persisted vs derived
ranges, incremental reflow, text exclusion, page-level print geometry, marks
representation, PDF box mapping, shared-canvas rendering, spatial indexing,
cross-page selection, page movement/reorder, legacy migration, undo/history,
semantic diff/merge, collaboration, multimodal pipeline, browser vs desktop,
performance/memory limits.

## 16. Baseline tests

`packages/scene/src/__tests__/multipageBaseline.test.ts` pins current behavior
before restructuring:

- Spread rebuild instability (new spread IDs per rebuild; spread guides lost).
- No page placement (all content roots at world origin; pages overlap).
- Hidden/deleted master override projection bug (hidden master node still
  listed in `activePageNodesWithMaster`).
- Char-count text split semantics of `splitRichTextByCharLimit`.
- Active-page-only projection of `activePageNodes`.
- Mixed page sizes via `setPageSize` (content transforms untouched).
- Print-default inheritance on `addPage` (bleed/safeArea/slug copied).
- Page deletion removes contentRoot subtree (no orphan policy options).
- Duplicate page does not remap text-chain frame IDs (chain points at old
  page's frames after duplicate).

These tests assert *current* behavior — including known defects — so that
Milestones 2-4 have a measurable before/after.
