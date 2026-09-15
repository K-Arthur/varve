# Isometric grid & plane-aware construction — independent verification

**Date:** 2026-09-15
**Verifier:** maintainer (independent pass over the isometric workstream)
**Verified implementation:** commits `1f125e8cb` → `92084cd85` on `master`
(canonical scene geometry, v2.28 schema + migration, viewport overlay,
geometry-anchored snapping, plane-aware tools, fit-to-plane/unproject, grid
artwork, Inspector surface, E2E harness).
**Companion documents:**
`docs/audits/isometric-grid-research-2026-09-14.md` (research + authored
contracts), `docs/architecture/grid-system.md` (authoritative contracts).

This document is the *verification* pass, not the design record. It records
what was independently re-derived, what the real editor actually does, which
observations are policy rather than defects, and what remains open. Where this
document and an older audit disagree, believe the fresh evidence here.

## 1. Method

1. Re-read the shipped sources rather than trusting any earlier read
   (`packages/scene/src/isometricGeometry.ts`, `gridTypes.ts`,
   `version-migrations-v228.ts`, `packages/editor/src/canvas/isometricOverlayGeometry.ts`,
   `canvas/isoTestHooks.ts`, `tools/isometricSnapping.ts`, `tools/snapping.ts`,
   `tools/BaseTool.ts` + shape tools, `commands/isometricPlaneCommands.ts`,
   `components/DocumentGridOverlay/*`, `Inspector/panels/DocumentPanel.tsx`,
   `context.tsx`, `document.ts`).
2. Ran the focused unit suites (87 tests / 6 files) and recorded output.
3. Added an **independent** Playwright spec whose expected geometry is
   recomputed from first principles (plain trigonometry and 2×2 algebra over
   the basis the app itself publishes), then ran it against the real editor,
   including pointer-driven drawing, plane switching, marquee multi-select,
   Inspector controls, Edit-menu undo/redo, and far pan/zoom.
4. Inspected the captures (`docs/audits/isometric-evidence-2026-09-15/`) and
   compared the *artwork* geometry from the committed document against the
   expected lattice.
5. Recorded observations as product defects, policy, test-harness issues, or
   environment noise — explicitly.

Environment: Linux (CachyOS), Chromium via Playwright `--project=chromium`,
viewport 1280×800, device scale 1. Desktop WebKitGTK/Tauri and Chromebook
hardware were **not** available in this pass. The shared working tree was being
edited by three concurrent agents; see §6 for how that was separated from
product behaviour.

## 2. Unit-level verification (executed 2026-09-15)

```
pnpm exec vitest run \
  packages/scene/src/isometricGeometry.test.ts \
  packages/scene/src/gridTypes.test.ts \
  packages/scene/src/gridDocument.test.ts \
  packages/editor/src/canvas/__tests__/isometricOverlayGeometry.test.ts \
  packages/editor/src/tools/__tests__/isometricSnapping.test.ts \
  packages/editor/src/commands/__tests__/isometricPlaneCommands.test.ts
```

Result: **6 files, 87 tests, all passed** (24.2 s). The complete
`@varve/scene` package suite also passes on the same tree — **201 files /
3059 tests** (85.9 s) — so the grid contract changes did not regress the wider
scene model. The numerical suite is genuinely independent of the
implementation where it matters:

| Check | Evidence |
| --- | --- |
| True-isometric basis: equal lengths, 120° separation, `e1·e2 = −s²/2` | `isometricGeometry.test.ts` "true isometric basis (independently derived)" |
| Third family step derived as `s·√3/2`, not reused from `spacing` | same file |
| Exact 2:1: `atan2(1,2)`, `tan = 1/2`, distinct from true isometric | "exact 2:1 dimetric preset" |
| Plane round-trips and documented basis pairs; singular bases return null | "plane mapping" |
| Oblique nearest point where independent rounding is **wrong** | "finds the true nearest intersection where rounding does not" |
| Closest-vector agreement with brute force over a deterministic sweep | "agrees with brute force…" |
| Idempotence, origin is a lattice point at negative indices, deterministic ties | same describe block |
| Viewport coverage without fixed extents; phase stability across display density; major-line identity; bounded work at tiny spacing | "viewport line generation" |
| Nested power-of-two LOD with a hysteresis dead band | "display density ladder" |
| Near-parallel rejection by conditioning, 180°-equivalent duplicate detection, guide-vs-lattice third axis | "validation" |

### Performance spot-check (Node 22, CachyOS, single core)

Throwaway harness over the canonical primitives (not committed): 200
iterations per configuration, random-query throughput over 20k points.

| Workload | Result |
| --- | --- |
| `gridLinesForViewport` + `selectDisplayStep` | 0.002–1.02 ms/op across zoom 0.05–16, spacing 0.05–24, viewports 1280×800 and 2560×1440. Worst case: spacing 0.05, zoom 0.25, 2560×1440 → 5,496 segments in 1.02 ms. |
| `nearestLatticePoint` (oblique, exact) | ≈ 280,000 queries/s (≈ 0.0036 ms/query) |
| `nearestLatticeLine` | ≈ 1,070,000 queries/s |

