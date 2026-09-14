# Image Trace — preview fidelity, preparation, and provenance (2026-09-14)

Scope: the Image Trace feature (`docs/architecture/image-trace-system.md`,
ADR-0170). Root causes were reproduced against the 2026-09-13 `master` state;
fixes are verified by unit, native, and browser checks. Research and external
failure-mode evidence: `docs/agents/trace-research-2026-09-13.md`.

## Verified root causes (before this change)

1. **Preview ignored the canvas specification.**
   `drawPreview` set `ctx.scale()` and `ctx.globalAlpha` before
   `ctx.putImageData`. Per the HTML canvas specification, pixel-manipulation
   methods are unaffected by the transformation matrix and `globalAlpha`, so
   the prepared source was drawn unscaled and fully opaque. Evidence: code
   read at `packages/editor/src/logo/vectorization/preview.ts` (2026-09-13).
2. **Preview geometry diverged from committed geometry.**
   Every path was drawn with `moveTo`/`lineTo`, ignoring `handleIn`/
   `handleOut`; insertion fits cubics (`imageOperations.ts`). The preview also
   closed only the last hole subpath (one `closePath()` after appending all
   holes), and painted centerline strokes with the theme text color while the
   committed stroke is black.
3. **Silent color loss.** Color/grayscale modes dropped any near-white palette
   bucket above 40% of pixels (Rust `lib.rs`, TS `rasterTrace.ts`) with no
   control; white artwork and large enclosed white areas could disappear.
4. **Provenance was not reproducible.** `TraceMetadata` stored options but
   `settingsFromTraceMetadata` reset `prep` to defaults, and `traceEngineLabel`
   guessed the engine from the environment instead of recording the provider
   that produced the result.
5. **Centerline loops could not stay loops.** The branch walker stopped at the
   first pixel with two unvisited neighbours (any corner of a 1px ring), and
   insertion decided fill vs stroke from `closed`; a closed loop would have
   become a filled blob.
6. **Path truncation used a non-area metric.** Rust
   `sort_paths_by_area_desc` summed `x*y` instead of the shoelace area, so
   `maxPaths` truncation could keep the wrong paths.

## Implemented changes

| Area | Change | Files |
|---|---|---|
| Preview compositing | Raster drawn through an offscreen canvas with `drawImage`; theme-independent artwork; checkerboard host shows transparency | `logo/vectorization/preview.ts` |
| Preview geometry | `buildDisplayPaths` fits provider polylines exactly like insertion, keeps provider handles, marks stroked paths; cubic-aware renderer with per-hole `closePath` | `logo/vectorization/previewPaths.ts`, tests |
| Preview UX | Source / Prepared / Overlay / Vector views, anchor overlay, 1:1 zoom; provider and effective-resolution diagnostics; honest downsample note | `components/Vectorize/VectorizeWorkflow.tsx`, `vectorize.css` |
| Source prep | Border-connected near-white removal (enclosed whites survive), adaptive Bradley–Roth threshold, fixed binarize uses the trace threshold, alpha cutoff exposed | `logo/vectorization/prepareSource.ts`, `settings.ts` |
| Structure | `stacked` output (back-to-front; transparency-aware holes) in TS and Rust; `cutout` compound holes retained; both recorded | `packages/engine/src/rasterTrace.ts`, `crates/varve-trace/src/{lib,contours,pixel_art}.rs` |
| Provenance v2 | Prep stack, provider id, effective trace/source dimensions, source identity hash; v1 still loads; source-changed warning | `packages/scene/src/types.ts`, `logo/vectorization/metadata.ts` |
| Provider reporting | `dispatchTrace` attaches the winning `providerId` | `upscaleProviders/traceDispatch.ts` |
| Centerline loops | Direction-preference walk for endpoint-free skeletons; loops emitted `closed: true` and kept stroked | `crates/varve-trace/src/centerline.rs`, `imageOperations.ts` |
| Truncation | Shoelace-area sort in native color and pixel-art output | `crates/varve-trace/src/lib.rs`, `pixel_art.rs` |

## Validation

### Automated tests (run 2026-09-14)

- `cargo test -p varve-trace`: 74 passed, 0 failed (new: stacked covered-hole
  dropping, transparency hole keeping, dominant-white retention, closed-ring
  and two-ring skeleton loops).
- `cargo clippy -p varve-trace --all-targets -- -D warnings`: clean.
- `cargo check` + `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml trace`:
  5 trace tests passed (sanitizer now accepts/validates `structure`).
- `vitest` (affected): `rasterTrace.test.ts` (14), `previewPaths.test.ts` (9),
  `prepareSource.test.ts` (8), `vectorization.test.ts` (22),
  `imageOperations.holes.test.ts` (9), trace dispatch/provider suites (68
  total across `packages/engine/src/upscaleProviders`).
- `pnpm --filter @varve/engine|@varve/scene|@varve/editor typecheck`: no
  errors in changed files (remaining errors belong to other agents' in-flight
  work; listed in the session report).

### Browser E2E (`tests/e2e/canvas/image-trace.spec.ts`)

New coverage added; results recorded in the session report (the machine was
under concurrent-agent load during this session, so runs are repeated until a
representative pass is obtained):

- Pixel-level preview check: ring paint opaque, donut hole alpha 0, removed
  background alpha 0, colors unchanged after switching `data-theme` to dark.
- Edit Trace: provider cell reports the real `*-trace` provider and the
  preparation stack (binary threshold) is restored.
- Cancel: preview returns to idle and restarts on the next settings change.
- Review screenshots written to `reports/trace-review/` (overlay-light,
  vector+anchors-light, vector-dark) and inspected before publishing.

### Visual evidence

Captures are generated by the product screenshot pipeline
(`pnpm screenshots:product -- --scenes vectorize --strict --review-dir
reports/trace-review`) and inspected before `--sync-reviewed` republishes the
website image. The pre-fix pipeline could capture an unscaled, opaque raster
that hid the vector result; the new capture is taken after
`.vectorize__diagnostics` renders, so it shows the settled preview.

## Remaining limitations (not silently claimed as solved)

- Shared-boundary (shared-chain) simplification is not implemented; `stacked`
  output reduces but does not prove the absence of hairline seams at high
  simplification tolerances.
- Visible-appearance capture (crop/mask/adjustment/effect compositing) is not
  implemented; the dialog states the source-only scope when overrides exist.
- Centerline remains native-only; the web dialog disables it with a reason.
