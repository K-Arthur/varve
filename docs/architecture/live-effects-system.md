# Live Effects System — Non-Destructive Procedural Effects

**Status:** current · **Introduced:** 2026-08-07

The live effects family is the coherent, registry-driven extension of Varve's
existing non-destructive adjustment pipeline. Ten new effect kinds cover seven
feature areas:

| Feature | Effect kind(s) |
| --- | --- |
| Live dithering | `dither` |
| Palette snapping | `paletteSnap` |
| Optical bloom / diffusion | `bloom` |
| RGB split / chromatic aberration | `rgbSplit` |
| CRT / analog screen | `crt` |
| VHS / tape artifacts | `vhs` |
| Volumetric light shafts | `lightShafts` |
| Lens flares | `lensFlare` |
| Light leaks | `lightLeak` |
| Water caustics / refraction | `caustics` |

None of these are isolated one-off filters. Every kind flows through the same
architecture as every other adjustment in Varve, which buys the entire feature
set — non-destructiveness, editability, reordering, undo/redo, persistence,
export, masking, scoping, and blending — for free.

---

## 1. Architecture

```
Adjustment (scene/engine filters.ts)          ← serialized in the document
      │  adjustmentToFilter()
      ▼
FilterIR (engine/types.ts)                    ← portable render IR
      │  applyFilterWithCompositing(target, filters, w, h, { quality, coordSpace })
      ▼
applySoftwareFilter (filterCompositor.ts)     ← dispatch by kind
      │
      ▼
liveEffects/<kernel>.ts                       ← deterministic ImageData kernels
```

- **Kernels** live in `packages/engine/src/liveEffects/`:
  `prng.ts` (seeded randomness), `quality.ts` (tiers + down/upsample),
  `paletteCore.ts` (shared quantization: metrics, nearest-colour lookup with a
  uniform-grid LUT for large palettes, median-cut + k-means generation),
  one module per effect, `presets.ts` (plain parameter presets), `index.ts`.
- **Metadata** lives in three registries, extended with one entry per kind:
  - `effectContract.ts` — working colour space, alpha convention, preview
    tolerance, `requiresRasterForExport`, CSS equivalent (always `null`),
    GPU status.
  - `adjustmentPipeline.ts` — `FILTER_PROPERTIES` capability classification
    and `effectPixelExpansion` bounds expansion per kind.
  - `filters.ts` — `AdjustmentKind`, per-kind interfaces, defaults, and the
    `Adjustment → FilterIR` mapper.
- **UI** is one new file, `LiveEffectEditors.tsx`, plus 10 menu entries in
  `AdjustmentPanel.tsx`. Controls reuse the existing `adj-editor__*` classes
  and the panel's drag-transaction batching (one slider drag = one undo
  entry). Presets populate ordinary parameters — no renderer branches.

**Adding a new effect** = add the kind to `filters.ts` + `types.ts` +
`filterCompositor.ts` dispatch + the two registries + one editor component.
No hub file (CanvasArea/Shell) changes.

---

## 2. Renderer capability matrix

| Effect | WebGPU | CPU/Canvas2D | Native | Export | Notes |
| --- | --- | --- | --- | --- | --- |
| dither | partial | yes | yes | raster | error diffusion is sequential; GPU path = CPU |
| paletteSnap | implemented | yes | yes | raster | LUT-accelerated lookup |
| bloom | implemented | yes | yes | raster | GPU: 2-level pyramid; CPU: 3-4 levels |
| rgbSplit | implemented | yes | yes | raster | premultiplied sampling |
| crt | implemented | yes | yes | raster | analytic patterns only |
| vhs | implemented | yes | yes | raster | seeded, frame-locked; GPU noise is hash-per-pixel |
| lightShafts | implemented | yes | yes | raster | screen-space ray marching |
| lensFlare | implemented | yes | yes | raster | procedural components |
| lightLeak | implemented | yes | yes | raster | seeded fBm + HSL |
| caustics | implemented | yes | yes | raster | GPU evaluates the field at full res |

Three backends, one dispatch:

```
Adjustment → FilterIR → applyFilterWithCompositing (sync, interactive preview: CPU)
                        └─ export path (async): dispatchLiveEffect
                             ├─ nativeEffectProvider  (Tauri IPC → crates/varve-effects)
                             ├─ gpuEffectProvider     (WebGPU compute, @varve/compositor)
                             └─ cpuEffectProvider     (TS reference kernels)
```

- The interactive preview stays synchronous CPU — the adjustment backdrop runs
  in CanvasArea's per-frame sync path; routing it through async IPC/GPU would
  change the per-frame hot path. Export (`flattenForExport`) applies live
  effects through the async chain, order-preserving per filter, falling back
  to the software path per filter on failure.
- Native kernels live in `crates/varve-effects` (f64, JS-compatible rounding,
  u32-wrapping hashes) and are exposed via the `apply_live_effect_binary`
  Tauri command (raw RGBA body + `x-varve-effect` JSON header). All 20
  fixture agreement cases pass (byte-exact for dither/paletteSnap/rgbSplit).
