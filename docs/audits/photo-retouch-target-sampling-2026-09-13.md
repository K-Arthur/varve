# Retouch target ownership and merged sampling — audit and repair

Date: 2026-09-13
Scope: Photo workspace retouch family (Clone Stamp, Healing Brush, Spot Heal,
Patch) and the shared raster sampling they depend on.
Status: implemented; browser evidence recorded separately below.

This is an evidence checkpoint, not a claim that every Photoshop-class
retouching workflow exists. It records what was verified in code and runtime,
what was changed, and what remains outside the supported contract.

## Research ledger (accessed 2026-09-13)

| Source | Finding | Implementation consequence |
| --- | --- | --- |
| Adobe Photoshop CS4 manual, "Altering an image with the Clone Stamp tool" (sample options); Photoshop on the iPad help, "Retouch documents" | Clone/heal expose Sample: **Current Layer**, **Current And Below**, **All Layers**; Aligned keeps the sampling point across strokes, unaligned restarts from the initial sample. | Sampling is modelled as an explicit three-value scope, frozen per stroke; aligned/non-aligned anchor behaviour retained. |
| Smashing Magazine, "The Ultimate Guide To Clone Tools In Photoshop" (2010); graphics-pro, "How to Replace Image Content Using Clone Tools" (2021) | Adjustment layers are included in "All Layers" unless ignored; retouching on a separate empty layer requires Current and Below or All Layers to see the photo beneath. | Merged sampling composites contributors bottom-up and separates the read source from the write destination; the Photo "Prepare retouch layers" workflow must select a merged scope to see the locked photo pixels. |
| W3C, Compositing and Blending Level 1 (CR Draft, 21 March 2024) | Blending is evaluated before alpha compositing; group isolation and Porter-Duff source-over are distinct. Source-over with transparent destination keeps straight source RGB. | Sample compositing uses premultiplied source-over for normal, and the shared engine `blend()` for other modes instead of treating every layer as normal. |
| Pérez, Gangnet, Blake, *Poisson Image Editing*, ACM TOG 22(3), 2003 | Healing is properly a gradient-domain (Poisson) reconstruction; the paper itself notes Photoshop's Healing Brush algorithm was unpublished. | The existing mean-colour-shift approximation is kept and labelled a first-order approximation; it is not described as a full Poisson solve. |
| W3C WAI, Understanding SC 2.5.7 Dragging Movements (WCAG 2.2) | Dragging is an interaction where the pointer engages and the element follows until release; path-based freehand drawing is governed separately by SC 2.5.1. | Retouch strokes remain path-based input with the existing pointer test; no blanket WCAG conformance claim is made for freehand painting. |

Additional repository context: `docs/architecture/paint-system.md`,
`docs/audits/photo-editing-compositing-audit-2026-09-08.md`,
`docs/audits/drawing-input-quality-audit-2026-09-13.md`.

## Findings

### R1 — Silent destination redirect (high)

`findEditableRasterLayer` returned the first raster layer anywhere in the active
page when the selection was not itself a raster. Clone Stamp and Healing Brush
then wrote to that layer. Selecting an image-filled shape and using a retouch
tool silently edited a different object — exactly the class of "it changed the
wrong layer" reports the audit brief warned about. Spot Heal and Patch shared the
same resolver without a stated reason.

Reproduction (unit): select a frame while a raster layer exists; Alt+click.
Before: the tool accepted the raster as target. After: refusal naming the
selection and no document mutation.

### R2 — Implicit empty-layer creation before validation (high)

`CloneStampTool.onPointerDown` resolved `findEditableRasterLayer() ?? createTarget()`
before checking whether the interaction was a source-set or a paint. On a page
with no raster layer, a plain click or an Alt+click created a page-sized empty
"Brush Layer" and returned `consumed: false` — stray artwork from an incomplete
action, with its own history entry. Healing Brush had the same shape.

### R3 — Merged sampling ignored page scope, paint order, visibility, and transforms (high)

The three duplicate `flattenVisibleStack` implementations iterated
`Object.values(document.nodes)` — every raster layer in the document, including
other pages, hidden groups, opaque groups, and layers with unrelated transforms —
and merged tiles by key as if all layers shared one pixel space. The UI label
claimed "visible raster layers". Smudge already used a page-scoped,
paint-order-aware walk; the retouch family did not.

### R4 — Untouched tiles were version-bumped and no-op strokes recorded history (medium)

