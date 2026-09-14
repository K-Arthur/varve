# Frequency Separation & Liquify

Canonical architecture for Varve's two raster retouching systems. Both are
source-preserving: authored edits live in small, validated document state and
are applied at the canonical `flattenSceneToEngine` boundary, so the live
canvas, the render worker, thumbnails, and every export path agree by
construction.

**Status (2026-09-13):** implemented and verified for the Chromium web path;
the native WebKitGTK/WKWebView visual matrix remains pending. Working representation is
8-bit RGBA. No 16-bit, float, wide-gamut, or CMYK claims are made for either
feature; the declared precision contracts below are the product promise.

---

## 1. Frequency Separation

### 1.1 Model

Frequency separation splits a raster layer into two editable bands:

```
I  = source bytes
L  = gaussian low-pass of I (RGB), alpha passthrough
H  = I − L                      signed integer per RGB channel
E  = clamp(round(H/2) + 128)    stored detail band
R  = clamp(L + 2·(E − 128))     reconstruction, alpha from L
```

`R` reconstructs `I` within the declared tolerance:

| Metric | Declared bound | Measured |
|---|---|---|
| max abs error / channel | ≤ 1 LSB | 1 (hard bound) |
| mean abs error / channel | ≤ 0.5 LSB | ~0.5 on dense texture, 0 on flat content |

Even residuals round-trip exactly (including `H = 0`, so flat regions never
drift); only odd residuals can be off by one. Neutral detail is exactly 128, so
painting a detail band with 50 % gray is a true no-op. Alpha is never part of
the signed equation: the tone band carries source coverage and the decode takes
alpha from it, which prevents double attenuation through source-over.

### 1.2 Document representation

Applying the command converts a raster layer into a marked group in place:

```
group "… Frequency Separation"   GroupNode.frequencySeparation = {
  ├─ raster "… Tone"               version, method, radius,
  └─ raster "… Detail"             lowNodeId, highNodeId }
```

- Both bands are ordinary `RasterLayerNode`s, so paint, clone, heal, smudge,
  masks, transforms, effects, history, tile serialization, undo, and export
  need no special cases.
- The marker stores **node ids, never names**; renaming is always safe.
- Mask and effects move from the source layer to the group: they describe the
  composite, not one band.
- The original raster id becomes the tone band, so selection and external
  references stay valid.
- An unlinked marker (band deleted/foreign paste) is inert: the group renders
  as an ordinary group and nothing crashes.

### 1.3 Rendering

The decode happens at **band conversion**, inside `sceneNodeToEngineNode`, so
every render path — the worker-cached canvas traversal, the main-thread replay,
thumbnails, SVG/PDF raster bakes, and export — shares one implementation:

- While both bands are visible, the **tone band emits the decoded composite**
  (`low + 2·(high − 128)`, alpha from the low band) and the encoded detail band
  emits nothing.
- Hiding the detail band leaves the tone band rendering its own pixels; hiding
  the tone band leaves the detail band visible. Ordinary layer-visibility
  semantics therefore hold, and the bands remain honest layers in the panel.
- Band resolution is O(1): each band carries a validated `frequencySeparationRole`
  back-reference; a stale or foreign reference falls back to plain layer
  rendering.
- Group opacity, blend mode, masks, and effects apply to the composite through
  the normal group replay/structural semantics.
- The decode is cached by a revision that folds in both bands' tile versions
  and band fields, with a bounded pixel budget.
- A shared deformation on the group (`GroupNode.liquify`) is applied to the
  decoded composite; band-level fields are applied before reconstruction.

No render path can bypass the decode without bypassing `sceneNodeToEngineNode`,
which is the canonical conversion module.

### 1.4 Lifecycle rules

| Operation | Behavior |
|---|---|
| Radius change | `regenerateFrequencySeparation` re-splits the **current recombined state**. Retouching is preserved as pixels; only the split point moves. Never silently discarded, never silently stale. |
| Band paint | Ordinary tools; the IR decode is recomputed on the next frame (cache invalidated by tile versions). |
| Duplicate / paste | `deepCloneSubtree` remaps both band ids. Cross-document paste without the bands drops the marker. |
| Delete a band | Marker becomes inert; remaining layer is a plain raster layer. |
| Flatten | `flattenFrequencySeparation` bakes the current decode into one raster layer and drops the marker (one undo entry). |
| Nested separation | Rejected; the decode is a single defined pass. |
| Band-level liquify | Supported as an advanced single-component deformation: band fields are applied before reconstruction. Group-level fields deform the recombined composite. |