- GPU kernels live in `packages/compositor/src/webgpu/effects/` — a compute
  runner + one WGSL kernel per effect (dither error diffusion is sequential,
  so its GPU tier falls back to CPU). Offline naga compilation in
  `varve-bridge` validates every kernel in CI; a CDP-based verification
  harness (`packages/compositor/scripts/verify-gpu-effects.mjs`) compares
  GPU output against the CPU kernels in a real browser.
- A missing backend can never destroy content: the dispatch chain always
  ends at the CPU reference kernels.

---

## 3. Quality tiers

`interactive` < `normal` < `export` (`liveEffects/quality.ts`). The serialized
per-effect `quality` param (`auto` | `interactive` | `normal` | `export`)
resolves against the caller's tier — `auto` means "normal in preview, export
at export". Export call sites (`flattenForExport`,
`exportRasterizedSubtree`) always pass `export`, so preview shortcuts can
never leak into exported output. Tier effects today: bloom pyramid levels and
internal resolution, light-shaft step counts, caustic field resolution, VHS
bleed radius, flare intensity.

---

## 4. Coordinate spaces and zoom stability

The Canvas2D adjustment path passes a `coordSpace`
(`{ scale, originX, originY, regionX, regionY }`) into the filter chain,
derived from the current canvas transform. Kernels use it to interpret
parameters in **document pixels**:

- dither cells / Bayer phase — anchored to the document grid (no pattern
  swimming under pan/zoom; verified by unit test),
- rgbSplit offsets — a 4px split stays 4px at any zoom,
- bloom radius / caustic scale — document units.

The adjustment backdrop region itself was corrected to device space (the
previous code mixed document and device units, misplacing effects at
zoom ≠ 100%). Effects with unbounded influence (bloom, flares, streaks) use
the registry-driven `effectPixelExpansion`, applied with a 512px cap for
live-preview memory safety; export applies the full expansion.
Expansion is accumulated in filter order. A displacement after bloom must have
room for both the bloom spill and the displaced spill; taking only the largest
individual radius would clip valid pixels.

The IR path (`replay.ts`) now derives the same coordSpace from the current
canvas transform when compositing adjustment filters, so zoom stability holds
on the worker/IR path as well. On nested offscreen surfaces the transform is
identity and parameters interpret in the surface's own pixel space, which is
self-consistent.

---

## 5. Colour and alpha semantics

- **dither / paletteSnap / rgbSplit / crt / vhs / caustics lighting** — sRGB
  gamma space, straight alpha at kernel boundaries.
- **bloom** — threshold and soft-knee computed on linearized luma; the blur
  pyramid runs in linear light (reusing the engine's
  `gaussianBlurLinearLight`); the glow is composited in gamma space, matching
  the repository's documented convention (compositing in gamma, blur in
  linear — see the effects memory doc).
- **rgbSplit / crt** — premultiplied sampling internally so displaced or
  warped channels never produce dark/white fringes at semi-transparent edges.
- No kernel ever mutates the alpha channel except the explicit
  `alphaCutoff` policy (pixels below the cutoff are forced fully transparent
  in dither/paletteSnap).
- Dithering never switches the document to indexed colour — it is purely a
  render-time quantisation of the source pixels.

---

## 6. Determinism

All procedural output derives from integer seeds via `liveEffects/prng.ts`
(mulberry32, integer hashes, value noise, fBm) — no `Math.random()` anywhere
in kernels or presets. The same `(seed, time, frameRate, params, quality,
surface)` triple produces byte-identical output:

- VHS separates `seed` (pattern identity), `time` (animation), and
  `frameRate` (frame-locked noise).
- Caustics separate `seed`, `time`, `animationSpeed`; tileable mode uses
  integer-lattice wave vectors for exact spatial periodicity.
- Error-diffusion dithering is pure arithmetic (seed-independent by design,
  documented in the kernel tests).

---

## 7. Serialization and migration

Effects are plain JSON on the `AdjustmentNode.adjustments` stack — no new
schema version was required (additive kinds only). Unknown future kinds
degrade gracefully: `adjustmentToFilter`'s default arm maps them to a no-op
and the document stays readable. Existing migration infrastructure preserves
unknown fields. Palette data is embedded inline (from imported files or
document swatches at edit time), so rendering never depends on external
files.

---

## 8. Export

All ten kinds are classified `requiresRasterForExport`, so the existing
SVG/PDF rasterization paths flatten the affected subtree, apply the filter
stack at export quality, and embed the result. Effect bounds expansion is now
threaded through the live export pipeline end to end:

- `composeFlattenedRasterAssetsForNode` (the SVG/PDF export path) pads the
  raster surface by the registry-driven expansion for boundaries with
  adjustment filters, anchors the content at the expansion offset, and
  records `expansion` on the `RasterAsset`.