`compositeRetouchDab` always wrote a fresh tile object with `version + 1` for
every tile touched by the dab, even when no pixel changed, and always returned a
new node. A self-clone or a fully transparent source therefore invalidated tile
caches and produced an undo entry for a stroke that changed nothing.

### R5 — Source anchor was stored in one layer's local space (medium)

The clone/heal source point was stored in the local coordinates of the layer it
was picked on and reused directly as the offset for whatever layer was targeted
later. With different transforms between source and destination layers, the
anchor pointed at the wrong pixels. (The same relative-transform problem also
made the R3 tile merge incorrect.)

## Implemented changes

| Area | Change | Files |
| --- | --- | --- |
| Target ownership | `resolveRetouchTarget` refuses locked/hidden layers and selected non-raster objects with a stated reason; no implicit creation; no fallback scan when another object is selected; document-state form feeds the canvas badge | `packages/editor/src/tools/rasterTarget.ts` |
| Source anchoring | World-space anchor with per-destination mapping; aligned carry-forward stays correct across transform changes | `CloneStampTool.ts`, `HealingBrushTool.ts`, `rasterTarget.ts` |
| Source marker + target badge | `PaintOverlay` is mounted while a retouch tool is active; a module-level external store publishes the world anchor/cursor without re-rendering the shell per sample | `retouchOverlayState.ts`, `CanvasOverlays.tsx`, `CloneStampTool.ts`, `HealingBrushTool.ts` |
| Stroke tail | The pointer-up position is stamped so a fast stroke does not drop its final segment | `CloneStampTool.ts`, `HealingBrushTool.ts` |
| Sampling scope | `SamplingScope = current \| below \| allVisible` exposed in the tool options; merged scopes composed bottom-up in active-page paint order with hidden ancestors excluded | `retouchSampling.ts`, `RetouchToolOptions.tsx`, all four retouch tools |
| Transform + blend fidelity | Per-layer transforms mapped into the destination's local pixel space (bilinear inverse sampling, bounded work budget); per-layer opacity and blend modes applied through the shared engine `blend()` | `retouchSampling.ts` |
| No-op strokes | Byte-identical writes skipped; untouched tiles keep their version; unchanged nodes return the same reference so tools abort the transaction | `packages/scene/src/retouchRaster.ts`, all four retouch tools |
| Consolidation | One paint-order layer walk used by Smudge and the retouch family | `retouchSampling.ts`, `SmudgeTool.ts` |
| Overlay paint reliability | `PaintOverlay` was dead code, so its styles were never validated: every stroke referenced the nonexistent `--color-accent` token (`stroke: none` computed) and the badge's logical-position rule did not place it. Fixed to `--color-accent-primary` and physical `top`/`left`; the blocked badge uses `--color-feedback-danger` | `PaintOverlay.css` |

## Capability matrix (this slice)

| Capability | Status | Evidence |
| --- | --- | --- |
| Explicit selected-layer destination | working | unit: target safety tests; E2E: target-safety spec |
| Refusal with reason for locked/non-pixel targets | working | unit + E2E announcements |
| No implicit empty layer / no stray artwork | working | unit: no-fabrication test; E2E layer count assertions |
| Current / Current and below / All visible scopes | working | unit: scope + paint-order tests; E2E option selection |
| Active-page scope, hidden ancestors excluded | working | unit scope tests; shared walk tests in `SmudgeTool.test.ts` |
| Transformed-layer mapping | working (bounded) | unit: translated-layer test; 16 MPixel work budget reports `truncated` |
| Per-layer opacity and blend modes in merged samples | working | unit: opacity and multiply tests |
| Layer masks, clipping, group opacity, adjustment layers, live effects in merged samples | missing (documented) | Requires renderer-backed readback; not claimed in UI copy |
| No-op stroke suppression (no version bump, no history) | working | scene unit tests; editor no-op test |
| Cross-layer source anchor with transforms | working | unit: `sourcePointInLayerSpace` mapping (covered through tool tests) |
| Pointer-up final position | working | unit: transaction tests stamp the release point before commit |
| Clone-source marker on canvas | working | store unit tests; E2E marker locator assertion |
| Live retouch target badge / refusal reason | working | E2E badge text assertions |
| Pen pressure/tilt mapped to retouch brush dynamics | missing (documented) | Fixed retouch presets; carried future work |

## Validation

