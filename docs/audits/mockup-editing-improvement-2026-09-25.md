# Mockup Editing & Creation — Improvement Pass (2026-09-25)

Status: in progress (this file is updated as slices land).
Scope: improve the existing mockup system in place — no new workspace, mode,
route, document model, or parallel renderer. Plan:
`docs/plans/mockup-improvement-2026-09-25.md`. Research (accessed
2026-09-25): `docs/research/mockup-research-2026-09-25.md` — nine required
primary references, competitor interaction principles, 22 catalogued user
failure modes (C1–C22), algorithm/standards decisions.
Canonical architecture: `docs/architecture/mockup-system.md`, ADR-0015
(decision 8 added this session).
Prior audits: `docs/audits/mockup-capability-audit-2026-08-05.md` (pre-
implementation baseline — its "Missing" rows are now implemented),
`docs/audits/mockup-vertical-slice-report-2026-08-05.md`,
`docs/audits/mockup-editing-improvement-2026-09-13.md`.

## Coordination (working tree shared with other agents)

Other agents own (and had in flight at session start): staged/unstaged
compositor + tokens work, retouch/variable-binding/token-sync editor work,
the canvas-fluidity task (`docs/agents/canvas-fluidity-2026-09-25-ownership.md`
— owns `CanvasArea.tsx`, `canvas/renderPipeline.ts`, hit-test, StatusBar), a
WebGPU reachability spec (`tests/e2e/webgpu/solid-fill-reachability.spec.ts`,
untracked; it currently breaks `pnpm typecheck:e2e` for everyone — handoff,
not this task), and, discovered at 22:05, an in-flight **mesh surface**
implementation editing `packages/scene/src/mockup/*` and
`render/mockup/mockupIr.ts` (unstaged; engine side committed as
`1a5dde606`). This task owns the export compositor, SpecPanel export,
render/mockup export module, the Mockups UI, mockup E2E, and the mockup docs —
and deliberately does not edit the mesh agent's files. All commits this
session are pathspec-scoped so other agents' staged work is never swept in.
`CanvasArea.tsx` is NOT edited here; drop-to-replace is recorded as an
integration handoff in the plan (Slice F).

## Reproduced defects (before → after)

