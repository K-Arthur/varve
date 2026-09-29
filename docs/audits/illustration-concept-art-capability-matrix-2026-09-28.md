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
| Limit translucent overlap inside one brush gesture | Opacity and flow were separate controls, but the canonical raster compositor applied every dab independently, so a translucent path darkened where dabs overlapped. | Optional `BrushPreset.accumulation` adds `buildup` and `stroke-opacity`. Legacy/imported presets default to buildup; stroke opacity caps one gesture per pixel while flow controls how quickly that cap is reached. Soft Shade uses the capped mode; one-byte coverage tiles are bounded to 64 MiB per gesture. | Existing Brush Editor, BrushSection, Brush Browser and production preview. | Implemented. Nine focused component/scene files pass (175/175); two leased Chromium checks pass, including a real Soft Shade pointer gesture and first/second gesture pixel comparison. The Brush Editor save callback retains the selected setting. Inspected `test-results/brush-accumulation-20260929/paint-brush-ui-paint-UI-in-91069-enders-searches-and-filters-chromium/brush-browser-paint-presets.png` and the `stroke-opacity-first-gesture.png` / `stroke-opacity-second-gesture.png` captures. Node compositor benchmark averages: 1K width 7.0 ms buildup / 9.0 ms stroke opacity; 2K 13.8 / 17.2 ms; 4K 29.6 / 35.4 ms. This opt-in mode adds ~19–29% in this microbenchmark; browser frame latency and physical stylus behaviour are unmeasured. |
| Paint with a vector selected while another pixel layer exists | Resolver chose a raster fallback when selection contained no raster, silently redirecting the stroke. The first recovery pass also exposed that the resolver checked publishing-page roots while the editor was on a Design Canvas. | `paintTarget.ts` + `PaintTool`; refuse the incompatible explicit selection, validate ancestry against the active editor surface, and provide a deliberate create-and-select recovery. | Existing Paint tool options show **Create paint layer** only with an explicit non-raster selection. | Resolver and active Design Canvas regressions pass. The leased Chromium refusal → recovery → repaint journey passes; captures `test-results/illustration-paint-recovery-20260929-4386/paint-brush-ui-paint-UI-in-7e966-g-into-another-raster-layer-chromium/paint-layer-recovery-available.png` and `.../paint-layer-recovery-stroke.png` were inspected. The declined stroke leaves prior art alone, and the deliberate next stroke lands on the new selected Paint Layer. Undo/reopen/export for this scenario remain pending. |
| Paint a mask | Resolver checked only node existence/lock; it accepted hidden nodes and arbitrary mask IDs. Mask-session coordinate handling must match the identified mask asset. | Existing raster-mask session and asset registry; validate node, exact asset identity, visibility/locks, active page and invertible mapping. | Existing mask target/inspector surface. | Resolver and PaintTool unit regressions pass for stale/wrong mask and selection clearing; real mask UI workflow pending. Node-local mask coordinate spaces are refused pending an explicitly supported mapping. |
| Paint when a fallback layer has been deleted | Resolver dereferenced the missing fallback node. | Shared resolver returns a stable refusal; no exception and no redirected deposit. | Existing spoken feedback. | Deleted fallback and inaccessible-target resolver cases covered by focused tests; layer-creation recovery and persisted project check pending. |
| Switch tools immediately after releasing a paint stroke | `PaintTool.onDeactivate` aborted the open transaction while the worker was still draining its confirmed pointer-up tail; the new Brush Layer appeared, then vanished when Marquee activated. | Deactivation cancels only a held pointer gesture; a released stroke stays alive until all worker branches settle and commits once. | Existing paint and marquee tools. | Reproduced before the fix in `test-results/illustration-selection-fill-20260928-4373/canvas-selection-fill-sele-512bb-ction-Sources-and-undoes-it-chromium/selection-fill-painted-underlay.png`; after the fix, inspected captures `test-results/illustration-selection-fill-20260928-4378/canvas-selection-fill-sele-512bb-ction-Sources-and-undoes-it-chromium/selection-fill-target-retained.png` and `selection-fill-after.png` show the Brush Layer survives Marquee activation and the selected fill changes artwork. The focused PaintTool suite passes 39/39. Full E2E completion is still pending: a later run was interrupted by unrelated Vite parse errors in the concurrently modified `packages/engine/src/backgroundRemoval/modelLoader.ts` and duplicate scene exports. |
| Image-backed Magic Wand finishes after a later action | Decoding could finish after a new click or tool switch and apply a stale source result. | Pin request order, target identity and settings; invalidate on later pointer action or deactivation. | Existing Magic Wand tool and selection announcement. | Implemented; three focused async regressions pass for latest click wins, deactivation cancellation, and replaced-node refusal. Touched-file format/lint and docs/emoji/radius/token audits pass. The editor package closure has seven unrelated failures across workspace and concurrent drawing-input tests; direct editor typecheck has two existing unrelated `CurveEditor.test.tsx` errors. This does not prove separated linework-to-flats behavior. |
| Raster sketch → ink → flats → shading → transparent PNG | Separate source sampling and output ownership were missing from Magic Wand; compact layer export only exports its selected node. | Existing paint, selection, layer-mask, persistence and export systems; visible-artwork sampling plus ordinary editable layers. | Magic Wand options, Selection Sources panel, Layers panel, Inspector export. | Partial workflow verified: real UI imports closed transparent line art, samples **Visible artwork**, creates a separate Flats layer, fills it red, and preserves the linework. Undo/redo, document save/reopen, and grouped PNG export pass. In run 4410 the transparent-corner 4096×4096 PNG contains 50,625 red pixels within the outline and 7,231 black linework pixels. Inspected full-scene captures: `test-results/illustration-hybrid-20260929-4410/canvas-raster-magic-wand-h-aacdf-ayer-then-saves-and-reopens-chromium/hybrid-linework-flats-filled.png` and `.../raster-magic-wand-reopened.png`; the selection/undo/redo captures are in the same folder. The user report about fill escaping an enclosed square motivated the closed-contour fixture; an earlier open fixture flooded as expected and is not a reproduced Varve defect. A bounded 0–8 px gap-closure radius is implemented for contiguous visible-artwork sampling; three deterministic tests pass for a bridged small opening, a wider opening that still leaks, and cancellation. Clipped shading now has a separate browser regression for the clip boundary, undo/redo, save/reopen, and transparent PNG; sketch/ink drawing, real-UI gap closure, edge-expansion boundary, and the complete raster workflow remain unverified. |
| Clip paint to a raster source | The live matte callback left the camera transform on its full-surface composition context, offsetting the mask; compact raster export also omitted the matte's external scene node. | Create an ordinary raster Shading child in a group with a live scene-node alpha matte; preserve source/destination separation and include external mask dependencies in structured render/export/sampling paths. | Paint tool options action on an explicitly selected raster source. | Reproduced in Chromium: red deposits existed in the child but the live group result was transparent; after the compositor transform fix, red appeared only within the blue source. The save/reopen path then exposed an all-transparent PNG because the source node was absent from flattened IR. Both defects are repaired. The leased one-worker E2E passes boundary pixels, undo/redo of layer creation and stroke, save/reopen, and PNG decode without leaving Design. Its 4096×4096 transparent export contains 41,146 red pixels and 16,730,091 fully transparent pixels. Inspected the full editor (`test-results/clipped-paint-design-workspace-final-20260929-r11/paint-brush-ui-paint-UI-in-2de46-e-its-visible-raster-source-chromium/clipped-paint-editor.png`), canvas (`.../clipped-paint-shading.png`), and exported PNG (`.../clipped-paint-export.png`). SVG/PDF appearance, Linux WebKitGTK, and physical stylus checks remain unverified. |
| Reopened illustration with raster LOD enabled | A cold visible-tile frame after save/reopen shows broad red tile bands, while the saved PNG and retained-surface redraw are clean. The existing “do not draw incomplete coverage” guard does not eliminate the mismatch. | Keep interactive raster LOD out of the default editor path until a cold-residency frame matches the same-camera retained-surface oracle. Preserve the explicit performance-probe opt-in for renderer qualification. | Existing `useRasterLod` adapter and same hybrid illustration E2E. | Reproduced on 2026-09-29 in the save/reopen E2E. The red-mask union was 68,770 pixels with 27,040 mismatches (39.3%); the LOD screenshot shows tile-shaped gaps. Disabling LOD and forcing an authoritative retained redraw produces the clean apple, and the downloaded transparent PNG is clean. The normal editor adapter now holds LOD disabled; this is a mitigation, not a root-cause repair. Cold LOD residency and cross-renderer parity remain unqualified. |
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

## Clipped-paint visual pass (2026-09-29)

After save/reopen, a leased Chromium run checked the full editor and canvas
closeup in Light, Dark, and High Contrast, then checked a 1024×768 narrow
layout. Each theme capture waits for the reopened red artwork pixel before
the full-editor screenshot, so blank first frames cannot masquerade as a pass.
The captures are in
`test-results/clipped-paint-visual-themes-20260929-r13/paint-brush-ui-paint-UI-in-2de46-e-its-visible-raster-source-chromium/`.
The screenshots were visually inspected. Browser DPR was 1; other DPI tiers,
Linux Tauri/WebKitGTK, and physical stylus remain open.

## Status vocabulary

- **Reproduced:** a deterministic code or visible UI interaction triggers it.
- **Static risk:** call-path or contract mismatch found, not reproduced as a
  visible failure.
- **Implemented:** code and focused regression exist; this alone does not imply
  visual or workflow validation.
- **Verified:** the actual path and output passed the required checks.
- **Deferred:** deliberately outside this delivery or unavailable in the test
  environment, with the reason recorded.
