# Photo retouching — research ledger and capability matrix (2026-09-13)

Status: current-state engineering record for the retouch slice of the Photo
workspace. This document separates externally verified behavior, observed Varve
behavior, and the decisions this change makes. It is an evidence map, not a
marketing claim.

## Scope of this pass

Target safety, composite sampling scope, retouch blending/continuity, and the
truthfulness of the retouch UI labels in the existing Photo workspace. Global
tonal/colour operators, crop/geometry, RAW/HDR, and model-assisted features are
audited only where they bound this slice.

## Sources consulted

| Source | Accessed | Version / date | Finding | Consequence |
| --- | --- | --- | --- | --- |
| Adobe Photoshop CS4/CS5 user manual — Clone Stamp and Healing Brush options (via manualsdir/many-manuals mirror) | 2026-09-13 | CS4 manual text | `Aligned` samples continuously and keeps the sampling point across strokes; deselecting resumes from the initial sampling point. `Sample` offers Current Layer, Current And Below, All Layers. | Varve's aligned semantics match; the sampling scope must offer `current`, `current-and-below`, and `all-visible` rather than a single merged boolean. |
| Adobe docs via Smashing Magazine, "The Ultimate Guide to Clone Tools In Photoshop" | 2026-09-13 | 2010 article describing shipping Photoshop behavior | All Layers samples all *visible* pixels; invisible layers are ignored. Adjustment layers are included by default and can be excluded with Ignore Adjustment Layers. | Hidden ancestors must be excluded from the sampling composite; the merged composite must not silently include content the user cannot see. |
| Adobe help, non-destructive editing (helpx.adobe.com) — direct fetch returned HTTP 403 | 2026-09-13 | current | Not retrievable from this environment. The separate-layer retouching consequence is corroborated by the user reports below. | Recorded as a fetch limitation; no claim is based on the page text. |
| W3C, Compositing and Blending Level 1 (CR draft) | 2026-09-13 | CRD 2024-03-21 | Order is filter, then clipping/masking, blending and compositing. Blending is defined separately from alpha compositing; group isolation (opacity, filters, masks) changes the backdrop an element blends with. | Retouch compositing uses Porter-Duff source-over with premultiplied math and one coverage application; group effects are named as a boundary rather than approximated. |
| Reddit r/PhotoshopTutorials, "the source is an adjustment layer" | 2026-09-13 | 2023-05-22 | Users are blocked and confused when a retouch tool targets a layer with no pixels; the accepted answers are: select a pixel layer, or set Current And Below / All Layers. | A non-pixel selected target must produce a described refusal and a deliberate path, never a silent switch to another layer. |
| ModelMayhem forum thread, "Clone Tool stops working properly" | 2026-09-13 | observed thread | Sampling All Layers with adjustment layers above applies the adjustment twice, producing garish colours; the fix is Current And Below or ignoring adjustment layers. | The merged sampling scope must be relative to the target layer so content above it cannot be re-applied into the deposit. |
| Reddit r/GIMP, "Problems with Heal/Clone" | 2026-09-13 | 2024-09-08 | Healing on a transparent layer with sample merged produced black/wrong colours; premultiplied versus straight alpha handling at translucent edges is a known failure class. | Retouch blending must composite in premultiplied form and never erase a destination with an empty source. |
| GIMP developer list, healing-brush gamma thread (bug 783755 reference) | 2026-09-13 | 2017-10 | Per-channel Subtract in encoded RGB produces gamma artifacts; the suggested fix is a perceptual space such as LAB. | Varve's healing mean-shift is documented as a first-order encoded-RGB approximation. A perceptual-space heal is recorded as a follow-up, not silently presented as a gradient-domain solve. |
| Reddit r/AffinityPhoto, "source resets on every image" | 2026-09-13 | 2021-05 | Users retouching batches complain when each document resets the sampling scope; they want a stable default. | Sampling scope should be a persisted preference, or at minimum stable for the session; documented as a follow-up with the current behavior. |
| Reddit r/Photoshop, clone stamp "does nothing" | 2026-09-13 | 2018-2023 threads | Common causes are an empty active layer with Current Layer sampling and a stale selection; the tool gives no explanation. | Empty-target and no-op strokes must report why nothing happened and must not leave history entries. |
| K-Arthur/varve repository audit `docs/audits/photo-editing-compositing-audit-2026-09-08.md` | 2026-09-13 | repository | Retouching writes raster-layer history and is distinct from adjustments; capability boundaries are documented rather than hidden. | This pass repairs the retouch slice against that ownership map. |
| `docs/architecture/paint-system.md`, `docs/architecture/photo-raw-hdr-system.md` | 2026-09-13 | repository | Merged sampling is a bounded snapshot of visible raster tiles in active-scene paint order; vector/group/effect/transform content is explicitly not sampled. Healing is a first-order approximation. | Docs already name the boundary; the implementation lagged the paint-order and scope claims. This pass makes the implementation match and sharpens the labels. |

