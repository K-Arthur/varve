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
  math in engine; tests. (this commit)
- **B — frequency separation**: scene ops, group marker + codec/clone/validation,
  IR decode + cache, dialog + command + inspector, E2E, export check.
- **C — liquify**: field persistence on raster node, IR warp, tool + overlay,
  freeze/thaw, undo, E2E.
- **D — combined**: FS + liquify composition ordering test; save/reopen;
  source replacement; deletion/unlink behavior.
- **E — performance/docs**: benchmark, docs, website feature pages, screenshots.

## Explicitly deferred

Median/bilateral decomposition modes, wavelet multiband, vector/text liquify,
symmetry, reusable deformation maps, GPU shaders.
