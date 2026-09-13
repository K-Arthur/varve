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
