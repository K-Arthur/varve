# Masking and compositing overhaul — baseline audit

**Date:** 2026-08-13  
**Scope:** structural WebGPU fallback, live scene mattes, and per-effect masks

This is the implementation baseline for the masking/compositing overhaul. It
records what the code does today; the current architecture documents are
updated separately as each capability lands.

## Docs-vs-code discrepancy table

| Area | Current documentation says | Code confirmed | Gap / consequence |
|---|---|---|---|
| WebGPU fallback | Unsupported content falls back while preserving the frame | `WebGPUBackend.drawVectorItems()` sends the whole call to Canvas2D unless every item in the call is a supported solid rect/circle batch | A flat `GPU, Canvas2D, GPU` sequence cannot be accelerated safely; there are no ordered fallback islands |
| WebGPU paint order | The render pipeline describes structural replay before the compositor | The compositor receives `RenderItem[]`; no structural plan is passed through `CompositorFrame` | Capability planning must be explicit and fail closed before backend execution |
| GPU presentation | GPU output is blitted to the persistent Canvas2D surface | `drawGpuItems()` uses `loadOp: 'load'` after the first GPU pass and `blitGpuToPresent()` draws the cumulative GPU texture each time | Multiple GPU runs can re-present earlier GPU pixels; each ordered run needs transparent, run-local ownership |
| Mask source eligibility | `masking-system.md` describes live scene sources but documents text/group clip limits | `canBeClipMaskSource()` allows shape/path/frame geometry only; `addMask()` requires a direct child for frame/group masks | Geometric clip eligibility and rendered alpha/luminance matte eligibility are conflated at the API boundary |
| External matte sources | The target model calls for live cross-tree dependencies | `Mask.sourceNodeId` is validated as a direct child except for adjustment masks; no shared dependency graph exists | Cross-tree text/group mattes and precise dirty expansion are not represented |
| Effect masks | Adjustment spatial masks are documented and implemented | `Effect` has no mask binding; `replay.ts` processes the effect array by hard-coded effect categories | An ordinary layer effect cannot own an independent mask; effect order is not globally stage-based |
| Effect identity | Effect docs describe stable IDs | Scene `Effect.id` is optional and missing IDs/duplicates are repaired using `cryptoId()` during normalization; engine `Effect` has no `id` field | Legacy documents are not deterministic before first save and render IR cannot associate an effect-local binding by identity |
| Text mattes | Text is rendered by the canonical text pipeline | Text can participate in alpha/luminance replay only when it is already a legal structural child source; no matte-specific dependency or font revision edge exists | Editing typography or font fallback cannot invalidate an external target through a shared graph |
| Group mattes | Group masks preserve structural compositing | Existing replay can render nested group structure for container masks | The capability is local/container-owned, not an explicit live matte source contract reusable by effect stages |
| Export capability | Export matrices describe node masks | SVG/PDF/codegen capability checks do not have an effect-local mask dimension | Export must classify effect-local masks and flatten only their smallest correct boundary |

## Capability map (current baseline)

Status values mean: `native` = represented and rendered by the current path;
`structural fallback` = represented but requires the Canvas2D structural path;
`raster fallback` = preserved by flattening to pixels; `unsupported` = rejected or
silently unavailable in the current path; `unknown` = not established by the
current contract.

| Source/content | Hard clip | Alpha matte | Luminance matte | Raster mask | Brush mask | Effect mask | Nested mask | Canvas2D live/worker | WebGPU | Raster export | SVG/PDF/codegen |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Shape | native | native | native | native for supported image/frame spaces | native for supported frame/image workflows | unsupported | structural fallback | native / worker-gated | structural fallback | raster fallback | format-dependent |
| Image-filled shape | native | native | native | native | native | unsupported | structural fallback | native / worker-gated | structural fallback | raster fallback | format-dependent |
| Text | unsupported as geometric clip | structural fallback when legal child source | structural fallback when legal child source | unsupported as a direct asset source | unsupported | unsupported | structural fallback | native main-thread / worker-gated | structural fallback | raster fallback | raster fallback where needed |
| Frame | native | native | native | native in container-local space | native | unsupported | structural fallback | native / worker-gated | structural fallback | raster fallback | format-dependent |
| Group | unsupported as geometric clip | structural fallback when legal child source | structural fallback when legal child source | unsupported | unsupported | unsupported | structural fallback | native / worker-gated | structural fallback | raster fallback | format-dependent |
| Adjustment | unsupported as clip source | native spatial mask | native spatial mask | unsupported | unsupported | n/a | structural fallback | native replay | structural fallback | raster fallback | rasterized boundary |
| Component/instance | unknown | unknown | unknown | unknown | unknown | unsupported | unknown | unknown | structural fallback | raster fallback | format-dependent |

The map intentionally distinguishes a source's ability to provide geometric
clip data from its ability to provide rendered coverage. It is a baseline,
not a promise that a future source contract should inherit all of these cells.

## Files audited

- `packages/compositor/src/types.ts`, `router.ts`, `webgpu/backend.ts`
- `packages/engine/src/types.ts`, `replay.ts`, `filterCompositor.ts`
- `packages/scene/src/types.ts`, `masks.ts`, `clippingMask.ts`, `effects.ts`,
  `adjustmentScope.ts`, `version.ts`, `version-migrations.ts`
- `packages/editor/src/render/sceneToEngine.ts`, `render/replayScene.ts`,
  `canvas/renderPipeline.ts`
- `docs/architecture/masking-system.md`, `render-pipeline.md`,
  `canvas2d-system.md`, `effect-rendering.md`, `live-effects-system.md`,
  `docs/adr/0003-compositor-backend-selection.md`

## Baseline implementation decisions

1. Keep `Mask` as the node/container mask contract. Add a separate typed
   source/binding contract for live dependencies and effect-local ownership;
   do not turn `mask` into an overloaded boolean.
2. Plan WebGPU capability from ordered render structure. Until structural
   metadata is available at the compositor seam, an unsupported flat item is
   the smallest safe island and the planner must not infer parent semantics
   that are absent from IR.
3. Preserve Canvas2D replay as the visual oracle. WebGPU only changes stage
   execution and must not change item order or mask/effect semantics.
4. Make effect identity survive scene normalization and engine transport before
   adding effect-local mask execution.

