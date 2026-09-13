# Illustration and Concept-Art Workflow Improvement — 2026-09-13

**Status:** Slice 1 implemented; broader workflow work remains explicitly
bounded below
**Scope:** Existing editor tools, brush state, smudge sampling, validation,
current-state documentation, and the existing website stroke surfaces
**Product boundary:** No new workspace, editor route, project type, document
format, or parallel paint system was introduced.

## Outcome

The first vertical slice repairs an integration gap rather than adding a
cosmetic control. The scene smudge engine already had three meaningful modes
and a read-only sample-all-layers path, but the existing Brush inspector only
exposed strength. The new controls are in the existing Smudge tool options:

- **Mode:** Pure smudge, Loaded paint, or Fingerpaint. The mode controls what
  the reservoir does; it is intentionally separate from the source-layer
  choice.
- **Sample merged layers:** an explicit opt-in source choice. It samples a
  read-only visible raster-layer snapshot in scene paint order and still
  deposits only on the active raster target.
- **Strength:** remains the single artist-facing smudge transport control.

The mode and source choice now flow through `EditorState.brushSettings`, the
existing `useToolManagerSync` path, and `SmudgeTool.updatePresetFromSettings`.
The setting is not serialized into the document because it is transient tool
state, consistent with the existing brush settings contract.

## Research register

Research was performed before planning and again while selecting the smudge
surface. Access date for every source below is **2026-09-13**. Standards and
official manuals are treated as normative or product documentation; issue
threads are treated as anecdotal complaint evidence, not as specifications.