- The SVG emitters place such images at `x = -left, y = -top` with the
  expanded size, so bloom spill and RGB displacement are visible in the
  exported file instead of being clipped at the content rectangle.
- `flattenForExport` records the same metadata; assets without an
  `expansion` field keep the legacy placement, so older consumers are
  unaffected.

Covered by `flattenForExport` and `svg-adjustment-export` unit tests plus the
E2E export test. PDF raster fallback (per-node PNG-in-PDF) remains
content-bounds.

---

## 9. Palette files

`@varve/shared/paletteFormats.ts` gained an Adobe Color Table (`.act`) parser
with untrusted-input validation (length checks, clamped colour counts,
bounded allocation) plus a `parsePaletteFile` dispatcher reusing the existing
`.gpl`/`.ase`/`.aco` parsers. The Palette Snap editor imports all four
formats and can pull the document's own swatches. The palette is embedded in
the effect parameters, so export and reload never need the original file.

---

## 9b. Validation

- **GPU-disabled fallback (E2E):** `navigator.gpu` is removed before the app
  boots; bloom renders identically and toggling the effect returns the source
  appearance. The live-effects E2E spec also runs an axe-core scan
  (wcag2a/2aa/21a/21aa) over every effect editor — zero violations.
- **Memory safety (unit):** 1024×1024 dither and bloom (export quality, with
  streaks) complete with bounded, finite byte output; the palette LUT cache
  is keyed per palette identity and cannot grow unboundedly.
- **Test isolation:** the E2E spec clears localStorage and blocks the
  `varve-recovery` / `varve-crash-reports` IndexedDB opens at page start so
  crashed runs cannot restore documents or show recovery dialogs.

## 10. Performance notes

- Error diffusion runs one sequential pass; the LUT-accelerated palette
  lookup makes per-pixel quantisation O(1) for large palettes.
- Bloom uses a downsample pyramid (3 levels, 4 at export) instead of a giant
  kernel; streak mode smears only the coarsest level.
- Ray marching in light shafts caps at 96 steps; interactive tier halves the
  count.
- The adjustment backdrop surface is bounded by the 512px preview cap; the
  live canvas reuses the existing dirty-region replay (effects re-run only
  for the affected subtree region).
- Benchmarks: see `docs/perf/` for the canvas baselines; the kernels are
  covered by `pnpm bench`-style unit tests where timing-sensitive.

## 11. Known limitations

- Per-item IR-path effects lack zoom-aware coordSpace (use adjustment layers).
- Preview tiers are approximations: interactive-quality output differs
  slightly from export-quality output (tolerances in `effectContract.ts`).
- Dither error diffusion is sequential and stays CPU on the GPU tier
  (`gpuStatus: 'partial'`); the native tier implements all 7 algorithms.
- GPU kernels are f32 (the CPU reference is f64) and approximate a few
  structures: bloom uses a 2-level pyramid instead of 3-4, VHS noise is
  hash-per-pixel instead of a sequential RNG stream, caustics evaluates the
  wave field at full resolution instead of a quality grid, lens flare with
  an auto-source falls back to the screen centre. Visual equivalence is
  asserted by the CDP verification harness against per-effect bounds.
- Deep water caustics are a 2D interference approximation — no ray tracing
  or depth estimation.
- Export asset metadata records content bounds; the rendered surface is
  expanded (bloom spill is inside the PNG but downstream placement uses the
  content rect).

## 12. Object Filters and adjustment-layer scope

Varve has two complementary nondestructive adjustment surfaces. The product
name **Object Filters** is deliberate: it describes the node-local behavior
without borrowing Photoshop's “Smart Filters” label. The serialized
`smartFilters` field and internal compatibility names remain stable so saved
documents and existing integrations do not break.

- **Object Filters** live on any renderable scene node (`smartFilters`). They
  process that node's own rendered result and work across vectors, text,
  raster-backed shapes, paths, frames, and groups. The stack runs in array
  order and is cloned with fresh filter IDs during duplication and paste.
- **Adjustment Layers** remain scene nodes (`kind: "adjustment"`) because
  they process a backdrop scope rather than one node. Creating one from the
  Inspector or Object menu resolves its scope at creation time: selecting a
  frame/group places it as the container's last child and uses
  `container-descendant`; selecting a leaf places it after that sibling and
  uses `image-local`; multi-selection uses `explicit-targets`.

This placement is important. A frame-local adjustment is composited after its
children but before the frame leaves its parent, so it cannot affect unrelated
siblings outside the frame. A multi-selection never silently widens to all
descendants of a shared container. The scope inspector exposes the same model
for later changes and preserves a current image-local target when switching
modes.

The Inspector exposes Object Filters directly in Properties and Appearance,
and exposes an “Add adjustment layer” action for eligible selections. The
menubar and shortcut remain available as command-level access, but are no
longer the only route. SVG/PDF export treats visible Object Filters as replay
features and rasterizes the smallest affected boundary; raster export keeps
the shared replay path so vector and raster content use the same filter math.
