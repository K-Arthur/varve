# Adjustment Layers, LUTs, and Effects Hardening

**Date:** 2026-07-25

**Branch:** `feat/adjustment-effects-hardening`

**Status:** Audit complete; LUT safety and persistence milestone implemented

## Scope and progress

- [x] Inspect scene, rendering, masks, editor, persistence, export, cache, colour, and tests
- [x] Classify existing capabilities and confirmed defects
- [x] State the current adjustment-scope and rendering contracts
- [x] Harden `.cube` and `.3dl` parsing against malformed and excessive input
- [x] Add a versioned LUT document codec with legacy recovery
- [x] Add deterministic LUT fingerprints for duplicate detection
- [x] Route the software renderer and adjustment inspector through the validated codec
- [x] Add focused parser, persistence, and renderer tests
- [ ] Move LUT payloads into the document asset table
- [ ] Add linked-LUT recovery, library thumbnails, recent LUTs, and drag-and-drop
- [ ] Resolve the effect-array versus fixed-pass ordering mismatch
- [ ] Add full preview/export pixel-parity fixtures
- [ ] Add tiled/cancellable effect execution and byte-bounded output caching
- [ ] Add native PDF adjustment rendering; current path rasterizes or warns
- [ ] Add a typed Rust adjustment representation
- [ ] Add 16-bit/float and ICC-aware adjustment processing

## Repository audit

| Area | Current state | Classification |
|---|---|---|
| Scene model | `AdjustmentNode` is in the canonical `SceneNode` union. Its ordered `adjustments` stack uses the engine's discriminated `Adjustment` union. A separate legacy singleton (`adjustmentType`/`params`) remains for compatibility. | Reusable, with migration debt |
| Adjustment scope | `image-local`, `explicit-targets`, `container-descendant`, and `document` scopes resolve deterministically. Missing legacy scope means eligible lower siblings in the same parent. Hidden nodes and adjustment nodes are excluded. | Implemented and tested |
| Local effects | Nine typed effects cover shadows, glows, blur, glass, chromatic aberration, and glitch. Effects live on visual nodes. | Implemented |
| Adjustment execution | Simple operations can use Canvas2D filter strings. Complex operations use `ImageData` software kernels through `filterCompositor.ts`. | CPU/Canvas2D complete; GPU compute absent |
| Adjustment UI | The mounted adjustment panel supports ordered stacks, controls, visibility, and LUT file import. Curves, levels, gradient map, duotone, tritone, halftone, and LUT controls exist. | Functional; long-stack/preset workflow partial |
| Effect UI | The appearance inspector supports add, remove, enable, edit, and reorder. | Functional; reorder semantics are misleading across passes |
| LUT parsing | `.cube` 1D/3D and a deliberately limited `.3dl` reader exist. Nearest, trilinear, and tetrahedral sampling exist. | Reusable after this milestone's hardening |
| LUT persistence | LUTs are embedded inside `lutJson`, avoiding absolute paths. Before this milestone, typed arrays used raw JSON and were restored by an unchecked cast. | Fixed with versioned codec; asset dedup still absent |
| Masks | Clip, alpha, luminance, inversion, feather, density, linked transforms, vector masks, and raster-mask assets exist. Adjustment nodes may own masks. | Implemented; a single mask per node, not `masks[]` |
| Presets | Built-in gradient-map and tritone presets plus editor preset infrastructure exist. | Partial; no complete LUT/effect-stack library |
| Colour | Canvas2D composition and most point adjustments use encoded sRGB. Blur and luminance masks have explicit linear-light work. Gradient interpolation supports perceptual spaces. | Honest 8-bit pipeline; not wide-gamut/CMYK-native |
| Preview performance | CSS filter fast path, OffscreenCanvas surfaces, a render worker for eligible scenes, large-blur downsampling, and a short-lived backdrop cache exist. | Partial; most effect outputs are uncached and uncancellable |
| Raster export | The structural compositor declares raster support for all current local effects and adjustments and reuses the scene replay path when a live engine is provided. | Implemented, but golden parity coverage is incomplete |
| SVG/PDF export | Unsupported effect subtrees are selected for raster fallback. SVG masks have native mappings. PDF supports little natively and relies on rasterization/preflight warnings. | Controlled fallback; native fidelity incomplete |
| Code export | Target analysis reports unsupported adjustment/effect features instead of silently claiming fidelity. | Warning/fallback only |
| Rust/native engine | Rust carries adjustment/filter data as untyped JSON and does not execute the TypeScript adjustment kernels. | Stored, not natively rendered |

## Confirmed defects

### Fixed in this milestone

1. Standard `.cube` 1D files store one RGB triplet per sample. The parser treated
   those values as three planar blocks, mixing channel data.
2. `.cube` and `.3dl` parsers accepted extra values, partial malformed rows,
   duplicate directives, ambiguous domains, and integer prefixes such as `2x`.
3. The former 3D size ceiling of 256 allowed a single float64 grid of roughly
   384 MiB before parser and string overhead, unsafe on the 4 GB target.