Environment: Linux x86-64 (CachyOS), Node 26 / pnpm 11.9, Vitest 4.1.10,
Chromium via Playwright.

Commands actually run and results:

- `npx vitest run packages/scene/src/__tests__/retouchPersistence.test.ts packages/scene/src/__tests__/retouchSampling.test.ts`
  — 14/14 passed.
- `npx vitest run` on the retouch tool suites plus `SmudgeTool` — 48/48 passed.
- `npx vitest run` on the retouch overlay store, tool, clone, heal, and
  sampling suites — 40/40 passed.
- `npx vitest run` on `HealingBrushTool`, `PatchTool`, `SpotHealTool`,
  `paintTarget`, and `FloatingToolbar` suites — 30/30 passed.
- `tsc --noEmit` for `@varve/scene` and `@varve/editor` — no errors in any
  touched file. Pre-existing errors remain in concurrent agents' in-flight
  files (`areaSelectionMorphology.ts`, `backgroundRemoval/maskDecode.ts`, and
  others); they are not caused by this slice.
- `pnpm typecheck:e2e` (run before the workspace lockfile changed) and a
  later `npx tsc -p tests/e2e/tsconfig.json --noEmit` — no errors in the
  retouch spec; remaining errors are concurrent agents' in-flight files.
- `npx biome check` on every touched file — clean.
- `node scripts/audit-docs.mjs` — clean (833 docs, 458 links).
- `node scripts/audit-emoji.mjs` — clean (4631 files).
- `node scripts/quality/affected-plan.mjs` — reported `FULL-SUITE ESCALATION:
  YES` because the shared tree contains concurrent workspace/toolchain changes
  outside this slice; scoped affected suites were run instead and the
  escalation is recorded rather than silently ignored.
- Playwright frozen-build runs against `vite build` output on isolated port
  1541 (Chromium, one worker, `playwright.retouch.local.config.ts`):
  - Pre-overlay build: healing-brush paint test passed (1.1 m).
  - Overlay build: Spot Heal/Patch persistence, undo/redo, save/reopen, and
    export test passed; target-safety test passed. The healing test hit its
    120 s budget mid-stroke under load; after raising only the budget to 240 s
    it passed (2.6 m) with no assertion changes.
  - Final overlay-CSS build: target-safety test passed (1.1 m) and
    `reports/ui-review/retouch/05-target-safety.png` shows the source crosshair
    and the "Retouching: Repair layer" badge painted on the canvas, plus the
    clone repair itself.
- Timeout budgets of 120 s were exceeded only under concurrent-agent load on a
  saturated host; only timings changed, never assertions.

### Visual verification that changed the fix

The first target-safety run passed its DOM assertions while the screenshot
showed no marker: the elements had correct geometry and z-index but
`getComputedStyle(circle).stroke` was `none`. The overlay was dead code until
this slice, so nobody had ever exercised its styles. Fixing the token and badge
position and re-running produced a screenshot where the crosshair and the
"Retouching: Repair layer" badge are visibly painted on the canvas. This is the
concrete reason the workflow requires inspecting screenshots rather than
trusting element-presence assertions.


## Remaining limitations and uncertainties

- Merged sampling is still a tile composite, not a renderer readback. Masks,
  clipping, group opacity, adjustment layers, and live effects are not
  reproduced and are stated as a limitation rather than approximated.
- The transformed mapping path allocates target-space tiles only where samples
  land and stops at a 16 MPixel budget; a truncated sample announces itself.
- Real-stylus pressure is still not mapped to retouch brush parameters; the
  drawing-input owner tracks stylus calibration separately.
- No physical Chromebook/WebKitGTK run was possible in this session; E2E
  evidence is Chromium-only and reported as such.

## Related findings outside this slice (not changed)

- `PaintTool` and `SmudgeTool` still resolve a page raster fallback when a
  non-raster object is selected. Paint creating a pixel layer is an intentional
  brush behavior, but it is not announced, so the same class of "where did that
  paint go?" surprise remains for those two tools. They are owned by the
  drawing-input task and were deliberately left untouched. The retouch badge
  covers the retouch family only.
- `flattenSceneToEngine` in `packages/editor/src/render/sceneToEngine.ts`
  contains a committed `TEMP DIAGNOSTIC (remove)` `console.debug` branch for
  pattern fills. It is unrelated to retouching; noted so the owning agent can
  remove it rather than having a second editor silently modify their file.