Interpretation: at a 120 Hz pointer rate (8.3 ms budget) the snap query costs
~0.004 ms and line generation stays under ~1 ms in the worst measured
configuration, with output bounded by visible lines (LOD ladder, 4,096/family
cap) rather than canvas area or object count. This is a Node measurement of the
pure geometry only: browser paint cost, the editor's render loop, and
WebKitGTK/Chromebook hardware were not measured here.

## 3. Real-UI verification (new, independent spec)

File: `tests/e2e/canvas/isometric-construction-workflow.spec.ts`
Run: `VARVE_E2E_PORT=… npx playwright test … --project=chromium`.

Each scenario drives the real editor and asserts against the committed
document via the read-only `?isoTest=1` hook.

| Scenario | What it proves | Result |
| --- | --- | --- |
| Three-face cube across Front/Side/Top planes | Every face matches corners recomputed in the test from the published basis (`e1`, `e2`, `e3 = −(e1+e2)`); the four shared cube vertices coincide across faces within pointer precision; all 12 edges equal one cube side. This is the grid→plane→pointer→artwork agreement end to end. | **Passed** |
| Multi-object move | Two shapes marquee-selected and dragged: both receive exactly one common translation (deltas equal to < 1e-6 world units) and the centre-to-centre vector is preserved — no per-object snapping distortion. | **Passed** |
| Hide / undo / redo | Hiding the grid through its own switch removes the overlay without changing node count or geometry; the transient overlay mode (`Alt+Shift+I`) adds no history step (Undo still undoes the drawing); authored visibility is one undoable document edit; hidden-grid snapping stays enabled. | **Passed** |
| Export with the grid visible | The artwork is first proven to be a real plane rectangle (2 distinct plane-`u` and plane-`v` values); an SVG downloaded while the overlay is on screen contains no `document-grid-overlay` content, and its primitive/geometry summary is byte-for-byte equal to a second export taken with the overlay hidden — the construction aid is not scene data and cannot leak into output. | **Passed** |
| Existing suite (`isometric-grid.spec.ts`) re-run unmodified after the hook extension | 6/6 scenarios (lattice + phase, projected rectangle, snap crosshair, fit/unproject inverses, grid artwork independence, custom axes + far zoom). | **Passed** |

Run history (recorded rather than hidden):

- Each scenario above has at least one green isolated run on the current tree
  (`opencode-iso-verify7/8/9`, `opencode-iso-cube`, `opencode-iso-export`).
- A consolidated two-suite run (8 tests, 12.3 min) under three concurrent
  Playwright workloads from other agents produced **7 passed, 1 failed
  (`mouse.move: Target crashed`), 1 flaky (`page.goto: Page crashed`)**. Both
  failures are Chromium renderer crashes while the machine was shared, not
  assertion failures; the cube and multi-move scenarios were immediately
  re-run alone and passed. The spec carries a documented single retry for this
  reason.


Captures (inspected, committed under `docs/audits/isometric-evidence-2026-09-15/`):

| Capture | What to look for |
| --- | --- |
| `cube-face-front.png`, `cube-face-side.png`, `cube-face-top.png` | Each plane's projected rectangle is axis-aligned in that plane; the faces share the cube's vertical edge and top corners (the top capture shows the closed hexagonal cube silhouette with the top face selected) |
| `07-multi-move.png` | Both shapes displaced together with unchanged relative placement |
| `08-hidden-grid-roundtrip.png` | Grid restored after hide/undo/redo with artwork untouched |
| `09-export-with-grid.png` | The projected diamond artwork exported while the grid was on screen; the downloaded SVG contains no grid geometry |

## 4. Observations from verification

| # | Observation | Classification | Action |
| --- | --- | --- | --- |
| V1 | The grid-visibility switch is authored document state, so it is one undoable history entry; the overlay mode toggle is transient and is **not** in history. My first test assumed the opposite and failed until the policy was asserted explicitly. | Policy (verified) | Asserted in the new spec; documented here and in the grid-system doc |
| V2 | Hiding the grid leaves `snapEnabled` true: display visibility and snapping are independent, as designed. | Policy (verified) | Asserted (`snapEnabled` remains true with the overlay hidden) |
| V3 | `IsometricAxis.spacing` is retained in the schema but no longer consumed (per-axis spacing is derived from the basis). Sanitization preserves it, so it is inert rather than misleading at runtime. | Residual dead field | Marked `@deprecated` in the type; kept to avoid dropping authored data |
| V4 | With multiple isometric grids and no `activeIsometricGridId`, resolution prefers the default id and then the id-sorted first entry. Deterministic, and the UI authors one grid, but it is not literally user intent. | Documented limitation | Recorded here; a future grid manager should set `activeIsometricGridId` explicitly |
| V5 | Initial harness defects: the hook projects into canvas-area pixels while `page.mouse` takes page pixels (a 312-world-unit error at 100% zoom), and the construction-plane control is a segmented `radiogroup`, not a combobox. The independent corner check caught the first error rather than letting a wrong-plane shape pass. | Test-harness issue (mine) | Fixed in the spec; recorded because it demonstrates the value of recomputing expectations rather than reusing app helpers |
| V6 | Concurrent agents editing files triggered Vite HMR full reloads that return the app to Home mid-gesture. Distinguishable from product failure by the page snapshot ("Loading Varve"/Home) and by the same assertions passing once the tree is quiet. | Environment noise | Spec carries a documented single retry; the consolidated run is reported below |