### 1.5 Precision and boundaries

- Working domain is sRGB-encoded bytes, matching the compositor. The blur is
  computed in premultiplied float and quantized once; hidden RGB under
  transparent pixels never bleeds into the low band.
- Border handling is clamp-to-edge; support is `ceil(3σ)`.
- `radius` means **Gaussian sigma in layer pixels**. Zoom, device pixel ratio,
  preview scale, and export scale never change the authored scale.
- The dialog preview uses a bounded proxy; the committed decomposition uses the
  full-resolution tiles.
- Method is Gaussian only (`FREQUENCY_SEPARATION_METHODS`). Median/bilateral
  are deliberately deferred until a verified reconstruction contract exists.

---

## 2. Liquify

### 2.1 Model

Liquify stores a bounded **output→source displacement field** on the target:

```
output(x) = sample(source, x + D(x))
```

- Grid: `rows × columns` control points (default 32×32, max 64×64), covering
  the layer's reference pixel rectangle. `D` is bilinearly interpolated.
- Displacements are in reference pixels and are clamped to
  `0.5 × reference extent` per axis (documented foldover policy: folds may
  form, but a control point can never request a sample farther than half the
  image away). Validation rejects non-finite and unbounded values.
- The source tiles are **never rewritten** by a stroke; identity is bit-exact.
  A destructive bake is not offered as an implicit side effect.

### 2.2 Brush modes

| Mode | Semantics |
|---|---|
| Push | Incremental pointer delta. Holding still cannot drift. |
| Expand / Contract | Radial, time-scaled so 240 Hz and 60 Hz input deform identically. |
| Twirl CW / CCW | Rotation of the source offset around the brush center. |
| Restore | Moves deformation toward identity in-place (local reconstruction, *not* exact undo). |
| Smooth | Laplacian relaxation of the deformation grid (never blurs image color). |
| Freeze / Thaw | Paints the protection coverage from the options panel; fully frozen control points cannot move (`1 − coverage` weight). |

Global reset removes the field in one undo transaction; history undo restores
the previous field. A field is persisted as bounded JSON (≤ ~2 k numbers at the
default grid) and freeze coverage as RLE+base64 bytes at ≤ 512 px on the long
side — both validated on ingest.

### 2.3 Coordinates and sampling

- Screen → document → node-local conversion uses the existing camera and world
  transforms (`rasterLocalPoint`, `worldToCanvas`), so zoom, canvas rotation,
  device pixel ratio, nested transforms, reflections, and nonuniform scale are
  handled by the same code path the brush tools already trust.
- The overlay derives its layer→screen affine from the same `getWorldTransform`
  used by painting, so the ring and grid agree with the affected pixels.
- Resampling is premultiplied bilinear. Border policy is **transparent**
  (out-of-bounds samples are transparent) — vacated regions never reveal an
  undeformed copy; `clamp` is available at the engine level for future
  workflows but is not the default.
- Radius is in **layer pixels**; camera zoom does not change it.

### 2.4 Targets

| Target | Behavior |
|---|---|
| Raster layer | Own deformation. Freeze coverage persisted on the layer. |
| Frequency-separation group | Shared deformation on the recombined composite (tone/detail stay aligned). Freeze is not available on this target in this version; the tool says so explicitly. |
| A band inside a separation | Advanced: deforms only that component, applied before reconstruction. |
| Vector/text/locked/hidden | Unavailable with a specific spoken reason; never silently rasterized. |

Geometry-level vector liquify (adaptive curve deformation) is a separate,
deferred capability.

---

## 3. Interaction between the two features

The composition order is fixed and testable:

1. A liquify field on a separation group is applied to the **decoded composite**
   (after `low + 2·(high − 128)`), so linked components cannot detach.
2. A liquify field on a band is applied to that band's pixels before the decode
   (advanced single-component deformation). Because decode is a linear
   combination of the sampled bands, a shared field on both bands would compose
   with reconstruction; the product does not need that path because the group
   target covers the intended workflow.
3. Frequency separation of an already-deformed layer decomposes the deformed
   pixels (deformation is resolved before the IR/decode boundary).
4. Painting or cloning targets the band's own tiles; the deformation never
   changes sampling coordinates for paint (edits are authored in the band's
   undeformed pixel space, which is what the layers panel shows).

