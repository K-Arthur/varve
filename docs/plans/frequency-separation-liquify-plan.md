# Frequency Separation + Liquify — implementation plan

Status: in progress (2026-09-13). Canonical architecture doc lands at
`docs/architecture/frequency-separation-liquify.md`.

## Research decisions

| Question | Source (accessed 2026-09-13) | Decision |
|---|---|---|
| How do editors split tone/detail? | Affinity Photo 2 "Frequency separation" help; GIMP 3 wavelet-decompose; Photoshop Apply Image recipes (8-bit scale 2/offset 128, 16-bit invert/add) | Two-band Gaussian split stored as editable low/high raster layers. `L = blur(I)`, `H = I − L_bytes`, exact identity by construction. |
| How is the signed residual carried in an 8-bit pipeline? | ModelMayhem technical thread; GIMP legacy grain-merge note; fstoppers retouch mistakes | Encode `E = H/2 + 127.5` with full-range saturation-safe mapping; declared tolerance max 1 LSB/channel. Do not clamp raw H at 0. |
| Why not Linear Light compositing? | Varve `blendModes.ts` has no linearLight; Canvas2D GCO lacks it | Decode at the canonical `flattenSceneToEngine` boundary instead of adding a non-native blend mode, so all render/export paths share one implementation. |
| Why not wavelet/FFT first? | GIMP wavelet docs (integer reconstruction error, complex UI); pixls.us workflows | Gaussian two-band first. Multiscale = reapply on the low band (documented), not a new UI. Median/bilateral deferred until verified. |
| How do editors drive liquify? | Krita deform brush engine; Photoshop Liquify docs/user reports | Push, bloat, pucker, twirl CW/CCW, restore + freeze/thaw. Brush-driven, deformation-field based; no fluid sim. |
| What do users complain about? | Adobe/Reddit reports (2020–2025): no live magnitude preview, changes lost after OK, large-image failures, white edge outlines from transparent sampling, backdrop ghosting, mesh not following object transforms | Non-destructive field with live canvas preview; commit is atomic; bounded field; explicit border policy (transparent default, clamp optional); object-local coordinates so transforms do not detach the deformation. |
| Inverse vs forward mapping | OpenCV remap; texture clamp-to-edge/border specs | Store the output→source displacement `D`; `output(x) = sample(source, x + D(x))`. Composition of fields is not vector addition; brush dabs incrementally refit control points. |
| Edge/border sampling | GL EXT_texture_edge_clamp; SVG feImage Mitchell guard | Outside source bounds samples resolve to transparent. Vacated regions are transparent, never an undeformed copy. |
| Alpha | Varve `sampleTilesBilinear`, `retouch.ts` premultiplied blend notes | All resampling and decomposition is premultiplied; alpha reconstructed separately; no double attenuation. |

## Milestones

- **A — shared substrate**: liquify field/brush + warp sampler in engine; FS
  math in engine; tests. **Done** (commit `d6540af8e`, 30 unit tests).
- **B — frequency separation**: scene ops, group marker + codec/clone/validation,
  IR decode + cache, dialog + command, E2E. **Done.**
- **C — liquify**: field persistence on raster node, IR warp, tool + overlay,
  freeze/thaw, undo, E2E. **Done.**
- **D — combined**: FS + liquify composition ordering, save/reopen codec
  round-trip, duplicate remap, deletion fallback. **Done** (scene + IR tests).
- **E — performance/docs**: bounded render caches, fixture corpus, docs,
  website page. **Done.** A dedicated frame-time benchmark remains open.

## Verification record (2026-09-13)

| Layer | Evidence |
|---|---|
| Engine math | `packages/engine/src/frequencySeparation.test.ts` (tolerance, alpha, flat/exact, extremes); `packages/engine/src/liquify/__tests__/liquify.test.ts` (identity, direction, freeze, dt normalization, bounds, validation). |
| Scene ops | `packages/scene/src/__tests__/frequencySeparation.test.ts` (create/reconstruct/re-split/flatten/delete/duplicate/codec round-trip/band warp). |
| IR boundary | `packages/editor/src/render/sceneToEngine.test.ts` (band decode, hidden-sibling fallback, liquify warp in IR). |
| Real canvas | `tests/e2e/canvas/frequency-separation.spec.ts` (in-page pixel oracle: separation identity, undo, re-split), `tests/e2e/canvas/liquify.spec.ts` (drag deforms, undo exactly restores, redo re-applies). All green 2026-09-13. |
| Audits | biome staged check, audit:emoji, audit:docs, audit:health --staged, secret-scan --staged, import-boundaries — all clean. |

Known environment note: `pnpm` script execution is currently blocked on this
machine by `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (a concurrent
`node_modules` rebuild), so staged checks and E2E were run through the local
binaries (`node_modules/.bin/*`, `npx`) instead of the `pnpm` wrapper. Full
`pnpm verify:affected` remains to be run once the workspace install settles.

## Explicitly deferred

Median/bilateral decomposition modes, wavelet multiband, vector/text liquify,
symmetry, reusable deformation maps, GPU shaders, freeze on group targets,
and a dedicated liquify/FS frame-time benchmark.