4. `JSON.stringify(Float64Array)` produced numeric-key objects. The deserializer
   returned an unchecked cast rather than restoring typed arrays or validating
   dimensions, domains, and finite values.
5. The renderer parsed embedded LUT JSON directly and silently trusted its shape.
6. LUT imports had no deterministic content fingerprint for duplicate detection.

### Open

1. `effect-rendering.md` previously claimed the complete effect array renders in
   user order. The renderer actually enforces fixed type passes. Reordering a
   `layerBlur` relative to a `dropShadow` does not change their cross-pass order.
2. Adjustment data is owned by `@strata/engine` but stored on `@strata/scene`
   nodes, an intentional dependency boundary that still leaves Rust untyped.
3. The main file-import route still creates legacy raw-transform JSON. The new
   renderer codec reads it safely, but new imports should converge on the versioned
   writer without increasing `Shell.tsx` hub coupling.
4. Local effects and adjustments use separate arrays and execution paths.
   Per-effect masks, opacity, and blend exist for adjustments only in the filter
   compositor; local-effect blend coverage varies by type.
5. Effect-expanded bounds exist, but preview, hit testing, export crop, and every
   spatial effect do not yet share one proven bounds contract.
6. Most software processing is synchronous and cannot be cancelled. Rapid edits
   can avoid stale worker frames in parts of the renderer, but adjustment kernels
   have no general latest-request-wins scheduler.
7. LUT input-space labels exceed the transformations actually implemented.
   `linearize` supports sRGB encoded versus linear processing; selecting ACES,
   camera-log, or wide-gamut labels does not perform a corresponding colour-space
   conversion.
8. `nearest` LUT interpolation is offered alongside final-quality modes without a
   preview-only restriction.
9. Adjustment masks use the container mask contract; effect-specific masks and
   multiple masks are not represented.
10. No licensed real-image LUT visual corpus or cross-renderer golden comparison
    currently proves live canvas, thumbnail, raster export, and PDF fallback parity.

## Canonical contracts

### Adjustment-layer targeting

The implemented contract is:

1. Hidden adjustment layers do nothing. Locked state prevents editing but does not
   change rendering.
2. Adjustment nodes are not adjustment targets and do not sample themselves.
3. `image-local` affects one eligible referenced node.
4. `explicit-targets` affects the valid, visible eligible IDs stored in the scope.
5. `container-descendant` affects eligible children of the named container and,
   when enabled, eligible nested descendants.
6. `document` affects every visible eligible visual node.
7. A legacy root adjustment without scope affects eligible root siblings below it.
   A legacy nested adjustment affects eligible lower siblings in its parent.
8. Missing/deleted targets produce an empty effect instead of escaping scope.
9. Container masks are applied during structural compositing; adjustment masks do
   not become targets or contribute to their own sampled backdrop.
10. Frame clipping remains a structural boundary. Adjustment scopes do not imply
    permission to escape a clipped or isolated container.

These are the semantics currently encoded by `adjustmentScope.ts` and the
structured Canvas2D renderer. Explicit targets are ID-based and therefore survive
reordering, save/reopen, duplicate remapping, and undo snapshots when the
surrounding document operation preserves references.

### Rendering order

There are two distinct typed stacks:

1. Visual-node content:
   backdrop effects → fills and strokes → content effects (`layerBlur`,
   `chromaticAberration`, `glitch`) → shadows/glows → glass edge highlight →
   complex post-render filters.
2. Adjustment node:
   resolve target surface → visible adjustments in array order → each adjustment's
   opacity/blend compositing → adjustment-node mask → parent structural
   compositing.

Within a local-effect pass, array order is stable. Across local-effect passes,
type category wins over array position. Until the model or UI is changed, this is
the canonical executable behavior and must not be described as globally
user-ordered.

### Colour and alpha

- Document raster interchange is currently 8-bit straight RGBA.
- LUTs transform RGB and preserve alpha exactly.
- LUT domain values remap input before interpolation. Output values may be
  extended, then clamp only when written to 8-bit output.
- `linearize=false` applies a display-oriented LUT to encoded channel values.
  `linearize=true` converts sRGB to linear light before lookup and converts back.
- `inputSpace` values other than sRGB/linear are metadata today, not full OCIO
  transforms. The UI must not imply otherwise.
- Blur and convolution code may use premultiplied alpha internally but restores
  straight alpha at its boundary.
- Canvas2D blend modes use browser encoded-sRGB behavior; they are not a
  colour-managed 16-bit compositor.

### Backend selection

| Operation | Interactive path | Deterministic fallback | Export |
|---|---|---|---|
| Simple point filters | Canvas2D `filter` where supported | Software `ImageData` | Same replay/software contract |
| Curves, levels, grade, LUT | Software `ImageData` | Same | Rasterized subtree |
| Small blur | Canvas2D/CSS blur | Software separable blur | Full-resolution replay |
| Large blur | Downsampled separable CPU preview | Separable CPU | Full-quality CPU path |
| Shadows/glows | Canvas2D/offscreen silhouette | Canvas2D offscreen | Raster fallback where target lacks native support |
| WebGPU primitives | Optional rect/circle/line acceleration | Canvas2D | Effects stay on Canvas2D/software path |