## Observed Varve behavior before this pass

1. `CloneStampTool`, `HealingBrushTool`, `SpotHealTool`, `PatchTool`, and
   `SmudgeTool` resolved their write target through
   `findEditableRasterLayer`, which (a) returns the first editable raster found
   in tree order, which is the bottom-most editable layer, and (b) falls back
   to any layer in the page even when a different non-raster object is
   selected. Reproduced in code and covered by new tests.
2. `CloneStampTool` and `HealingBrushTool` created a raster target before
   validating the clone-source interaction, so an Alt-click with no pixel layer
   present could create a page-sized empty layer during an incomplete action.
3. Merged sampling for clone/heal/spot-heal/patch iterated
   `Object.values(document.nodes)`, which is insertion order, not paint order;
   layer reordering does not rebuild that map. SmudgeTool already traversed the
   real tree.
4. The retouch overlay (`PaintOverlay`) that draws the clone-source marker and
   the paint-target badge was never rendered anywhere in the application.
5. `compositeRetouchDab` bumped a tile version for every touched tile even when
   no pixel was written, so empty/no-op strokes could leave tile churn.
6. The final pointer position was not stamped on pointer-up for clone/heal, so
   the last few pixels of a fast stroke could be dropped.
7. `findBestPatch` read the target patch from the source image, and `ncc`
   ignored its stride argument; `clonePixels`/`healPixels`/`spotHeal`/
   `patchRegion` blended straight RGB and alpha independently.
8. The Levels/Curves histogram exposed clipping counts only to screen readers;
   a sighted user could not tell whether an endpoint spike was the subject or
   lost detail.
9. Image Tuning Reset did not return the canvas to its original bytes. A
   neutral Exposure entry was still passed to `applyFilterWithCompositing`,
   which allocated two full-canvas surfaces and ran a premultiplied
   `getImageData`/`putImageData` round-trip. A frozen-build diagnostic measured
   295 differing pixels between the baseline and the reset state, every one of
   them exactly one quantization step (max delta 1), scattered across the
   antialiased image perimeter. The neutral rendering itself is exact for
   opaque pixels: the shared sRGB transfer functions round-trip all 256 byte
   values. The difference came from translucent edge pixels crossing the
   premultiplied canvas boundary for no reason.
10. Ctrl+Z pressed while a numeric input still has focus is consumed by the
    field's native text undo: the editor's document undo is deliberately
    skipped for typing widgets (`shouldIgnoreShortcutTarget`). The field then
    shows the pre-edit text while the document and canvas keep the applied
    value, and blurring commits the stale text as a new history entry. The
    journey verification blurs the field before undo; making in-field Ctrl+Z
    undo the document transaction is recorded as a shortcut-policy follow-up
    rather than changed in this pass.

Verification note: items 1, 2, 3, 4, and the tool-side half of 6 are owned by
a concurrent agent working in the same worktree (see
`docs/agents/photo-retouch-coordination-2026-09-13.md`); this session
committed item 7 and the histogram half of item 8, recorded their evidence,
and deliberately did not duplicate the owner's tool files.

## Surface-consistency verification (this pass, source inspection)