## 5. Failure modes observed in other products, and Varve's countermeasure

Synthesised from the sources in the companion research document (Krita Artists,
Aseprite issue #5612, Affinity forum, Inkscape MR !6132, Figma plugin reviews;
all accessed 2026-09-14/15).

| External failure | Varve countermeasure (verified where noted) |
| --- | --- |
| Game-art users configure a "30° isometric" grid and it never matches 2:1 tilemaps; drift grows across the map (Krita). | Two honest presets: True isometric (exact 30°) and Game-art 2:1 (ratio-derived `atan(1/2)`); the 2:1 angle is computed, never typed. Verified by unit tests and by the preset switch E2E. |
| Intersections rarely land on pixel boundaries, so pixel-snapped guides break isometric alignment (Krita). | Lattice snapping is continuous world/screen geometry, independent of pixel snap; pixel snapping remains a separate explicit toggle. |
| Free guides without lattice snapping force manual counting (Aseprite feature request). | Snapping is part of the grid (intersections by default, lines opt-in) and uses the artwork's own anchors rather than a world AABB corner; verified by the snap E2E and the multi-object move E2E. |
| "Fit to Plane" transforms a multi-object selection inconsistently, inheriting one object's rotation (Affinity). | `planWorldAffineTransform` applies a single world-space affine to each selection root exactly once; descendants are never visited twice; no per-object decomposition. Unit-tested and exercised through the real Object menu. |
| "Isometric" features that quietly change existing artwork when a grid is enabled. | Turning on the grid changes no node — verified by node-count and geometry equality across visibility/mode toggles, and by the grid-artwork independence scenario. |
| Arbitrary three-angle sets presented as physically valid projections. | Custom third axes that cannot belong to the lattice are drawn dashed as directional construction guides, and the validation/`role` contract is unit-tested. |

## 6. Concurrency separation

During this pass the shared `master` working tree received unrelated commits and
uncommitted edits from other agents (fonts, selection, NumberInput, SAM
providers, menus). Distinguishing rules used:

- Every unit test above was run from the shared tree; failures were inspected
  for authorship before being attributed. The only isometric-suite failures
  were the harness/policy issues in §4.
- `pnpm --filter @varve/editor typecheck` reports **pre-existing** errors in
  files owned by other workstreams (`Menubar.tsx`, `workspace/layoutVariants.ts`,
  `context/useSam2Segmentation.ts`, `tools/snapping.ts:306/591`, a
  `ShapeBuilderTool.test.ts` fixture, etc.). `isoTestHooks.ts` and the new spec
  produce **no** type errors; `pnpm typecheck:e2e` is clean.
- No other agent's files were reverted, staged, or reformatted. The only shared
  files touched are the isometric hook (additive projection methods), the
  existing isometric spec's global window declaration (additive methods), the
  grid type comment, the website canvas feature page, and its spec.

## 7. Remaining limitations (not claimed as done)

1. **Axis-direction movement constraint** (mission §8) is not implemented:
   moving a selection along a plane axis as a first-class command is still an
   explicit future item; ordinary nudge behaviour is unchanged.
2. **Pen/node handle-vector plane semantics** are partial: anchors follow the
   plane and snapping, but Bézier handle directions are not re-expressed in plane
   coordinates.
3. **Plane-relative rotate/flip/duplicate/align/distribute** are deliberately
   deferred; they must not be confused with document-axis commands.
4. **Scope**: isometric grids render/snap as document-scope grids. Page-scope
   filtering exists in the overlay; frame-local isometric grids that follow a
   frame transform are not implemented and are not offered by the UI.
5. **Export**: exclusion of the construction grid is verified with a real SVG
   download while the overlay is on screen, compared against a second export
   with the overlay hidden (see §3). PDF and raster lanes were not exercised;
   they share the same scene-graph source, but that is an inference, not a
   measurement.
6. **Platform**: Chromium only here. Tauri/WebKitGTK and low-end Chromebook
   hardware remain to be exercised; the overlay is bounded
   (`maxLinesPerFamily`, path grouping, nested LOD) but not measured on that
   hardware in this session.
7. Pixel-exact 2:1 output additionally depends on integer origin/spacing and
   the raster export path; the grid alone does not guarantee pixel alignment.

## 8. Verdict

The canonical lattice, overlay, snapping, plane-aware drawing, explicit
fit/unproject, and grid-artwork generation are **integrated and verified**:
87 focused unit tests pass, the four workflow scenarios added here pass against
the real editor, and the original six-scenario suite still passes. The visible
grid, the snap solver, and the committed artwork consume one geometry and agree
numerically. The remaining gaps in §7 are scoped, documented, and not presented
as complete.
