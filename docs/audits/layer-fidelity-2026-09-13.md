# Layer Fidelity Audit — 2026-09-13

Scope: authored layer appearance, structure, identity, editability, persistence,
and interchange across the live canvas, export, scene operations, and import.
Method: code inspection with executed tests (Vitest, Playwright/Chromium), not
documentation reading. Line references are `master` at the time of the audit.

External references (accessed 2026-09-13):

- W3C Compositing and Blending Level 1, §8 Compositing Groups, §9 Porter Duff,
  §10 Blending — the basis for "group opacity applies to the composited group
  surface once, not per child" (https://www.w3.org/TR/compositing-1/).
- Rive community, "Group Layer Overlapping Transparency" — users report
  overlap darkening when group opacity compounds per child
  (https://community.rive.app/c/support/group-layer-overlapping-transparency).
- Shopify/react-native-skia issue #3355 — group opacity leaking to nodes
  outside the group when a mask child is present
  (https://github.com/Shopify/react-native-skia/issues/3355).
- Figma Learn, export settings — "Outline text" makes text non-editable after
  export; strokes export as fills
  (https://help.figma.com/hc/en-us/articles/13402894554519).
- Adobe Community / UserVoice threads on outlined SVG text, knockout groups,
  and isolated transparency groups in PDF overprint — the recurring theme is
  that a visually similar result is not the same as preserved editability and
  group semantics (illustrator.uservoice.com 49642487, 50428098; Adobe
  community 782436).

## Fixed in this pass

| # | Defect | First lossy boundary | Evidence | Fix |
|---|---|---|---|---|
| 1 | `ungroupNode` moved children to the group's parent without rebasing their local transforms. Ungrouping a moved/rotated/scaled group shifted all content. | `packages/scene/src/document-nodes.ts` `ungroupNode` | New tests in `packages/scene/src/document.test.ts` failed with `after[0]=1` vs `before[0]=1.7320508` before the fix | `ungroupNode` now computes `newLocal = newParent.world⁻¹ × oldWorld` per child via `composeWorldTransform`; `reparentPreservingWorldTransform` zeroes the legacy `rotation` field so it cannot apply twice (policy extracted from `clippingMask.ts`). |
| 2 | Node duplicate/repeat-duplicate shallow-copied `effects` and `tiles`: duplicates shared effect IDs and effect-mask source node IDs; raster duplicates shared tile `Map`/pixel buffers. Duplicate also translated every descendant, distorting internal layout. | `packages/editor/src/context.tsx` three bespoke `cloneNodeDeep` copies | `packages/scene/src/__tests__/clone.test.ts` (effect ID/param/mask/foreign/raster/offset) and `packages/editor/src/editor.test.tsx` duplicate tests | `deepCloneSubtree` now mints independent effect IDs (`cloneEffects`), deep-copies parameters, and remaps scene-node effect-mask sources (drops foreign references under cross-document paste). It gains `translate` (root only) and `nameSuffix`; the three duplicated clone bodies in `context.tsx` were replaced with one helper (`duplicateSubtreeInDocument`). |
| 3 | Crash-recovery points serialized the live document with raw `JSON.stringify`, converting `RasterLayerNode.tiles` (a `Map`) to `{}`. Recovery reopened an empty raster layer with no warning. The same raw pattern existed for auxiliary-window sync and detached-panel snapshots. | `packages/editor/src/recovery.ts` `createRecoveryPoint`; `context.tsx` mutation payloads; `useDetachedPanels.ts` broker snapshot | `packages/editor/src/recovery.test.ts` "preserves raster tile pixels across a recovery point" failed before the fix | All three now serialize through `@varve/scene.serializeDocument` (tile-aware, version-stamping, asset-payload-safe) and decode through the existing `DocumentCodec`. |
| 4 | Icon/asset-library insertion discarded the `ImportReport`; a sanitized SVG that lost constructs looked like a clean insert. | `packages/editor/src/context/useIconAssets.ts` `svgToDocument` | New `useIconAssets.test.tsx` cases (lossy report published; clean report silent) | `svgToDocument` returns the report; insertion/replacement publish through the shared `ImportReport` surface. |
| 5 | Five copies of the "does this report need UI?" predicate had drifted (file-level warnings were shown on some routes, dropped on others). Detection warning codes (`extension-mismatch`, `mime-mismatch`, `signature-unverified`) were flattened to `parser.warning`; `ImportCapabilities` (PDF) was produced and discarded. | `sessionGlobals` consumers, `packages/import/src/service.ts` | `sessionGlobals.test.ts`, `format-honesty.test.ts` | One canonical `importReportHasIssues`; detection codes preserved; `ImportFileReport.capabilities` carried and rendered as a clearly-labelled *format-level* summary in Import Results, separate from per-layer losses. |
| 6 | Structural render plan was not fail-closed: once any declared boundary produced a fallback island, unsupported leaves outside it were never scanned (emitted as "native WebGPU"); a declared `fallbackBoundary` whose leaves looked supported was ignored. | `packages/compositor/src/structuralRenderPlan.ts` `collectUnsupportedRanges` | New cases in `structuralRenderPlan.test.ts` (`falls back for unsupported leaves outside an already-created boundary`, `honors a declared boundary even when every leaf looks supported`, nested collapse) | Every item is scanned unless covered by a declared boundary; declared boundaries are authoritative; nested boundaries collapse into the enclosing range. The WebGPU backend's per-batch `isGpuBatchSupported` guard remains the second, independent gate. |
| 7 | Structured export flattened a group but only applied drop shadow, glow, inner shadow, and the first layer blur. Group backdrop, spatial/depth, chromatic, glitch, and subsequent content effects were lost at the export/print raster boundary. | `packages/editor/src/render/replayScene.ts` group branch | `packages/editor/src/render/replayScene.test.ts` (backdrop draw-through and multiple layer-blur cases); Chromium export test and inspected PNG | Group replay now applies backdrop effects through the rendered alpha silhouette, content effects once to the flattened surface in authored stage order, and appearance effects before final group compositing. |
| 8 | Export bounds were derived from flattened leaf geometry and omitted effect spill owned by a container or accumulated through a subtree. | `packages/editor/src/components/SpecPanel/export.ts` `exportWorldBounds`; `replayScene.ts` group buffer allocation | Chromium grouped-spatial-blur export: 248×228 output for a 200×180 union with σ=8, plus 31,880 partial-alpha halo pixels | Export bounds and group buffers now include visible authored effect support through the selected subtree, with conservative accumulated padding. |

## Follow-up implementation evidence (2026-09-13)

The first lossy boundary for the export defect was the group branch of
`replayStructuredScene`: the scene tree retained the effects and the export
capability planner correctly selected a raster boundary, but the raster replay
then emitted the child surface without evaluating the group-owned effects. The
repair stays at that boundary and reuses the engine's canonical blur, depth,
spatial, chromatic, glitch, glass, and backdrop operations. It does not mutate
the authored document or turn the group into a permanent raster layer.

The inspected Chromium evidence is deliberately two-part:

- `reports/layer-fidelity/group-spatial-blur-live.png` shows the live group
  surface after the real editor update and selection flow.
- `reports/layer-fidelity/group-spatial-blur-export.png` shows the downloaded
  transparent PNG. It is 248×228 rather than the 200×180 leaf union and has
  31,880 partial-alpha pixels in the blur halo. The visual comparison found
  the same cyan silhouette, transparent corners, and soft spill in both
  artifacts; selection chrome is present only in the live overview.

The portable SVG/PDF boundary remains appearance-only for unsupported native
constructs. The editable Varve document is not rewritten by this fallback.

## Verified, no defect found

| Property | Evidence |
|---|---|
| Live and export group opacity composite the flattened group surface once, so overlap alpha is `0.5` not `0.75` | `tests/e2e/canvas/group-opacity-alpha.spec.ts` samples real Chromium Canvas2D pixels in single and double coverage; `renderPipeline.ts` group flatten draws `gCanvas` once with `globalAlpha = n.opacity`. |
| Raster tile pixels survive `DocumentCodec.encode → decode` | `packages/scene/src/__tests__/rasterLayer.test.ts`. |
| Clipping-mask source remap on duplicate | `packages/editor/src/editor.test.tsx`; now also covered at scene level. |

## Remaining limitations (after the follow-up)

Severity: H = wrong final output / irreversible loss; M = degraded but visible;
L = diagnostics/coverage only.

| # | Limitation | Severity | Owner surface | Notes |
|---|---|---|---|---|
| A | Effect masks on shadow/glow/backdrop effects are ignored by every renderer; live canvas never resolves `scene-node`/`vector` effect masks | H (renderer) | `packages/engine/src/replay.ts`, `shadowSource.ts`, `canvas/renderPipeline.ts`, `render/replayScene.ts` | The Inspector no longer offers mask authoring for effect types that ignore masks (`effectSupportsMask`; content-stage only), and existing masks stay removable, but the renderers still do not evaluate them and the live canvas still has no effect-mask resolver. Needs per-effect mask semantics or an explicit degraded-preview state. |
| B | Live container flattening evaluates group effects in authored order with one out-of-band `layerBlur`, diverging from the leaf staged contract; live group `depthBlur` remains a no-op | M | `packages/editor/src/canvas/renderPipeline.ts` | Structured export is staged and complete for visible group content effects; live parity is still open and documented in `docs/architecture/layer-effects.md`. |
| D | Frame-owned effects see the frame's own item, not child pixels | M | `renderPipeline.ts`, `replayScene.ts` | Group flattening has the correct surface. |
| E | Allocation refusal / failed pixel reads in effects are silent (no diagnostic channel) | M | `replay.ts`, `effectPipeline.ts`, `shadowSource.ts`, `renderPipeline.ts` | `filterCompositor`'s `onDiagnostic` exists but is unused in production. |
| F | Flatten-boundary bounds are conservative for nested effect overflow, but the shared `compositor.computeNodeBounds` contract still uses maximum subtree padding rather than accumulated staged support | M | `packages/editor/src/export/compositor.ts` | Direct node export now accumulates authored effect support in `SpecPanel/export.ts`; the batch SVG/PDF boundary remains a separate follow-up. |
| G | Unknown node kinds are preserved by the codec but not traversed as containers, so their children are reported as orphans; no covered test for unknown-kind/field survival | L | `packages/scene/src/documentCodec.ts` | `version-utils.ts` / `version-migrations.ts` remain dead duplicate schemas (timestamped note in `docs/implementation/gradient-map-progress.md`). |
| H | Recovery/auxiliary/detached snapshots now serialize correctly, but recovery does not warn when a legacy point already contains `{}` tiles | L | `packages/editor/src/recovery.ts` | Legacy empty maps decode without a warning by design (`documentCodec.ts` `normalizeRasterTiles`). |

## Validation executed (2026-09-13)

Targeted, impact-scoped checks (the machine was heavily loaded by concurrent
sessions for part of the run; the full `pnpm verify:affected` plan was
escalated to `FULL-SUITE ESCALATION: YES` by *other* sessions' uncommitted
workspace/toolchain edits, so the affected closure below was run directly).

| Check | Command | Result |
|---|---|---|
| Scene ungroup/clone/coordinate | `pnpm exec vitest run packages/scene/src/document.test.ts packages/scene/src/coordinateService.test.ts packages/scene/src/clippingMask.test.ts packages/scene/src/__tests__/clone.test.ts packages/scene/src/__tests__/layerInvariants.test.ts packages/scene/src/__tests__/maskInvariants.test.ts packages/scene/src/__tests__/maskClone.test.ts` | 181 passed (22 clone incl. 5 new; 89 document incl. 2 new) |
| Scene typecheck | `pnpm --filter @varve/scene typecheck` | passed |
| Compositor plan | `pnpm exec vitest run packages/compositor/src/structuralRenderPlan.test.ts` | 6 passed (3 new) |
| Compositor typecheck | `pnpm --filter @varve/compositor typecheck` | passed |
| Editor duplicate integration | `pnpm exec vitest run --maxWorkers=1 packages/editor/src/editor.test.tsx` | 15 passed (offset + effect-mask duplicate assertions) |
| Recovery | `pnpm exec vitest run packages/editor/src/recovery.test.ts` | 30 passed (raster tile regression) |
| Import/editor batch | 9 files incl. `context.import`, `sessionBroker`, `auxiliaryShell`, `mergeImportedResources`, `useIconAssets`, `sessionGlobals`, `useFileImport`, `createActionHandlers`, `ImportResults` | 121 passed |
| Import honesty | `format-honesty.test.ts`, `service.test.ts`, `ImportResults.test.tsx` | 38 passed |
| Effect-mask capability gating | `pnpm exec vitest run --maxWorkers=1 packages/editor/src/components/Inspector/sections/EffectsSection.test.tsx packages/scene/src/effects.test.ts` | 32 + scene effects pass (new mask-support + hidden-control tests) |
| Tier 0 audits | `pnpm audit:tokens` / `audit:emoji` / `audit:docs` | tokens 153 pairs pass; emoji clean; docs clean |
| E2E typecheck | `pnpm typecheck:e2e` | only pre-existing `packages/engine/src/depthMap.ts(846)` unused-var error from a concurrent session; zero errors in the new spec |
| Group-opacity numeric (Chromium) | `VARVE_E2E_PORT=1473 pnpm exec playwright test tests/e2e/canvas/group-opacity-alpha.spec.ts --project=chromium` | transparent-page test PASSED (45 s): alpha is 0.5 in singly and doubly covered overlap regions, overlap is not 0.75; screenshot `reports/layer-fidelity/group-opacity-alpha.png` inspected — uniform 50% teal across single/overlap coverage |
| Group-opacity over colored backdrop | same spec, second case | First browser run exposed a test-design weakness (all shapes share one default fill, making isolation unobservable); the backdrop is now recolored through `setSelectedFill` and the guard asserts the foreground differs from both its pre-group color and the untouched backdrop. A green browser run is pending: repeated reruns died in `page.goto` (120–180 s timeouts) while the shared machine was at load average 40–60. |
| Structured group export replay | `pnpm exec vitest run --maxWorkers=1 packages/editor/src/render/replayScene.test.ts` | 10 passed, including group backdrop and multiple-layer-blur regressions |
| Raster export utility | `pnpm exec vitest run --maxWorkers=1 packages/editor/src/components/SpecPanel/export.test.ts` | 21 passed |
| Grouped spatial-blur export (real browser) | `VARVE_E2E_PORT=1793 VARVE_E2E_OUTPUT_DIR=layer-fidelity-export pnpm exec playwright test tests/e2e/export/compositor.spec.ts --project=chromium --grep "grouped spatial blur" --reporter=list` | 1 passed (3m 12s including cold Vite startup); export and live screenshots inspected |
| Package/editor typecheck | `pnpm --filter @varve/editor typecheck` | blocked by pre-existing unrelated errors in the dirty checkout; no diagnostic referenced the changed replay/export files |
| E2E typecheck | `pnpm typecheck:e2e` | blocked by pre-existing `packages/engine/src/canvasFontAliases.ts:307` and `packages/engine/src/replay.ts:1278`; no diagnostic referenced the new spec |

Pending in this environment: the Chromium run of
`tests/e2e/canvas/group-opacity-alpha.spec.ts` was attempted while every CPU
and ~22 GB of RAM were saturated by concurrent sessions (load average > 45);
the Playwright web server never reached `domcontentloaded` within 180 s. The
spec is typechecked and ready; it must be run when the machine is not
saturated.

## Research-driven product gaps worth scheduling

- **Duplicate direction**: other tools' duplicate offsets only the root; the
  old Varve behavior also translated descendants, which this pass corrected
  (test `editor.test.tsx` "deep-clones container nodes...").
- **SVG text editability**: Varve's SVG *import* keeps text where the parser
  supports it; SVG *export* outlining policy is a codegen concern; the
  marketing file-formats page already distinguishes editable/subset support.
- **PSD clipping-group blend options**: the PSD importer reports clipping
  masks as unsupported rather than silently mapping them; keep it that way
  until a real clipping-group model exists (see `docs/architecture/import-system.md`).
