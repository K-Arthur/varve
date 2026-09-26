# Mockup Mesh Surfaces — Research, Implementation, and Validation (2026-09-25)

Status: completed for the supported scope (mesh envelope implemented; E2E
evidence recorded below). Scope: improve the existing mockup system in place
(no new workspace, route, mode, or parallel document model).

Canonical architecture: `docs/architecture/mockup-system.md` (mesh sections),
ADR-0015 (2026-09-25 amendment).
Prior audits: `docs/audits/mockup-editing-improvement-2026-09-13.md`,
`docs/audits/mockup-capability-audit-2026-08-05.md`.

## 1. Research record

Primary sources consulted (accessed 2026-09-25 unless noted):

| Source | Version / status | Finding that shaped a decision |
|---|---|---|
| [Affinity Designer — "Distort / warp feature" forum thread](https://forum.affinity.serif.com/index.php?/topic/51221-distort-warp-feature-affinity-designer) | Community thread, accessed 2026-09-25 | Users' multi-year complaint that "Designer doesn't have warp effect so you can't have mockups" — envelope warp is the capability whose absence blocks mockup workflows, so it is the highest-value next slice. |
| [Reddit r/Affinity — editing mesh/perspective warp after applying](https://www.reddit.com/r/Affinity/comments/1e95z94/can_i_edit_my_mesh_warpperspective_after_applied) | Community thread, accessed 2026-09-25 | Affinity 2's filter-menu warp is destructive (parameters not editable after apply). Response here: non-destructive by construction — the grid is persistent document data edited through overrides with one-step undo. |
| [Adobe Community — perspective warp + smart object mockup errors](https://community.adobe.com) (thread "Perspective warp and smart objects: mockup error", Oct 2022) | Community thread, accessed 2026-09-25 | Transform-then-embed pipelines break when the warp is applied before the smart object exists. Response here: binding and geometry are separate persistent data; nothing is "baked into" the source. |
| [Graphic Design SE — "Avoid blurred texts on mockups distorted images"](https://graphicdesign.stackexchange.com/questions/22003/avoid-blurred-texts-on-mockups-distorted-images) | Community answer, accessed 2026-09-25 | Blur comes from rasterizing before distortion. Response here unchanged from the 2026-09-13 pass and extended to mesh: export re-bakes the source at output scale; preview pixels are never upscaled. |
| [Creatsy — smart object error guide](https://creatsy.com) ("My design looks blurry or pixelated on the product") | Vendor guide, accessed 2026-09-25 | Same root cause family: source resolution at output, not template size. |
| [OpenCV — Geometric Image Transformations](https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html) | 4.13.0 docs, accessed 2026-09-25 (same finding as 2026-09-13 record) | Destination→source inverse mapping family; explicit border handling. The mesh warp follows the same contract (transparent outside the hull). |
| [Heckbert — Fundamentals of Texture Mapping and Image Warping](https://www.cs.cmu.edu/~ph/869/papers/heckbert.pdf) | MSR TR 89-11, accessed 2026-09-25 | §3.1.2 inverse bilinear: closed-form per-patch inversion with root selection — the exact algorithm implemented in `meshWarp.ts`. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | CR Draft, accessed 2026-09-25 | Reaffirms composition order (filter → clip/mask → blend); mesh surfaces ride the same bake/mask pipeline as quads. |
| [Placeit — "Am I going to be able to edit my mockup after I complete the download?"](https://help.placeit.net/hc/en-us/articles/37882558377369-Am-I-going-to-be-able-to-edit-my-mockup-after-I-complete-the-download) | Vendor help, accessed 2026-09-13 (cited in the prior audit; re-checked 2026-09-25) | Flattened downloads are the core web-tool complaint. Response unchanged: Varve mockups are live document objects. |
| Installed repo dependencies | `@webtoon/psd` 0.4.x, engine modules re-verified in-tree | PSD smart objects remain unextractable without a second parser; disclosure (not extraction) chosen this session — see §2. |

Community failure modes and how this work responds (extends the 2026-09-13
table; sources above):

| Reported failure | Root cause in other tools | Response here |
|---|---|---|
| "You can't have mockups" without a warp tool (Affinity, pre-v2) | Envelope warp missing or locked to the raster editor | Mesh envelope is a first-class mockup surface kind usable with vector, text, and image sources alike. |
| Warp parameters not editable after apply (Affinity 2 filter warp) | Destructive filter pipeline | The grid is persistent document data; vertex drags are one-transaction overrides with one-step undo, and the template default stays recoverable via Reset. |
| Folded/inside-out warp output after aggressive edits | Tools render whatever the control net does | Convexity is validated at template validation, at IR build, and per pointer-move; a fold is refused and the last valid grid stays on screen. |
| Diagonal seams in mesh-warped artwork | Per-cell homography or naive triangle warps disagree on shared edges | Bilinear patches per cell: the edge restriction depends only on the shared edge endpoints, so adjacent cells agree exactly — no seam slivers by construction. |
| Right-click with a drawing tool draws instead of opening the context menu (reproduced locally, not community-reported) | Right button routed to tool gestures | `ToolManager` gates button 2 before routing; the input-system behavior matrix already reserved right-click for context actions. |

## 2. Current-state findings and root causes

1. **Right-click could not open the canvas context menu while a creation
   tool was active** (handed-off observation from the 2026-09-13 audit; root
   cause found this session). Reproduction: press `R`, right-click the canvas
   — a 100×80 rectangle appeared at the pointer and the menu closed
   instantly. Root cause chain: `ToolManager.handlePointerDown` routed button
   2 to the active tool → click-create committed a shape → the selection
   change tripped Shell's close-on-state-change guard for the context menu.
   The 2026-09-13 audit attributed the symptom to the `.micro-hint` overlay;
   that overlay had already been fixed (commit 673b2051f) — the real gate
   was the tool router. Fixed in `fix(tools): reserve right-click for
   context actions, never tool gestures`.
2. **`kind: 'mesh'` was reserved with no renderer path**; validate.ts
   rejected it explicitly. Implemented this session behind template schema 3.
3. **PSD smart-object disclosure was generic.** A layered mockup PSD and a
   flat poster produced the same "smart objects are not supported" line.
   Now the importer reports the detected `SoLd`/`PlLd` count with the
   boundary stated. Detection is a bounded byte scan (channel data is
   compressed; the ASCII layer keys only occur in real layer info blocks)
   and is explicitly informational — no second PSD parser was added.
4. **Home covers rendered mockup frames undecorated** (audit row 19,
   "Deferred / not claimed"). The canonical thumbnail pipeline now decorates
   through the shared export module via a `buildIr` hook on
   `generateThumbnail`; undecorated fallbacks are provisional and never
   persisted.
5. **No warp benchmarks existed.** `mockupWarp.bench.test.ts` establishes
   the first baseline (quad 18.6/72.2/283.0 ms; mesh 120.2/411.2/1393.1 ms
   at 512/1024/2048 px, best-of-3, loaded shared Arch Linux box, Node 26).
   The mesh envelope's closed-form inverse bilinear costs roughly 4–5× the
   quad homography per pixel — bounded at interaction time by the preview
   quality bucket and surface cache, and recorded rather than tuned away.

## 3. Implementation record

| Commit | Contents |
|---|---|
| `f40d56215` | Right button reserved for context actions (ToolManager gate, SelectionPaintTool cleanup, unit + E2E regression). |
| `1a5dde606` | Engine `mockup/meshWarp.ts`: convexity/shape validation, closed-form inverse bilinear, `warpImageToMesh` with transparent outside and identity-exact sampling. |
| `a8839901d` | Scene schema 3: `MockupMeshGeometry`, `validateMeshGeometry`, ops migration stamp, builtin catalog to schema 3, override validation, codec round-trip. |
| `0ad367b8b` | Renderer: `warpedImage` mesh form, replay branch, `mockupIr` mesh path (bake parity, invalid-grid placeholder, diagnostics), fabric banner builtin. |
| `d315ee4a1` | Overlay vertex handles with fold rejection, hull outline, inspector mesh fieldset (grid density, Reset mesh, honest note), template preview border. |
| (this slice) | PSD smart-object count disclosure. |
| `8a9c930c5` | Home thumbnail decoration via the shared decoration module + provisional policy. |
| `e960382f4` | Warp benchmarks. |

Deliberately deferred (unchanged from the 2026-09-13 record): calibrated
displacement, luminance mask coverage, PSD smart-object extraction/editing,
model-assisted proposals, batch-export save-to-file destination,
worker-rendered mockup warps.

## 4. Validation log (2026-09-25)

| Check | Command | Result |
|---|---|---|
| Engine mesh warp suite | `pnpm vitest run packages/engine/src/mockup/__tests__/meshWarp.test.ts` | 12/12 pass (identity exactness, seam continuity across a fold, corner correspondence, convexity rejection, hull transparency). |
| Scene mockup suite | `pnpm vitest run packages/scene/src/mockup/__tests__/mockup.test.ts` | 35/35 pass (schema-3 acceptance + schema-2 rejection, folded/ragged grids, migration stamp, override validation, codec round-trip). |
| Renderer suites | `pnpm vitest run packages/editor/src/render/mockup/__tests__/mockupIr.test.ts packages/editor/src/render/mockup/__tests__/mockupExport.test.ts packages/engine/src/mockup` | pass (mesh warpedImage emission, malformed-grid placeholder, grid cache identity, export decoration). |
| Panel/inspector/actions | `pnpm vitest run packages/editor/src/components/Mockups packages/editor/src/components/Inspector/sections/MockupsSection.test.tsx packages/editor/src/mockup` | 19/19 pass. |
| Tool routing | `pnpm vitest run packages/editor/src/tools/__tests__/ToolManager.rightButton.test.ts packages/editor/src/tools/__tests__/ToolManager.middlePan.test.ts packages/editor/src/tools/__tests__/ToolManager.test.ts packages/editor/src/tools/SelectionPaintTool.test.ts packages/editor/src/tools/toolRegistry.test.ts` | pass. |
| Thumbnail service | `pnpm vitest run packages/editor/src/thumbnail/__tests__/thumbnailService.test.ts packages/editor/src/thumbnail/__tests__/fidelity.test.ts` | 20/20 pass (decoration warning contract, provisional policy, persist gate). |
| PSD disclosure | `pnpm vitest run packages/import/src/psd.test.ts packages/import/src/format-honesty.test.ts` | 33/33 pass. |
| Warp benchmarks | `pnpm exec vitest run --config vitest.bench.config.ts packages/engine/src/mockup/mockupWarp.bench.test.ts` | pass; baselines recorded in §2.5. |
| Typechecks | `pnpm exec tsc -p packages/engine/tsconfig.json --noEmit`; `pnpm exec tsc -p packages/scene/tsconfig.json --noEmit`; `pnpm exec tsc -p packages/editor/tsconfig.json --noEmit` | clean in all touched files (remaining editor errors are other sessions' in-flight token-sync/webgpu files). |
| Mesh workflow E2E | `VARVE_HEAVY_TASK_PARALLELISM=0 VARVE_E2E_PORT=1512 VARVE_E2E_WORKERS=1 npx playwright test tests/e2e/canvas/mockup-mesh.spec.ts --project=chromium --workers=1 --reporter=list` | **pass (1.4 min)**: apply folded fabric, fit-all canvas pixel sampling (>8 distinct colours), surface-chip selection, grid-vertex drag with one-step undo/redo and inspector reflection, save/reopen with the override intact (surface-row reselection), real PNG export decoded (dimensions + composed non-uniform content, 200+ opaque samples, >12 colours), zero console errors. Three spec fixes were needed on the way (fit-all before sampling; ASCII `x` in the grid-density assertion; reselect the surface row after reopen and click Export before awaiting the download) — all test-harness issues, no product changes. Runs before the passing one were blocked by the heavy-task lease (two full queue windows expired: 600 s and 3600 s) held continuously by concurrent sessions; the final runs used the documented `VARVE_HEAVY_TASK_PARALLELISM=0` opt-out with MemAvailable ≥ 7.5 GB (floor 1536 MB), recorded here as a deliberate override. Evidence: `docs/screenshots/mockup-mesh/` (E2E-captured `01/02/03/04/05` set plus the manual-walk set), all inspected in-session. |
| Right-click E2E regression | `tests/e2e/menus/overlay-reliability.spec.ts` ("canvas context menu opens on a real right-click under a visible micro-hint") | failed before the fix (run at port 1495: the right-click committed a rectangle and no menu appeared), passed after the fix (run at port 1497); the pre-existing companion test in the same file failed once on a dev-server warmup timeout and was green in earlier runs — recorded as infrastructure, not product. |

## 5. End-to-end evidence

### 5.1 Automated workflow spec (passing)

The mesh workflow E2E (`tests/e2e/canvas/mockup-mesh.spec.ts`) exercises:
apply the folded-fabric builtin to a live source, fit-all canvas pixel
sampling of the composed mockup, surface-chip selection, a grid-vertex drag
with one-step undo/redo, save/reopen persistence of the mesh override
(surface-row reselection), and a real PNG export decoded and checked for
dimensions and composed (non-uniform, richly coloured) content. Evidence
screenshots are captured to `docs/screenshots/mockup-mesh/`. The full run
passed on 2026-09-26 (1.4 min, single Chromium worker); the lease/contention
history and the three harness-only fixes are recorded in §4.

### 5.2 Live-session walk (manual multimodal verification)

To keep the visual gate honest despite the lease contention, the full
workflow was driven manually in a real Chromium session against a dev server
of the working tree (evidence: `docs/screenshots/mockup-mesh/`, all
inspected in-session):

- `01-applied.png` — after applying the fabric banner builtin: the composed
  mockup renders on canvas (template plate, three wave folds with crease
  shading, source bound to "Banner fabric · Frame 1"), 17-template catalog
  lists it as "1 surface · landscape · mesh, bounded-envelope".
- `02-vertex-handles.png` — after selecting the surface chip: 15 vertex
  handles with the hull outline, overlay toolbar reads "Banner fabric ·
  envelope", inspector shows Replace/Edit source/Snapshot actions.
- `03-vertex-dragged.png` — after dragging the second top-row vertex down:
  the fold deepened live through the moved vertex; the artwork resampled
  through the envelope (pixel-level composition re-checked: 106 distinct
  colours in the mockup region).
- `04-after-undo.png` — one Ctrl+Z restored the template grid (the
  inspector's "Template default" state returned; the grid outline matches
  the template again).
- `04-persisted-reopen.png` — after Ctrl+S → Home → resume editing: the
  vertex override survived (inspector shows "Reset mesh", status bar
  "Saved").
- `05-right-click-context-menu.png` — with the rectangle tool active, a
  `contextmenu` dispatched from the canvas content layer (a real
  PointerEvent/MouseEvent pair bubbling from the canvas element, not a
  menu API call) opened the canvas context menu while the layer count
  stayed at 2 — the pre-fix behaviour (right-click commits a shape and the
  selection change closes the menu) did not reproduce. The committed E2E's
  physical `mouse.click(button: 'right')` run (passed at port 1497 after
  the fix; failed at port 1495 before) is the authoritative real-input
  proof; this walk is corroborating evidence.
- `06-inspector-mesh-fieldset.png` — the inspector's Mesh envelope fieldset:
  "Grid 4 × 2 cells · 15 vertices", Geometry row with "Reset mesh", and the
  honest capability note ("bounded envelope for folds and drape — not 3D:
  no lighting solve, no backside, and folds that would crease a cell inside
  out are rejected").

Not exercised in the manual walk: the decoded-PNG export check (the
automated spec covers it; the export decoration itself is unit-verified in
`mockupExport.test.ts` and the SVG-boundary E2E from the 2026-09-25 export
pass).

## 6. Agent Validation Report

```text
Changed scope: packages/engine (mockup/meshWarp.ts, warpReplay.ts, types.ts,
thumbnail service), packages/scene (mockup types/validate/ops/catalog),
packages/editor (ToolManager, SelectionPaintTool, mockupIr, overlay,
inspector, preview, thumbnailService), packages/import (psd.ts), tests/e2e
(overlay-reliability, new mockup-mesh spec), docs + CHANGELOG + website.
Validation plan: pnpm verify:plan selected the affected closure; the
working tree carried 206 changed files from parallel sessions and escalated
to FULL-SUITE for workspace-wide noise, not for this work's scope. Per the
multi-agent coordination rule, each slice ran its exact affected checks
(listed in §4) instead of absorbing unrelated escalations on a moving tree;
the full gate remains with the integration owner.
Commands actually run: see §4 table.
Passed: all focused suites above; typechecks clean in touched files.
Skipped as unrelated: compositor webgpu suite, token-sync suite, dodge/burn
suite, website e2e, rust crates — other sessions' in-flight scope; no
mockup slice touches them.
Escalations: verify:plan FULL-SUITE escalation attributed to shared-tree
noise (206 files); not run — certification belongs to the integration
owner after all parallel sessions land.
Full suite run: no
If yes, reason: n/a (no planner-sanctioned escalation attributable to this
scope; template schema 3 migration is covered by scene codec round-trip and
normalization tests in the affected closure)
```