WebGPU is not a correctness dependency, especially on Linux WebKitGTK.

## LUT storage decision

Imported LUT values remain embedded in the adjustment record for offline and
cross-device fidelity. This milestone introduces a versioned envelope:

```text
{ schema: "strata-lut", version: 1, transform: ...numeric arrays... }
```

The decoder also accepts legacy raw transforms, reconstructs `Float64Array`
instances, validates exact lengths and finite values, and rejects unknown schema
versions. The next storage phase should place canonical payloads in the existing
document asset table and let adjustments reference a content fingerprint. That
will deduplicate repeated LUTs without introducing absolute paths. Linked storage
should remain opt-in and carry an embedded recovery copy or explicit missing-file
state.

Limits:

- source text: 32 MiB
- 3D grid: 2 through 65 per axis (about 6.3 MiB float64 payload at 65)
- 1D table: 2 through 65,536 entries (1.5 MiB across RGB)
- values: finite extended-range numbers
- domains: three finite values with `max > min` in every channel

## Export support matrix

| Feature | Live canvas | Raster | SVG | PDF | Code targets |
|---|---|---|---|---|---|
| Simple colour adjustments | Software/CSS | Native replay | Raster subtree | Raster subtree | Warning/fallback |
| Curves/levels/selective colour | Software | Native replay | Raster subtree | Raster subtree | Warning/fallback |
| LUT/gradient map/duotone/tritone | Software | Native replay | Raster subtree | Raster subtree | Warning/fallback |
| Halftone/dither | Software; reduced preview path where applicable | Full replay | Raster subtree | Raster subtree | Warning/fallback |
| Drop shadow | Canvas2D | Native replay | Raster subtree in structural compositor | Limited native approximation or raster | Native mapping only where equivalent |
| Blur/glow/inner shadow | Canvas2D/offscreen | Native replay | Raster subtree | Raster subtree | Warning/fallback |
| Clip/alpha/luminance mask | Structured Canvas2D | Native replay | Native SVG mask/clip where representable | Raster subtree | Target-specific warning/fallback |
| Chromatic aberration/glitch/glass | Canvas2D/offscreen | Native replay | Raster subtree | Raster subtree | Warning/fallback |

No exporter should silently omit an unsupported effect. Native code generators
must either report a target gap or consume a raster asset supplied by the export
compositor.

## Tests added

- Standard RGB-row 1D `.cube` channel mapping
- Inline comments and strict integer parsing
- Duplicate declarations and invalid domains
- Exact row counts and trailing-data rejection
- 65-cube memory ceiling and 32 MiB text ceiling
- Strict `.3dl` malformed-row handling
- Versioned 1D and 3D typed-array round trips
- Legacy numeric-key typed-array recovery
- Corrupt/incomplete/non-finite serialized payload rejection
- Stable content fingerprint and duplicate detection
- Renderer application of a versioned embedded inversion LUT with alpha preserved

## Verification and performance

- Focused engine suite: 82 tests passed across LUT parsing, interpolation,
  persistence, application, and filter compositing.
- `@strata/engine` TypeScript check: passed.
- Task-owned Biome check: passed.
- Emoji audit: passed.
- Design-token contrast audit: 120/120 pairs passed across light, dark, and
  high-contrast themes.
- Maximum supported 65-cube codec measurement on this development machine:
  6,591,000-byte float64 payload, 6,515,082-byte JSON envelope, 170.4 ms
  serialization, and 35.0 ms deserialization. This confirms bounded memory but
  also shows that maximum-size serialization should move off the interaction
  path in a later worker/asset-store phase.
- Repository-wide format, typecheck, lint, editor tests, and architecture audit
  are blocked by baseline branch defects outside this change: malformed JSX in
  `Menubar.tsx`, scene barrel exports for uncommitted `suppressions` and
  `fingerprint` modules, existing lint debt, a pre-existing
  `engine.ts → wasmLoader.ts` cycle, and an over-budget `Menubar.tsx`.

## Remaining risks and deferrals

- Existing document version migration does not rewrite old LUT JSON; recovery is
  lazy at render time. A future migration can rewrite on save.
- Fingerprints are deterministic 64-bit non-cryptographic identifiers for local
  deduplication, not security hashes.
- LUT parsing is intentionally strict. Vendor extensions beyond `.cube` and the
  limited `.3dl` subset need format-specific readers, not permissive token
  dropping.
- `.clf` and `.ctf` appear in the file picker but are not implemented by the LUT
  engine and must not be advertised as supported.
- High precision ends at an 8-bit Canvas2D `ImageData` boundary.
- Real hardware GPU, macOS, Windows, and Tauri WebKitGTK verification remain
  release-lab work; this milestone is deterministic TypeScript/Canvas2D work.