---

## 4. Performance notes

- FS decode and liquify warp are cached per node revision (tile versions +
  field revisions) with pixel budgets (24 MP / 16 MP). A cache miss is a full
  buffer pass; caching keeps committed state off the per-frame path.
- During a liquify stroke the document field is updated per coalesced sample;
  the overlay is drawn on its own canvas so the shell is not re-rendered per
  sample.
- No `SharedArrayBuffer`, worker protocol, schema, or lockfile change was made
  by either feature.

## 5. Failure behavior

- Malformed fields/markers are repaired or ignored (validation on ingest), and
  the UI reports unsupported targets rather than failing silently.
- Missing image resources fail the export barrier exactly as before; neither
  feature introduces a new async asset type.
- Cancellation restores the pre-session state: `abortTransaction` on
  Escape/pointer cancel/tool switch; the dialog's Cancel mutates nothing.

## 6. Verification

| Invariant | Where it is held |
|---|---|
| Unedited reconstruction ≤ 1 LSB/channel, flat content exact | engine FS tests, scene ops tests, dialog readout |
| Editing tone/detail affects only that band | engine + scene tests; E2E pixel oracle |
| Hidden sibling falls back to the visible band's own pixels | `sceneToEngine.test.ts` |
| Re-split preserves the current composite | scene test + E2E |
| Flatten bakes the decode and drops the marker | scene test |
| Marker/bands survive serialize → decode (no raster bytes moved) | scene codec round-trip test |
| Duplicate remaps band references | scene clone test + role remap |
| Liquify identity is a bit-exact no-op | engine warp test |
| Push direction, expand/contract, twirl sign, restore, smooth | engine brush tests |
| Freeze fully protects; thaw frees | engine tests (fully-frozen field is identity) |
| Stationary push cannot drift | engine test |
| Undo restores the exact source frame; redo re-applies | E2E in-page pixel oracle |
| IR warp is identical across canvas/worker/export | conversion happens in `sceneNodeToEngineNode` |

Run the suites with:

```bash
npx vitest run packages/engine/src/frequencySeparation.test.ts \
  packages/engine/src/liquify/__tests__/liquify.test.ts \
  packages/scene/src/__tests__/frequencySeparation.test.ts \
  packages/editor/src/render/sceneToEngine.test.ts
VARVE_E2E_PORT=1452 npx playwright test \
  tests/e2e/canvas/frequency-separation.spec.ts \
  tests/e2e/canvas/liquify.spec.ts --project=chromium
```

## 7. Known limits

- 8-bit working representation only; the last LSB of a residual is the
  documented price of that choice.
- Gaussian method only.
- Freeze protection is available on raster-layer targets; a frequency
  separation group accepts deformation without freeze (stated in the tool).
- No frame-time benchmark yet for the full-resolution decode/warp passes;
  caches bound repeated cost but a cold pass on a very large layer is a
  visible pause.
- Vector/text liquify and geometry-level deformation of curved paths are out
  of scope for this system.

### 7.1 Repair pass (2026-09-13)

The repair pass added regression coverage for failure modes that are easy to
miss in helper-only implementations:

- Separation moves source opacity, blend mode, object filters, masks, and
  effects to the wrapper group so a decoded band does not apply appearance
  twice. The aligned bands retain their source placement and rotation.
- A source Liquify field is carried to the new separation group; it is not
  left on the tone band and applied a second time. Re-splitting materializes
  any advanced per-band deformation once and clears those consumed fields.
- Flatten materializes both component and shared group deformation once,
  removes authoring-only Liquify state, and composes group/child placement
  before deleting the wrapper.
- Group Liquify pointer coordinates resolve through the tone band's pixel
  space even when the wrapper and band have different transforms.
- CPU warp output dimensions and freeze-mask runs are bounded before typed
  array allocation. Invalid dabs and non-finite protection samples are safe
  no-ops.
- Render-cache replacement and eviction account for the old entry exactly
  once and expose read-only pixel-budget diagnostics.

The supported workflow remains intentionally conservative: 8-bit encoded
sRGB, Gaussian two-band separation, raster Liquify targets, and a CPU warp
fallback. Median/bilateral/wavelet decomposition, vector geometry Liquify,
group-level freeze masks, and a tiled large-raster warp path remain deferred
until they have independent reconstruction, sampling, and platform evidence.
