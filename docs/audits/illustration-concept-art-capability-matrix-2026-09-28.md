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
| Paint with a vector selected while another pixel layer exists | Resolver chose a raster fallback when selection contained no raster, silently redirecting the stroke. The first recovery pass also exposed that the resolver checked publishing-page roots while the editor was on a Design Canvas. | `paintTarget.ts` + `PaintTool`; refuse the incompatible explicit selection, validate ancestry against the active editor surface, and provide a deliberate create-and-select recovery. | Existing Paint tool options show **Create paint layer** only with an explicit non-raster selection. | Resolver and active Design Canvas regressions pass. The leased Chromium refusal → recovery → repaint journey passes; captures `test-results/illustration-paint-recovery-20260929-4386/paint-brush-ui-paint-UI-in-7e966-g-into-another-raster-layer-chromium/paint-layer-recovery-available.png` and `.../paint-layer-recovery-stroke.png` were inspected. The declined stroke leaves prior art alone, and the deliberate next stroke lands on the new selected Paint Layer. Undo/reopen/export for this scenario remain pending. |
| Paint a mask | Resolver checked only node existence/lock; it accepted hidden nodes and arbitrary mask IDs. Mask-session coordinate handling must match the identified mask asset. | Existing raster-mask session and asset registry; validate node, exact asset identity, visibility/locks, active page and invertible mapping. | Existing mask target/inspector surface. | Resolver and PaintTool unit regressions pass for stale/wrong mask and selection clearing; real mask UI workflow pending. Node-local mask coordinate spaces are refused pending an explicitly supported mapping. |
| Paint when a fallback layer has been deleted | Resolver dereferenced the missing fallback node. | Shared resolver returns a stable refusal; no exception and no redirected deposit. | Existing spoken feedback. | Deleted fallback and inaccessible-target resolver cases covered by focused tests; layer-creation recovery and persisted project check pending. |
| Switch tools immediately after releasing a paint stroke | `PaintTool.onDeactivate` aborted the open transaction while the worker was still draining its confirmed pointer-up tail; the new Brush Layer appeared, then vanished when Marquee activated. | Deactivation cancels only a held pointer gesture; a released stroke stays alive until all worker branches settle and commits once. | Existing paint and marquee tools. | Reproduced before the fix in `test-results/illustration-selection-fill-20260928-4373/canvas-selection-fill-sele-512bb-ction-Sources-and-undoes-it-chromium/selection-fill-painted-underlay.png`; after the fix, inspected captures `test-results/illustration-selection-fill-20260928-4378/canvas-selection-fill-sele-512bb-ction-Sources-and-undoes-it-chromium/selection-fill-target-retained.png` and `selection-fill-after.png` show the Brush Layer survives Marquee activation and the selected fill changes artwork. The focused PaintTool suite passes 39/39. Full E2E completion is still pending: a later run was interrupted by unrelated Vite parse errors in the concurrently modified `packages/engine/src/backgroundRemoval/modelLoader.ts` and duplicate scene exports. |
| Image-backed Magic Wand finishes after a later action | Decoding could finish after a new click or tool switch and apply a stale source result. | Pin request order, target identity and settings; invalidate on later pointer action or deactivation. | Existing Magic Wand tool and selection announcement. | Implemented; three focused async regressions pass for latest click wins, deactivation cancellation, and replaced-node refusal. Touched-file format/lint and docs/emoji/radius/token audits pass. The editor package closure has seven unrelated failures across workspace and concurrent drawing-input tests; direct editor typecheck has two existing unrelated `CurveEditor.test.tsx` errors. This does not prove separated linework-to-flats behavior. |
| Raster sketch → ink → flats → shading → transparent PNG | Separate brush/selection operations exist, but cross-tool target and save/export continuity has not been verified as one authored workflow in this audit. | Existing paint, selection, layer-mask, persistence and export systems; use ordinary layers and current format. | Existing tool options, inspector, save and export dialogs. | A narrow Marquee → Fill pixel layer route has been exercised in Chromium: the 640×480 PNG export contains 11,134 opaque black pixels, undo and redo changed the canvas as expected, and the saved document reopened with its layer tree. The reopen pixel check initially looked off-page because the camera was restored elsewhere; the test now fits the page before checking. Its latest full run could not reach that assertion after a concurrent Vite transform error in `packages/engine/src/backgroundRemoval/modelLoader.ts`. This is a same-layer fill check, not clean linework-to-separate-flats sampling, shading, or the complete transparent-PNG workflow. |
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

The current Magic Wand journey ran on isolated port 4361 through the existing
selection-source and Inspector export controls. It selected painted pixels,
invoked **Fill pixel layer**, exported a 640×480 PNG, then saved and reopened
the document from the Home library. The test passed and the selection,
post-fill and reopened application captures were inspected:

- `test-results/run-227676-4361/canvas-raster-magic-wand-r-ea64f-e-existing-flat-fill-action-chromium/raster-magic-wand-selection.png`
- `test-results/run-227676-4361/canvas-raster-magic-wand-r-ea64f-e-existing-flat-fill-action-chromium/raster-magic-wand-filled.png`
- `test-results/run-227676-4361/canvas-raster-magic-wand-r-ea64f-e-existing-flat-fill-action-chromium/raster-magic-wand-reopened.png`
- `test-results/run-227676-4361/canvas-raster-magic-wand-r-ea64f-e-existing-flat-fill-action-chromium/raster-magic-wand.png`

The test currently samples and fills the same raster with its foreground
colour. Its export contains 2,845 opaque black pixels, so this validates the
existing command/save/export path but is not evidence of a separated
linework-to-flats workflow. That stronger proof remains open.

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