| Source URL | Applicable version/date | Finding | Uncertainty | Decision supported |
|---|---|---|---|---|
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) | Recommendation, 2026-06-30 | Pointer events expose coalesced and predicted samples; predicted points are speculative and should be discarded when actual points arrive. `pointerrawupdate` is an opt-in trade-off, not a free latency fix. | Browser/WebView support still varies by engine and device. | Keep confirmed paint authoritative, keep predictions disposable, and do not introduce a second raw-event stream casually. |
| [W3C Compositing and Blending Level 1](https://www.w3.org/TR/compositing-1/) | W3C compositing specification | Source-over and Porter–Duff formulas operate on premultiplied colour terms; isolated groups composite against transparent black. | Varve's current colour-depth and renderer paths are narrower than every possible spec feature. | Preserve the existing compositor contract; do not solve smudge sampling by an unbounded canvas readback or an undocumented blend shortcut. |
| [Krita brush engines](https://docs.krita.org/en/reference_manual/brushes.html) | Krita manual 5.3.0 | Brush feel is a combination of tip, spacing, dynamics, opacity/flow, and engine-specific behaviour; labels alone do not make a usable brush. | Krita's engine and UI are not Varve's contract. | Repair and expose existing Varve engine semantics before adding another brush implementation. |
| [Krita Color Smudge Engine](https://docs.krita.org/en/reference_manual/brushes/brush_engines/color_smudge_engine.html) | Krita manual 5.3.0 | Smudge length, colour rate, and sampling scope are distinct concerns. The manual warns that sampled lower-layer pixels can complicate later edits. | The exact reservoir model differs from Varve's implementation. | Make sampling scope explicit, keep it read-only, and separate source sampling from the deposit target. |
| [Krita Fill Tool](https://docs.krita.org/en/reference_manual/tools/fill.html) | Krita manual 5.3.0 | Reference scope, grow, feather, and gap handling are separate controls in a production fill workflow. | This slice does not change Varve fill behaviour. | Record fill/gap closure as a later vertical slice rather than pretending smudge UI solves flats. |
| [Krita Reference Images Tool](https://docs.krita.org/en/reference_manual/tools/reference_images_tool.html) | Krita manual 5.3.0 | Reference images have explicit placement, opacity, transform, and embedded/linked storage decisions. | Varve's reference implementation must be audited separately. | Do not make a visible image automatically become a paint source or export content. |
| [Tauri Webview versions](https://tauri.app/reference/webview-versions/) | Page updated 2026-05-17 | Tauri uses the system WebKit implementation on Linux; distro versions vary. | This page does not guarantee a specific WebKitGTK behaviour on every distro. | Keep browser and Linux desktop claims separate; validate actual WebKitGTK when input/render changes land. |
| [Wry WebViewBuilder](https://docs.rs/wry/latest/wry/struct.WebViewBuilder.html) | wry 0.57.0 docs | Linux WebView setup depends on GTK/X11/Wayland choices; the desktop path is not Chromium by default. | Packaging and compositor differences remain environment-specific. | Avoid treating Chromium-only Playwright results as Linux desktop proof. |
| [ONNX Runtime execution providers](https://onnxruntime.ai/docs/execution-providers/) | Current official documentation | Provider order and supported operators determine real inference dispatch; a hardware name alone does not prove acceleration. | Provider availability changes with runtime/build/platform. | Keep optional model work behind truthful readiness and provider checks; it is not required for manual painting. |
| [ONNX Runtime Web large models](https://onnxruntime.ai/docs/tutorials/web/large-models.html) | Current official documentation | Large browser models require deliberate memory and loading treatment. | Exact Varve browser limits depend on WebView and device. | Do not add a large model to the illustration path until memory, cancellation, and quality gates exist. |
| [Real-ESRGAN upstream](https://github.com/xinntao/Real-ESRGAN) | Upstream repository, accessed 2026-09-13 | The upstream list distinguishes general and anime-oriented checkpoints; the repository does not make every checkpoint suitable for line art or transparent illustration edges. | Model quality and license must be checked per artifact and conversion. | Revalidate the documented enhancement path before selecting a new checkpoint; no model was added in this slice. |
| [Adobe community: brush delay](https://community.adobe.com/questions-712/brush-delay-in-photoshop-3-years-old-bug-still-not-fixed-1164492) | User report, version/context not stable | Artists report pen-down delay and missing first marks. | Anecdotal, version and hardware dependent. | Treat first-sample latency and final-segment preservation as measurable regressions, not subjective polish. |
| [Adobe community: pen tablet drawing delay](https://community.adobe.com/questions-712/issues-with-pen-tablet-drawing-delay-1178863) | User report, 2025 thread | Users report that small details become impractical when the brush catches up late. | No controlled reproduction in Varve or a shared hardware profile. | Require real pointer-path E2E evidence for input fixes; synthetic unit tests alone are insufficient. |
| [Tauri issue 5761](https://github.com/tauri-apps/tauri/issues/5761) | Upstream issue, Linux canvas report | A user reported Canvas performance lower in Tauri than in a browser. | Old issue and environment-specific; not proof of current Varve performance. | Keep render-worker fallbacks and actual desktop measurements separate from browser results. |
| [MyPaint issue 296](https://github.com/mypaint/mypaint/issues/296) | User request, issue history | Gap closure is requested because bucket fills leaking through small line-art gaps are a recurring workflow failure. | This is a request rather than a resolved algorithm specification. | Plan bounded gap closure/preview for the flats slice; do not add an untested “magic fill” claim here. |

## Baseline diagnosis

The following are code-trace findings, not claims that a live desktop session
was already visually verified:

| Artist task | Current friction/reproduction | Root cause | Existing subsystem | Slice/follow-up | Validation |
|---|---|---|---|---|---|
| Smudge a painted layer without baking lower paint into it | `SmudgeTool` had `mode` and `sampleAllLayers`, but `BrushSection` only rendered strength. | Engine capability was unreachable from the existing UI; state had no source-scope field. | `SmudgeTool`, `useToolManagerSync`, `BrushSection`, `EditorState.brushSettings` | Implemented in this slice. | Smudge tool unit round-trip, BrushSection test, running UI E2E and inspected screenshots. |
| Know whether a smudge stroke samples current or merged content | The tool defaulted to current-layer sampling, but there was no visible status/control. | Hidden boolean created ambiguous source semantics. | `SmudgeTool.flattenVisibleStack` | Implemented as an explicit toggle with accessible state and truthful copy. | `aria-pressed` assertion plus canvas stroke E2E. |
| Smudge vector, groups, effects, and transformed content as if it were a final composite | Current helper collects visible raster-layer tile maps in active scene-tree order only. | It is a tile sampling helper, not a renderer readback. | `flattenTilesForSampling` and `SmudgeTool` | Deferred; documented as a limitation. | No claim of support; future work requires renderer-backed source contract and revision checks. |
| Paint line-art flats without leaks | Gap closure/threshold controls need a separate end-to-end audit. | Existing fill semantics are broader than this slice. | Fill/selection systems | Deferred to a bounded flats slice. | Use line-art fixtures, source preservation, cancellation, and export checks. |
| Maintain line quality under pen input | Current repository contains input work from other agents; this slice does not take ownership of those shared files. | Pointer event fidelity and WebKitGTK behaviour need separate validation. | Input pipeline and tool dispatch | Coordinate through the drawing-input ownership record. | Real DOM PointerEvent E2E plus desktop validation where available. |
| Improve concept-art reference/paintover iteration | Reference persistence, masking, transform, provenance, and export inclusion are a separate surface. | A visible image is not automatically a sampling or export layer. | Existing asset/image/reference systems | Deferred; no parallel concept-art project model. | Import, lock, transform, save/reopen, export, and pixel-difference checks. |

## Implementation record

Changed in the first slice:

- `packages/editor/src/context/types.ts` — adds transient
  `smudgeSampleAllLayers` state.
- `packages/editor/src/context.tsx` — initializes the state to the safe
  current-layer default.
- `packages/editor/src/tools/SmudgeTool.ts` — accepts and returns mode/source
  settings through the existing tool synchronisation contract.
- `packages/editor/src/components/Inspector/sections/BrushSection.tsx` — adds
  accessible mode and explicit merged-sampling controls to the existing
  Smudge inspector.
- `packages/editor/src/tools/__tests__/SmudgeTool.test.ts` and
  `packages/editor/src/components/Inspector/sections/BrushSection.test.tsx` —
  cover state round-tripping and discoverability.
- `tests/e2e/paint/brush-ui.spec.ts` — drives paint, smudge mode selection,
  merged sampling, and a real canvas stroke; screenshots are reviewed as test
  artifacts and are not treated as proof merely because they were generated.
- `docs/architecture/paint-system.md` — records the UI contract and current
  raster-only sampling boundary.
- `apps/website/src/pages/features/strokes.astro` and
  `apps/website/src/pages/docs/tools/strokes.astro` — explain that vector
  strokes and raster marks share the existing editor and keep the sampling
  limits truthful.

No workspace registry, route, scene schema, project type, or alternate paint
surface was added.

## Artist workflow status

The existing editor remains the workflow surface for the three requested
reference projects. This slice specifically improves the raster paintover
step in workflows A and C:

- **Raster illustration:** brush and smudge controls are now discoverable in
  the same tool options; current-layer sampling is the safe default and merged
  raster sampling is explicit. Full flats, clipping, adjustment, save/reopen,
  and transparent-export evidence belongs to the next workflow slice.
- **Hybrid illustration:** vector and raster tools remain in the same scene;
  smudge source scope is now explicit. Full vector contour and hybrid-export
  coverage remains to be measured.
- **Concept art:** the existing paintover path remains available; this slice
  avoids claiming reference-aware sampling or project organization that has
  not been verified.

The remaining work is intentionally staged: target/input integrity and save/
export first, then brush/flats/masks, then references and construction aids,
then optional model paths. This prevents an attractive control surface from
masking a data-integrity or export defect.

## Validation record

The repository-wide working tree already contains unrelated concurrent
changes, so the planner selects a broad closure. The focused evidence for this
slice is:

| Check | Command | Result |
|---|---|---|
| Focused unit/component tests | `pnpm exec vitest run packages/editor/src/tools/__tests__/SmudgeTool.test.ts packages/editor/src/components/Inspector/sections/BrushSection.test.tsx --reporter=verbose` | Pass: 19 tests in 2 files. |
| Scene-order regression | Included in `packages/editor/src/tools/__tests__/SmudgeTool.test.ts` | Pass: merged sources follow active scene-tree order and hidden ancestors are skipped. |
| Changed Smudge unit suite after scene-order hardening | `test_tmp=$(mktemp -d /var/tmp/varve-smudge-unit.XXXXXX); TMPDIR="$test_tmp" pnpm exec vitest run --maxWorkers=1 packages/editor/src/tools/__tests__/SmudgeTool.test.ts --reporter=verbose` | Pass: 16 tests. Temporary directory was removed by the command. |
| Focused format/lint and whitespace | `pnpm exec biome check packages/editor/src/context/types.ts packages/editor/src/context.tsx packages/editor/src/tools/SmudgeTool.ts packages/editor/src/components/Inspector/sections/BrushSection.tsx packages/editor/src/tools/__tests__/SmudgeTool.test.ts packages/editor/src/components/Inspector/sections/BrushSection.test.tsx tests/e2e/paint/brush-ui.spec.ts` plus `git diff --check` | Pass. |
| Documentation drift | `pnpm audit:docs` | Pass: 773 docs, 380 links, 174 ADRs indexed. |
| Emoji gate | `pnpm audit:emoji` | Pass: 4,417 files scanned. |
| Token contrast gate | `pnpm audit:tokens` | Pass: 153 pairs across light, dark, and high-contrast themes. |
| Real browser workflow | `test_tmp=$(mktemp -d /var/tmp/varve-smudge-e2e.XXXXXX); TMPDIR="$test_tmp" VARVE_E2E_PORT=1496 VARVE_E2E_WORKERS=1 VARVE_DISABLE_HMR=1 pnpm exec playwright test tests/e2e/paint/brush-ui.spec.ts --project=chromium --grep "smudge mode and sampling controls" --reporter=list` | Pass: 1 test. The run used its own port and output directory. |
| Browser artifacts | `test-results/run-2296405-1496/paint-brush-ui-paint-UI-in-a306a--drive-a-real-canvas-stroke-chromium/` | Inspected `smudge-source-stroke.png`, `smudge-controls.png`, and `smudge-merged-stroke.png`. The source stroke is visible, the mode/source state is readable, and the resulting smudge stroke changes the artwork. |

The full `brush-ui.spec.ts` file was also attempted on the isolated port. An
existing large-library scroll test timed out after 2.5 minutes under the
shared validation load before the new test ran; that run was stopped and the
new scenario was rerun by title. This is recorded as a validation limitation,
not converted into a passing result.

The editor package typecheck was run with
`TMPDIR="$PWD/.tmp-codex" pnpm --filter @varve/editor typecheck`. It failed on
unrelated concurrent changes in `inputPipeline.ts`, `NodeEditControls.tsx`,
`NodeEditTool.ts`, `SelectTool.test.ts`, and `snapping.ts`; no diagnostic named
the smudge slice. The affected planner selected a broad closure because the
working tree includes workspace/toolchain/validation changes from other
agents; the full affected/full gate was not claimed for this slice.

## Remaining limits and platform gaps

- No real stylus, tilt, barrel-button, Linux WebKitGTK, Wayland, or mixed-DPI
  hardware validation is claimed by this slice.
- The smudge merged snapshot does not include vectors, group isolation,
  effects, or transformed non-raster content.
- No new ML checkpoint was introduced. Existing model paths still require
  artifact, license, provider, memory, latency, and art-quality evidence
  before any marketing claim is expanded.
- Gap closure, robust line-art flats, reference provenance/locking, perspective
  assistants, vector tracing quality, color-management limits, and broad
  save/reopen/export workflow evidence remain follow-up slices.