- Image Tuning's Exposure, Contrast, Shadows/Highlights, Temperature, Tint,
  Vibrance, and Saturation controls map to the shared `exposure`, `contrast`,
  `shadowHighlight`, `temperature`, `tint`, `vibrance`, and `saturation`
  adjustment kinds (`ImageTuningSection.tsx` control table); Object Filters and
  Adjustment Layers lower the same union through `adjustmentToFilter` and the
  reference compositor. The surfaces differ in attachment scope, not operator
  identities.
- The Exposure kernel converts sRGB bytes to linear light, applies `2^stops`,
  a bounded linear offset, and gamma, then re-encodes; a focused numeric test
  already pins this (`filterCompositor.test.ts`).
- PNG export starts from a metadata-free canvas encode and adds only explicit
  policy chunks, so a normalized orientation or dimension cannot be replayed
  from stale metadata (`metadata/png.ts`); raster decode applies EXIF
  orientation once via `createImageBitmap`'s default from-image behavior and
  `displayedDimensions` matches the decoded pixels.

## Decisions and implementation consequences

- Target resolution is explicit for retouch tools: the selected raster layer
  wins; a selected non-pixel object produces a described refusal; with no
  selection, the topmost editable raster in paint order is used and announced;
  otherwise a retouch layer may be created only when a paint stroke actually
  begins.
- Alt-click sets the clone/heal source without creating or mutating anything.
- Sampling scope becomes `current`, `current-and-below`, and `all-visible`
  (raster layers, active page, paint order, hidden ancestors excluded). The
  merged composite is transform-aware for raster layers and remains honest
  about not being a full renderer readback.
- No-op strokes abort instead of committing history; tile versions only change
  when a pixel value changes.
- A provably neutral filter entry at full opacity with normal blending is
  dropped before the compositor allocates surfaces, so Reset and re-enabled
  neutral controls return byte-exact original pixels and do no pointless work.
- The retouch overlay is wired so the source marker and target badge are
  actually visible.
- Healing remains a first-order mean-shift approximation; it is not advertised
  as content-aware synthesis.

## Capability matrix (retouch slice)

| Capability | Entry point | Current status | Evidence | Remaining action |
| --- | --- | --- | --- | --- |
| Clone source set on Alt-click | Retouch toolbar | working | E2E `retouch-tools.spec.ts`, unit tests | Keep |
| Clone source marker visible | canvas overlay | broken before this pass (component existed, never rendered) | code inspection | Wire + visual proof |
| Write-target safety with non-pixel selection | retouch tools | broken before this pass | code inspection + new tests | Fixed |
| No layer creation during source-only click | retouch tools | broken before this pass | code inspection + new tests | Fixed |
| Current-layer sampling | Sampling scope: Current raster layer | working | unit tests | Keep |
| Current-and-below sampling | Sampling scope | missing | code inspection | Added |
| All-visible raster-layer sampling in paint order | Sampling scope: Current and visible raster layers | partial (insertion order, hidden ancestors included) | code inspection | Fixed for raster layers; vector/group/effect/transform boundaries documented |
| Adjustment double-application avoidance | current-and-below scope | missing | external user evidence | Added by scope choice (adjustment layers are not raster layers, so they are outside the raster composite; the deposit target can be below them and the UI states the scope) |
| Straight/premultiplied alpha correctness | clone/heal/spot/patch engines | partial before this pass | unit tests added | Fixed in engine byte paths; tile compositor already premultiplied |
| Return-to-original (Reset) byte fidelity | Image Tuning exposure | broken before this pass; 295 edge pixels one step off | frozen-build pixel diagnostic | Fixed by neutral-filter skip in the compositor and replay (`91e9fa03b`, `15d254912`); re-verified by E2E journey |
| Undo after a committed numeric value | Ctrl+Z with the field focused | native text undo only; document keeps the value until blur | frozen-build state diagnostic | Documented; journey blurs first; shortcut-policy follow-up |
| No-op stroke leaves no history/tile churn | retouch tools | partial | new tests | Fixed |
| Final pointer position committed | clone/heal | broken before this pass | code inspection + E2E | Fixed |
| Healing quality (illumination adaptation) | Healing Brush | first-order approximation | docs + tests | Documented; perceptual-space solve is a follow-up |
| Per-document sampling preference persistence | tool options | missing | external user evidence | Documented follow-up |

