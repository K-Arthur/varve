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

- `cargo test -p varve-trace`: 75 passed, 0 failed (new: stacked covered-hole
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

Full chromium run (2026-09-14, watcher-free dev server, single worker):
**8 passed, 0 failed, 3.2m** — menu trace + single undo, pixel-art preset,
Edit Trace re-open/replace, honest disabled state, pixel-level preview
fidelity/theme independence, prep restore + provider reporting, cancel/resume,
review captures.

Notes on method and environment:

- A watcher-free dev server was used because concurrent agents editing tracked
  source files triggered Vite HMR full reloads mid-test (captured in
  `test-results/`: the editor reopened with the dialog closed). This is an
  environment property, not an application defect. The temporary config was
  removed after the run.
- The pixel check samples the preview canvas at 1:1 zoom: ring paint alpha
  > 200, donut-hole alpha 0, removed-background alpha 0, and identical RGB
  after `data-theme="dark"` + redraw.
- Review screenshots (`reports/trace-review/`) were inspected: Vector view
  shows cubic edges, a transparent hole, and anchor/handle overlay; the dark
  theme changes only the chrome.

### Visual evidence

Captures are generated by the product screenshot pipeline
(`pnpm screenshots:product -- --scenes vectorize --strict --review-dir
reports/trace-review`) and inspected before `--sync-reviewed` republishes the
website image. The capture waits for settled diagnostics and scrolls the
preview into frame; the reviewed PNG shows the colour-mode overlay preview of
the earth fixture with diagnostics (1000 paths / 57,200 points / 5,456 holes /
1 omitted) on the 1000×1000 source, and was then synced to
`docs/screenshots/product/` + `apps/website/public/screenshots/` with updated
alt text and caption.

## Remaining limitations (not silently claimed as solved)

- Shared-boundary (shared-chain) simplification is not implemented; `stacked`
  output reduces but does not prove the absence of hairline seams at high
  simplification tolerances.
- Visible-appearance capture (crop/mask/adjustment/effect compositing) is not
  implemented; the dialog states the source-only scope when overrides exist.
- Centerline remains native-only; the web dialog disables it with a reason.
- Before `779452dd7`, the desktop adapter could silently downgrade grayscale
  to monochrome and pixel-art to a silhouette because the editor `mode` was not
  translated to the Rust `traceMode`/`maxColors` wire fields. The scoped
  regression test now asserts the exact grayscale and pixel-art payloads.
- A source identity hash currently fingerprints the source reference string;
  it detects a changed data URL or source reference but cannot prove that the
  bytes behind an unchanged external URI are unchanged. Same-URI replacement
  remains a documented limitation until asset revision/content hashing is
  available from the shared asset pipeline.