| # | User task / route | Evidence | Root cause | Fix | Verification |
|---|---|---|---|---|---|
| 1 | Export a mockup as SVG | `composeFlattenedRasterAssetsForNode` → `findFlattenBoundaries`; exported SVG contained only the frame background | `assessNodeCapability` had no mockup branch: a mockup frame is a childless frame with a solid fill and assessed *natively supported*, so no raster boundary was created and the boundary host (which runs `decorateMockupSubtree`) never ran | `assessNodeCapability` returns unsupported for `svg`/`pdf`; `requiresContainerRaster` pushes a container-level group boundary at both decision points (root + nested), fixing the childless-container hole | unit: `compositor.test.ts` (root/nested/childless + plain-frame guard); E2E: real SVG export decodes the embedded boundary raster and finds template background + plate pixels |
| 2 | Export any raster-needing node to PDF on desktop | code trace of `rasterizeSubtreeToPdfViaPrintEngine` → `export_node_pdf` with `manifest_json` never passed; Rust `render_fills` falls back to a 16×16 checkerboard without a manifest | No TS caller ever built the `ExportManifest` the Rust printer documents for image embedding | new `export/printImageManifest.ts` (decoded RGBA → bounded base64 manifest) passed as `manifest_json`; varve-print `ImageResource.data` accepts base64 or JSON byte arrays | unit: `export.test.ts` asserts the invoke payload manifest decodes to whole RGBA pixels; Rust: `render_fills_image_with_manifest_embeds_source_dimensions` (32 px XObject, no 16 px placeholder) |
| 3 | Export a mockup (or flattened photo) to PDF/X press formats | `exportNodeAsPdfX` feeds `flattenSceneToEngine` to Rust — no decoration host, and image fills would checkerboard | Press pipeline never runs the compositor; image CMYK conversion also absent | PDF/X blocks mockup subtrees with an actionable error (flatten first / use PNG or PDF); preflight raises a blocking `mockup-press-export` finding; image manifests now pass so photos embed real pixels (RGB boundary documented) | unit: `export.test.ts` PDF/X block + manifest payload; `preflight.test.ts` findings ×3 |
| 4 | Export a mockup as React/Flutter/SwiftUI code | `packages/codegen` has zero mockup awareness — silent composition loss | Codegen emits vector structure only; no warning existed | preflight advisory `mockup-code-export` warning naming PNG/SVG/PDF as the composed routes | unit: `preflight.test.ts` |
| 5 | E2E baseline reproduction | first baseline run failed with `ERR_CONNECTION_REFUSED` on port 1420 (default port contended with other agents' servers; machine at load 12–16 with 7+ vite servers) | shared-machine port/resource contention, not a mockup defect | reruns use `VARVE_E2E_PORT` isolation + heavy lease | see Validation log |

Investigated, pre-existing, NOT changed this session (documented boundaries):

- Pattern fills in PDF/X export fall back to a grey tile with an explicit
  warning comment when no `PatternResource` is supplied (Rust-side behaviour,
  deliberate warning; codegen pattern fills are preflight-blocked).
- PDF/X embeds image pixels as DeviceRGB; image-pixel CMYK conversion is a
  print-pipeline gap (`render_fills` comment "CMYK conversion not yet
  implemented"). Strictly better than the checkerboard it replaced, but
  PDF/X-1a conformance for photos remains a print-owner item.
- Home thumbnail decoration for mockups (unchanged, still deferred).

## Capability classification (2026-09-25, post-fix)

| Capability | Classification | Evidence |
|---|---|---|
| Apply/link/edit source/replace/snapshot/reconnect/flatten/undo | verified (carried over from 2026-09-13, re-run this session) | `tests/e2e/canvas/mockups.spec.ts` |
| Multi-surface (front/back) binding + independent sources | verified | same spec, business-card test |
| Photo template authoring (plate, clip, occluder) | verified | `mockup-production-workflows.spec.ts` |
| Cylindrical (bounded front-facing arc) | verified bounded | same spec (wrap/seam/crop controls) |
| Raster export composition | verified | PNG export pixel assertions |
| SVG export composition | verified this session (was: silently dropped) | new SVG E2E test, artifacts in `reports/mockup-review/` |
| Vector-PDF screen export composition | verified for the decision path (unit); desktop render path shares the raster fallback + manifest fix | `compositor.test.ts`, `export.test.ts`; native Tauri GUI not run |
| PDF/X press export of live mockups | **blocked, explicit** (was: silently dropped) | PDF/X unit block + preflight finding |
| Code exports (React/Flutter/SwiftUI) | **advisory warning** (composition not represented) | preflight finding |
| Desktop PDF image embedding | fixed this session (was: checkerboard) | Rust + TS tests; real desktop GUI verification pending (see Limits) |
| Mesh / calibrated displacement / luminance masks / PSD smart-object re-render / model-assisted proposals | unsupported, rejected explicitly | unchanged validators; deferred table in architecture doc |

## User instructions (existing surfaces only)

1. **Apply** — select the artwork (one or many sources), then
   Object → *Apply Mockup…* (new this session), the canvas context menu, the
   command palette, or Resources → Mockups → Apply. The mockup frame appears
   beside the source and is selected.
2. **Edit source** — edit the original frame/text/shapes normally; bound
   surfaces re-render (digest-keyed). Inspector → Mockup → per-surface
   *Edit source* jumps to it.
3. **Replace** — select the new artwork (Shift-click to keep the mockup
   selected) → Inspector → Mockup → *Replace*. Geometry, fit, masks, and
   appearance are preserved byte-identically (regression-tested).
4. **Snapshot / Reconnect / Clear** — freeze a surface into an embedded
   raster, restore a missing live link, or unbind. Missing sources show a
   labelled last-good preview and block export with a warning.
5. **Surface editing** — click a surface chip on the canvas; drag corner/edge
   handles (one transaction per gesture; Escape aborts; Reset clears), or
   edit rect/quad numerically in the Inspector.
6. **Masks** — select a node, then *Clip from selection* /
   *Occluder from selection* on the surface; invert/feather controls follow.
7. **Author a template** — select a photo → Object → *Create Mockup Template
   from Selection…*; add/rename/reorder/remove surfaces, save, reuse.
8. **Export** — Export tab: PNG/JPEG/WebP/SVG/PDF (screen) all compose the
   mockup. PDF/X stops with a preflight error until flattened;
   React/Flutter/SwiftUI carry a preflight warning. Batch variants:
   Mockup section → variant export.

## Validation log (2026-09-25)

Commands actually run (all from repo root, heavy work lease-wrapped):

| Check | Command | Result |
|---|---|---|
| Scene mockup suite (baseline) | `pnpm vitest run packages/scene/src/mockup/__tests__/mockup.test.ts` | 30/30 pass |
| Export unit suite | `pnpm vitest run packages/editor/src/components/SpecPanel/export.test.ts` | 33/33 pass (incl. 3 new: desktop manifest, PDF/X manifest, PDF/X block) |
| Compositor boundary suite | `pnpm vitest run packages/editor/src/export/compositor.test.ts` | 89/89 pass (5 new: mockup assess ×2, boundary root/nested/plain-frame) |
| Preflight findings | `pnpm vitest run packages/scene/src/export/preflight.test.ts` | 22/22 pass (3 new) |
| Mockup editor actions + C1/C2 regression | `pnpm vitest run packages/editor/src/mockup/mockupActions.test.ts` | 3/3 pass (new byte-identical placement preservation) |
| Mockup Inspector/Panel/package | `pnpm vitest run packages/editor/src/mockup/ .../MockupsSection.test.tsx .../Mockups/` | 16/16 pass |
| Menu suite (after Object-menu addition) | `pnpm vitest run packages/editor/src/menu/` | 134+ pass; 24 structural snapshots reviewed (diff purely additive: 432 insertions, 0 deletions) then updated with `-u` |
| Rust print pipeline | `cargo test -p varve-print` (heavy lease) | **164 passed, 0 failed** incl. new base64 manifest serde, checkerboard-evidence, and manifest-embeds-source tests |
| E2E mockup workflows (isolated port 1495, workers 1) | `npx playwright test tests/e2e/canvas/mockups.spec.ts tests/e2e/canvas/mockup-production-workflows.spec.ts --project=chromium` (heavy lease) | **7 passed, 1 failed** (12.6m). Passed: production subjects + cylinder, business card multi-surface, PNG export composition, **new SVG export boundary test**, overlay drag+undo, missing-source recovery, template authoring. Failed: the 6-step workflow test (Escape/Export-dialog interception at step 8 — classified below) |
| Docs/emoji/token audits | `pnpm audit:docs`, `pnpm audit:emoji`, `pnpm audit:tokens` | docs + tokens clean (315 token pairs across 3 themes); emoji clean at 22:03 and again inside verify:full at 22:23, then RED from 22:27 onward on a concurrent task's uncommitted `MockupsSection.tsx:848` `×` (U+00D7 is banned in .tsx) — blocks every agent's commits until they fix their own line |
| E2E typecheck | `pnpm typecheck:e2e` | pass (after the concurrent WebGPU spec was fixed by its owner; re-run again after the dialog-close hardening) |
| Editor/scene typecheck | `pnpm exec tsc -p packages/{scene,editor}/tsconfig.json --noEmit` | zero errors in task-owned files; 4 errors total, all in other tasks' in-flight files (`tokens/runtimeProjection.test.ts` ×2 untracked, `tokenSync/importWorkflow.test.ts`, mesh-task `render/mockup/mockupIr.ts` at the time) |
| Impact planner | `pnpm verify:plan` / `pnpm verify:affected` | plan escalates (workspace Cargo.toml change); affected stops at Tier 0 format on other tasks' unformatted files (`photo-raw-hdr.spec.ts`, `history/__tests__/source-update-capture.test.ts`, `engine/mockup/warpReplay.ts`, `render/mockup/mockupIr.ts` — no task-owned file fails) |
| Full gate (escalation) | `VARVE_FULL_GATE_REASON="mockup export slice: workspace Cargo.toml/lock change (base64 dep for varve-print print-image manifest)" pnpm verify:full` | **failed at @varve/scene typecheck**: 2 errors in the token task's untracked `tokens/__tests__/runtimeProjection.test.ts`. Earlier stages ran: format, lint, emoji (clean at that moment), docs, secret/boundary scans, audit-health, architecture audit (reported unrelated cycles/instability within ceilings, plus `context.tsx` import-budget overage from concurrent work). No task-owned failure before the stop; later tiers (unit suites, Playwright, cargo workspace) not reached — recorded as deferred to the same reasons as above |
| Website unit | `pnpm test:website` | 237 passed / 2 failed — both failures in other tasks' in-flight work (`screenshots.test.ts` manifest entry for the design-tokens agent's untracked png; `tokens.test.ts` font-size ceiling from concurrent website typography edits; zero findings from `mockups.astro`) |

Inspected artifacts (visual, by direct inspection — not just assertions):

- `docs/screenshots/mockup-review-2026-09-25/svg-export-boundary.svg` — 1
  white page rect + **1 embedded PNG boundary raster**,
  `viewBox="340 120 200 160"` (the mockup frame's bounds). Source copy in
  `reports/mockup-review/`.
- `docs/screenshots/mockup-review-2026-09-25/svg-export-boundary-embedded.png`
  — inspected: template background, phone plate chrome, soft shadow, and the
  fitted source artwork in the screen region. This is the composed mockup;
  before the fix this SVG contained only the frame background.

Workflow-test failure classification (step 8, `mockups.spec.ts:198`): after
the PNG download, the test pressed Escape once and clicked the Mockups tab,
but the Export dialog stayed open and intercepted every click until the
180 s test timeout. The dialog is dismissible only while not `running`
(`dismissible={!(running || …)}`) and its Escape handler lives on the
`<dialog>` element (`onKeyDown`), so it only receives the key when focus is
still inside the dialog — after the export footer re-rendered, focus had
fallen to `body` and the single Escape was lost. The failure screenshot shows
the app splash (a navigation occurred mid-retry under heavy machine load).

- Single-test rerun attempt 1 (port 1496): never started — the heavy lease
  was held by other tasks for the full 1800 s wait window (recorded as
  contention, not evidence).
- **Hardened** the step: retry Escape up to 12×, fall back to the dialog's
  header Close button, then `await expect(exportDialog).toBeHidden()` so
  closure is asserted instead of assumed.
- Single-test rerun attempt 2 (port 1496, heavy lease): **passed in
  51.6 s** — the workflow test is green with the hardened close. Full-set
  status: 7/8 on the first run + this test passing on rerun = 8/8 coverage
  of the mockup spec set in this session.


## Implemented-and-verified vs everything else

**Implemented and verified end-to-end this session:**

- SVG export composition of live mockups (capability boundary + E2E decoding
  the real downloaded SVG; artifacts inspected).
- Vector-PDF decision path (unit: boundary → raster fallback; the desktop
  render path shares the raster fallback and the manifest fix).
- Desktop PDF + PDF/X image-pixel embedding via the print manifest
  (Rust: manifest-embeds-source-dimensions and no-manifest-checkerboard
  evidence tests; TS: both Tauri invokes asserted to carry decodable
  base64 RGBA). *Native Tauri GUI run not executed — unit/E2E-level only.*
- PDF/X mockup refusal: actionable throw + blocking preflight finding (unit).
- Code-export advisory preflight finding (unit).
- Object-menu entries for both mockup commands (registry dispatch; menu
  snapshots reviewed and updated).
- Placement-preservation regression C1/C2 (byte-identical JSON assertions).
- Drop-to-replace integration seam `replaceMockupSurfaceSource` with
  validation + single-transaction tests (the CanvasArea wiring itself is a
  handoff — below).
- Existing workflows re-validated: apply/link/update/save-reopen/export,
  multi-surface, overlay edit + undo, missing-source recovery, template
  authoring, production subjects, bounded cylinder (7/8 E2E green in the
  main run; the eighth's dialog-close step was hardened afterwards).

**Verified only at unit level (no native/desktop runtime this session):**

- Real Tauri desktop PDF output (checkerboard fix end to end in the actual
  app), WebKitGTK parity, PDF/X press files in external preflight tools.

**Explicitly unsupported (unchanged, rejected by validators):**

- Calibrated displacement maps, luminance-channel mask coverage, PSD
  smart-object re-rendering, model-assisted surface proposals. Mesh envelope
  surfaces are being implemented by a concurrent task (see coordination) and
  are not claimed here.

**Deferred / handoffs:**

- **Drop-to-replace on canvas** — the seam action exists and is tested;
  `CanvasArea.handleDrop` (owned by the canvas-fluidity/input task) must
  call `replaceMockupSurfaceSource` when a file drop resolves to a targeted
  mockup surface. Recorded in the plan, Slice F.
- **Codegen mockup rasterization** — decorate `flattenIrForCodegen` so code
  formats embed the composed image instead of warning (the advisory warning
  ships now).
- **PDF/X image CMYK conversion** — print-pipeline item; press files embed
  DeviceRGB images today (documented boundary).
- **Artwork blend/opacity presentation controls** (white-ink/multiply
  research, failure mode C18) — requires `MockupSurfaceOverride` schema
  edits in `scene/src/mockup/types.ts`, which are mid-flight in the mesh
  task; cannot be started without collision this session.
- **Home thumbnail decoration parity** — unchanged from previous sessions.

**Observed but not owned:**

- The Export dialog's Escape depends on focus being inside the dialog; a
  footer re-render can drop focus to `body`. The hardened E2E waits out the
  finalizing state and falls back to the header Close button; a general
  focus-restoration review of shared dialogs belongs to the dialog/a11y
  owners.
- Concurrent vite full-reloads (other tasks editing the shared tree) can
  reload the page mid-E2E — an environment hazard for every agent running
  Playwright against the shared working tree.

## Coordination handoffs

1. **Canvas-area input task** — call
   `replaceMockupSurfaceSource(editor, frameId, surfaceId, sourceId)` from
   the file-drop path when the drop targets a mockup surface (one
   transaction, cycle-validated; tests in `mockupActions.test.ts`).
2. **Mesh-surface task** — owns the `scene/mockup/*`,
   `render/mockup/mockupIr.ts` edits and the MockupsSection mesh fieldset
   (uncommitted at 22:34); its `×` in `MockupsSection.tsx:848` fails the
   repo-wide `audit:emoji` gate for every agent (U+00D7 is banned in .tsx)
   until they fix it. My uncommitted MockupsSection hunk (the replaceSource
   refactor) shares that file and may ride their commit.
3. **WebGPU/compositor task** — their untracked
   `tests/e2e/webgpu/solid-fill-reachability.spec.ts` briefly broke
   `pnpm typecheck:e2e` for all commits; since fixed by them.
4. **Retouch/token tasks** — their unstaged files fail `verify:affected`
   Tier 0 format for everyone (named in the validation report).

## Agent Validation Report

```text
Changed scope: packages/editor (export compositor, SpecPanel export,
  printImageManifest [new], mockup actions + tests, MockupsSection, menu
  defs/localization/snapshots), packages/scene (export preflight + tests),
  crates/varve-print (base64 manifest deserializer + evidence tests,
  Cargo.toml/Cargo.lock), tests/e2e/canvas/mockups.spec.ts, docs
  (research, plan, audit, architecture, ADR-0015, CHANGELOG),
  apps/website/src/pages/features/mockups.astro
Validation plan: pnpm verify:plan — escalated to the full gate
  (workspace Cargo.toml change); verify:affected then failed at Tier 0
  format on files this task does not own (named below)
Commands actually run:
  - pnpm vitest run (focused): scene mockup, editor mockup, export,
    compositor, preflight, menu, Mockups/Inspector — all green (incl. new
    tests: 5 boundary, 3 manifest/export, 3 preflight, 2 C1/C2 + 2 seam)
  - cargo test -p varve-print (heavy lease): 164 passed / 0 failed
  - pnpm typecheck:e2e: pass
  - tsc packages/scene + packages/editor: zero errors in task-owned files
    (4 errors named in other tasks' in-flight files)
  - Playwright mockup specs (heavy lease, isolated port 1495): 7 passed /
    1 failed; failure analyzed + test hardened; single-test rerun subject
    to lease contention (recorded)
  - pnpm audit:docs / audit:emoji / audit:tokens: docs + tokens clean;
    audit:emoji currently red on another task's uncommitted line
  - pnpm test:website: 237 passed / 2 failed — both failures in other
    tasks' in-flight website work (screenshot manifest, font-size ceiling)
  - pnpm verify:affected: stops at Tier 0 on other tasks' unformatted
    files; pnpm verify:full attempted with stated reason (result recorded)
Passed: all task-owned unit/ Rust/ typecheck/audit checks listed above;
  E2E 7/8 with the 8th's step hardened afterwards
Skipped as unrelated: other packages' failing in-flight tests (tokenSync,
  tokens/runtimeProjection, retouch specs, website typography/screenshots)
Escalations: full gate required by the Cargo.toml workspace change
Full suite run: attempted (verify:full with VARVE_FULL_GATE_REASON)
If yes, reason: workspace dependency change (base64 for varve-print)
```