## Uncertainty

- The direct Adobe non-destructive page could not be fetched (403); its
  behavior is represented through the CS4/CS5 manual text and the Smashing
  Magazine description of shipping behavior.
- The user reports are anecdotal but consistent across products and versions;
  they are used to prioritize failure modes, not to define exact math.
- Transform-aware merged sampling covers raster-layer transforms. Group masks,
  non-normal blend modes, vector content, and image-filled shapes remain
  outside the tile-composite contract, as the architecture docs already state.

## Validation boundary

Focused Vitest per package, the retouch Playwright spec updates, and inspected
screenshots/recordings are recorded in the Agent Validation Report accompanying
the implementation commits. Cross-platform claims are limited to what was run.

Method note for the correction journey: the shared worktree was being edited by
a concurrent retouch agent while the first journey runs executed, and Vite HMR
reloaded the page mid-test. The verification was therefore moved to a frozen
production bundle (`vite build` to a temp directory, then `vite preview`), which
removes HMR as a variable; the Playwright session still exercised the real UI.
Diagnostics for the reset-identity and undo findings were run in the same
frozen-build environment with `?perf=1` so the canvas hash came from the
authoritative full-redraw path where available.

## Independent verification results (frozen build)

| Check | Command shape | Result |
| --- | --- | --- |
| Engine identity predicate + compositor | `vitest run packages/engine/src/filterIdentity.test.ts packages/engine/src/filterCompositor.test.ts` | 47 passed |
| Engine replay after the isolation change | `vitest run packages/engine/src/replay.test.ts packages/engine/src/filterIdentity.test.ts` | 71 passed |
| Editor replay scene | `vitest run packages/editor/src/render/replayScene.test.ts` | 11 passed (one import-time failure on a first run during concurrent edits; clean on rerun) |
| Histogram clipping widget | `vitest run packages/editor/src/components/Inspector/controls/HistogramWidget.test.tsx` | 9 passed |
| Histogram clipping real UI | frozen-build Chromium capture: Levels added above a black/white fixture | passed: warning reads "Clipped shadows 50.0% / Clipped highlights 50.0%", both endpoint markers drawn; screenshots `05-histogram-clipping-warning`, `06-histogram-clipping-panel` inspected |
| Corrections journey | frozen-build Chromium run of `tests/e2e/canvas/photo-correction-journey.spec.ts` | passed (53.5s): import, +1 EV, reset to baseline, undo/redo, bypass/re-enable, save, reload, reopen, and export. Screenshots `01-baseline`, `02-exposure-plus-one`, `03-bypass-restored`, `04-reopened` inspected. Edited export 2,055,397 B vs original 1,883,287 B; the reopened export is byte-identical to the edited export. |
| Reset identity diagnostic | frozen-build state capture before/after Reset | 295 edge pixels at delta 1 before the fix; byte-exact after |
| Undo state diagnostic | frozen-build state capture across edit/reset/edit/undo | in-field Ctrl+Z is native text undo only; documented above |
| Docs/emoji | `pnpm audit:docs`, `pnpm audit:emoji` | clean (836 docs, 4618 files) |
| Engine package suite | `vitest run packages/engine` | 4876 passed, 3 failed, none attributable to this session: `shaping.bench.test.ts` is a timing assertion that passes in isolation, `generativeEdit/diffusionFrame.test.ts` is concurrent uncommitted work, and `lut/lut-edge.test.ts` fails in the `.3dl` parser committed by the adjustments owner (`4593c24c6`). |
| Changed-file typecheck | `tsc -p packages/engine/tsconfig.json --noEmit` filtered to changed files; `tsc -p tests/e2e/tsconfig.json` filtered to the new spec | clean |

The full repository gate was not run: `pnpm verify:plan` escalated because the
shared working tree carries other agents' workspace/toolchain changes, and the
machine was running several concurrent E2E suites. Targeted checks were run
directly (and, where the pnpm script runner was broken by a concurrent manifest
change, via the underlying node scripts and binaries).
