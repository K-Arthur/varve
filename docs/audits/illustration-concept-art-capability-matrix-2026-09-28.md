# Illustration and concept-art capability matrix

**Baseline observed:** `master` at `401f1e7fd4d40c86f80fc2b36888019a4f50211b`
**Audit date:** 2026-09-28
**Research ledger:** [`../research/illustration-concept-art-research-2026-09-28.md`](../research/illustration-concept-art-research-2026-09-28.md)

This is a live evidence ledger for the implementation task. “Reproduced” means
the defect was triggered in code or the real application; static risks and
competitor reports are not counted as Varve reproductions. Rows are updated as
each workflow receives real UI, save/reopen, undo and export checks.

## Baseline defects and workflow coverage

| Artist task | Starting friction / root cause | Existing subsystem and planned repair | Frontend surface | Baseline evidence / status |
|---|---|---|---|---|
| Choose a brush for sketch, ink, flats and shading | Built-ins lacked clear starting points and categorized Airbrush as Smudge because the category guess treated the shared default `smudgeStrength` as intent. | Add pressure-shaped Sketch Pencil and Inking Nib, Opaque Paint and Soft Shade using existing preset fields and stroke generation; assign built-in categories explicitly. | Existing Brush Browser, Tool options and brush preview tiles. | Implemented and visually verified in the running editor. Six paint UI Chromium tests pass, including the real preview/category check. Inspected `test-results/run-171764-1420/paint-brush-ui-paint-UI-in-91069-enders-searches-and-filters-chromium/brush-browser-paint-presets.png`. Marketing copy passes both `/varve` and root-base site tests at desktop/mobile widths, with light/dark captures inspected. |
| Paint with a vector selected while another pixel layer exists | Resolver chose a raster fallback when selection contained no raster, silently redirecting the stroke. | `paintTarget.ts` + `PaintTool`; refuse the incompatible explicit selection and identify “Create a paint layer” as recovery. | Existing spoken feedback; a visible recovery control remains pending. | Reproduced and repaired in resolver tests; real Chromium stroke leaves canvas and layer list unchanged. Before/after images were inspected: `test-results/illustration-target-20260928-1631/paint-brush-ui-paint-UI-in-7e966-g-into-another-raster-layer-chromium/vector-layer-after-drag.png` and `.../vector-selected-paint-refusal.png`. Undo/reopen/export and visible recovery action pending. |
| Paint a mask | Resolver checked only node existence/lock; it accepted hidden nodes and arbitrary mask IDs. Mask-session coordinate handling must match the identified mask asset. | Existing raster-mask session and asset registry; validate node, exact asset identity, visibility/locks, active page and invertible mapping. | Existing mask target/inspector surface. | Resolver and PaintTool unit regressions pass for stale/wrong mask and selection clearing; real mask UI workflow pending. Node-local mask coordinate spaces are refused pending an explicitly supported mapping. |
| Paint when a fallback layer has been deleted | Resolver dereferenced the missing fallback node. | Shared resolver returns a stable refusal; no exception and no redirected deposit. | Existing spoken feedback. | Deleted fallback and inaccessible-target resolver cases covered by focused tests; layer-creation recovery and persisted project check pending. |
| Raster sketch → ink → flats → shading → transparent PNG | Separate brush/selection operations exist, but cross-tool target and save/export continuity has not been verified as one authored workflow in this audit. | Existing paint, selection, layer-mask, persistence and export systems; use ordinary layers and current format. | Existing tool options, inspector, save and export dialogs. | No end-to-end baseline project yet. |
| Editable vector contours with raster texture | The path and raster systems coexist; hybrid-edit and SVG/PDF subtree fidelity need a real round-trip check. | Existing Pen/path, raster layers and export flattening boundaries. | Existing canvas and export controls. | Not yet verified end to end. |
| Thumbnails, references, perspective block-in, variants and presentation export | Existing pages, image nodes, guides and transforms are available; reference inclusion and view-only proof behavior need workflow evidence. | Existing images/assets, guides, view transforms, duplication and exports. | Existing guide and viewport surfaces. | Not yet verified end to end. |
| Existing restoration/upscale paths | Artifact hash identity is recorded separately from source-license/provenance, quality, parity and memory qualification. | Existing restoration/upscale/session infrastructure only; no additional checkpoint is authorized by this plan. | Current enhancement dialog/status. | Not qualified by this audit. |

## Starting visual and test evidence

The initial visual baseline was produced through the existing Chromium
application path on isolated port 1627. The brush browser showed the built-in
previews, and a real browser pointer stroke changed the canvas. Both screenshots
were opened and inspected; they show basic controls/rendering, not completed
illustration workflows:

- `test-results/illustration-plan-20260928-1627/paint-brush-ui-paint-UI-in-91069-enders-searches-and-filters-chromium/brush-browser.png`
- `test-results/illustration-plan-20260928-1627/paint-brush-ui-paint-UI-in-a7471-a-stroke-reaches-the-canvas-chromium/painted-stroke.png`

Baseline commands and outcomes:

```text
pnpm exec vitest run packages/editor/src/tools/__tests__/paintTarget.test.ts packages/editor/src/tools/__tests__/PaintTool.test.ts packages/scene/src/__tests__/paintCompositor.test.ts --maxWorkers=1
  PASS: 3 files, 70 tests

VARVE_E2E_PORT=1627 VARVE_E2E_OUTPUT_DIR=illustration-plan-20260928-1627 node scripts/quality/heavy-lease.mjs "e2e: illustration planning baseline" -- pnpm exec playwright test tests/e2e/paint/brush-ui.spec.ts --project=chromium --workers=1 --reporter=list --grep 'brush browser renders|painting a stroke reaches'
  PASS: 2 Chromium tests
```

The first target-refusal regression ran on isolated port 1631 under the heavy
task lease. It verified that painting onto a raster layer creates the named
`Brush Layer`, then drawing a vector and attempting another stroke does not
change content pixels or create a third layer. The refusal is currently
available through the existing screen-reader announcement; the screenshot
does not show a visible recovery action. Focused tests: 57/57 passed. The full
save/reopen/export round trip is still pending.

The updated Strokes feature page was rebuilt for both the custom-domain root
and the GitHub Pages `/varve` base. The focused site regression passed in both
projects (2/2). It exercises the visible desktop theme controls and opens the
mobile navigation to use its theme controls, checks deploy-base-aware links,
and verifies 390px overflow, image loading/alternatives, and unexpected
page/console errors. Desktop and mobile captures were inspected in light and
dark themes after the rebuilt output was served. The starting-brush and
target-behavior copy is readable at both widths. Capture paths are under
`test-results/strokes-target-copy-Stroke-25b22-mes-widths-and-deploy-bases-ghpages/`
and the corresponding `-custom-domain/` folder.

The baseline planner selected unrelated package, native, website and full-suite
lanes because the shared checkout already contained other tasks' changes. No
full suite is attributed to this audit. Linux Tauri/WebKitGTK, physical stylus,
ARM and mixed-DPI device checks have not been run.

## Status vocabulary

- **Reproduced:** a deterministic code or visible UI interaction triggers it.
- **Static risk:** call-path or contract mismatch found, not reproduced as a
  visible failure.
- **Implemented:** code and focused regression exist; this alone does not imply
  visual or workflow validation.
- **Verified:** the actual path and output passed the required checks.
- **Deferred:** deliberately outside this delivery or unavailable in the test
  environment, with the reason recorded.
