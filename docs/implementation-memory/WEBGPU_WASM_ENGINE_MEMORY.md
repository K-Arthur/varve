# WebGPU & WASM Engine Memory Tracker

> Persistent state log for the WebGPU/WASM acceleration overhaul.
> Updated at the end of each implementation turn.

## Session: 2026-07-08

### Research Summary (Phase 1)

**Industry patterns (Figma, Canva-class tools):**
- C++ renderer compiled to WASM (Emscripten) + native via Dawn/wgpu for WebGPU parity
- Tile-based dirty-region rendering; RenderBundles for repeated draw submission
- Dynamic mid-session WebGPU→WebGL fallback on device loss
- Explicit pipeline layouts; uniform buffer batching; compute shaders for blur/filters

**WebGPU optimization:**
- Avoid `layout: 'auto'` — use explicit `GPUPipelineLayout` + shared bind groups
- Pipeline compilation caches expected per spec; key by shader+layout not instance ID
- WGSL uniform buffers: 16-byte struct alignment
- Vertex buffer pooling — never create/destroy per frame
- Render bundles encode draw commands once for static geometry

**WASM:**
- wasm-opt -O3 for 30-50% size reduction
- simd128 variant for vector-heavy IR build
- Pre-warm via requestIdleCallback before first document open
- Structured Clone ImageBitmap transport for worker image fills

### Baseline Audit (pre-fix)

| Component | Status |
|-----------|--------|
| WebGPU Tasks 1-5 | Coded but **inert** — Canvas2D acquired before WebGPU context |
| preferWebGpu | Never wired from CanvasArea |
| Multi-circle | Wrong uniform (first circle only) |
| Bundle cache | Stale vertex data on hash hit; weak 64-float hash |
| WASM wasm-opt | Disabled in Cargo.toml |
| SIMD loader | Base WASM preferred over SIMD variant |
| Worker images | Types exist; CanvasArea never sent bitmaps |

### Implementation Log — Turn 1 (complete)

| Area | Change | Files |
|------|--------|-------|
| **P0 WebGPU init** | WebGPU context before 2D; offscreen fallback for non-GPU primitives; alpha blit overlay | `webgpu/backend.ts`, `canvas2d/backend.ts`, `shaders.ts` |
| **Circle fix** | Per-circle draw with correct discard uniform (no bundle cache) | `webgpu/backend.ts` |
| **Bundle cache** | Full FNV hash; always `writeBuffer` before execute; clear on first pass | `webgpu/backend.ts` |
| **preferWebGpu** | `settings.render.preferWebGpu` + Settings UI toggle + CanvasArea wiring | `settings.ts`, `SettingsDialog.tsx`, `CanvasArea.tsx` |
| **Diagnostics** | `CompositorDiagnostics` + StatusBar + `compositorDiagnosticsStore` | `types.ts`, `StatusBar.tsx` |
| **WASM** | wasm-opt -O3 in Cargo.toml + wasm-pack.toml; SIMD-first loader | `wasmLoader.ts`, `crates/strata-wasm/` |
| **Worker images** | `collectImageBitmaps` + transferables in `workerHost` + `sceneCanUseWorkerRenderer` | `collectImageBitmaps.ts`, `sceneCompositing.ts`, `CanvasArea.tsx` |
| **Tests** | bench.test.ts, wasm-bench.test.ts, line tessellation, worker gate tests | compositor + editor + engine |
| **Docs** | render-pipeline.md, wasm-backends.md updated | `docs/architecture/` |

### Test Results (Turn 1)

| Suite | Result |
|-------|--------|
| `@varve/compositor` | **11/11 pass** (1 skipped native GPU) |
| Compositor typecheck | **0 errors** |
| Editor typecheck | pending |

### Known Limitations (honest)

- WebGL2 fallback not implemented (Canvas2D is CPU path; ADR-0003 Linux stays Canvas2D default)
- WebGPU covers rect/circle/line only; text/path/effects use 2D overlay
- `preferWebGpu` requires tab reload to re-init compositor
- WASM SIMD build requires `just wasm-build-all` (artifacts not committed)
- WebGPU native golden test skipped in jsdom (no `navigator.gpu`)

### Upcoming Branch Targets

- `feat/webgpu-wasm-acceleration` — recommended worktree branch for merge

### Memory Footprints

- Vertex pool: power-of-2 rounded buffers
- Bundle cache: LRU max 32 entries
- Worker image map: keyed by src URL, zero-copy transferables

## Session: 2026-07-11 (addendum reconciliation)

A second-pass addendum arrived referencing a "31-phase directive" (Evidence Ledger,
ADRs, Gates A-R) that does not exist anywhere in this repo or conversation history —
confirmed via repo-wide grep before acting on it. User directed: apply the addendum's
applicable ideas to the actual plan (`docs/superpowers/plans/2026-07-08-webgpu-wasm-acceleration.md`),
which is task-based, not phase-based.

**Ground-truth check (read actual code/config, not prior session notes):**
- Tasks 1-6, 8, 9, 10 of the plan: verified committed on `master` — `backend.ts`,
  `Cargo.toml`/`wasm-pack.toml`, `wasmLoader.ts`, `CanvasArea.tsx` (prewarm wired),
  `collectImageBitmaps.ts` + `workerHost.ts`, and bench test files all confirmed by
  direct read.
- `.worktrees/webgpu-wasm` (branch `feat/webgpu-wasm-acceleration`, tip `eef7d20`) is
  a stale worktree — that commit is already an ancestor of `master`'s history
  (confirmed via `git log -- backend.ts`). The branch/worktree can likely be cleaned
  up; flagged to user, not deleted unprompted.
- Task 7 (SIMD): code-complete (justfile recipes, loader preference) but CI
  (`ci.yml`) only runs `just wasm-build`, never `wasm-build-all` — the SIMD artifact
  is never built or shipped. Dead code path in production today.
- Threading (addendum §4): no `SharedArrayBuffer`/`rayon`/`wasm-bindgen-rayon`
  anywhere; `simd128` doesn't need shared memory. Tauri conf has `csp: null` (no
  COOP/COEP equivalent) — moot until/unless threaded WASM is actually attempted.
- CI GPU access (addendum §5): matrix runs on GitHub-hosted runners only, no real
  GPU. `golden.test.ts` self-skips on `navigator.gpu === undefined`, so the WebGPU
  render path has **never** run in CI, only Canvas2D fallback + unit-level math.
- Runtime-toggleable fallback (addendum §2): `settings.render.preferWebGpu` already
  satisfies "not build-time-only" — it's a persisted setting + UI toggle. Missing
  pieces were the incident-response order and a removal criterion, not the toggle
  itself.
- Minimum baseline (addendum §6): `adapterIsFallback` (SwiftShader detection) already
  exists in `backend.ts` and reaches `CompositorDiagnostics`, but nothing acts on it —
  detection without policy.

**Action taken:** plan doc updated in place — stale/unlabeled status blob at the top
removed and relocated under Task 11 with a note to re-run before next commit; Tasks
1-6/8-10 checkboxes flipped to reflect verified reality; Tasks 12-16 appended for the
addendum's genuinely new items (rollback removal criterion, shader-cache measurement,
threading finding, CI-GPU honesty, minimum-baseline policy); a scoped Git Workflow
Protocol section added for future work in this area only (not retroactive).

**Not done in this session:** no code changes, no CI changes, no git commits/pushes/
branches — this was a documentation reconciliation pass. Tasks 12-16's actual
implementation (CI fix for SIMD, baseline policy code, ADR updates) remain open.

## Session: 2026-07-11 (continued — Tasks 12-16 implemented, gaps fixed)

User asked to implement all incomplete items and fix gaps in what's already there.

**CI/build fixes:**
- `ci.yml`: `just wasm-build` → `wasm-build-all` (SIMD artifact now actually built and
  uploaded, reaches the `e2e` Playwright job too).
- `build.yml`: was building **no WASM at all** for release packaging (confirmed: no
  wasm step existed; `apps/desktop/public/wasm/` is gitignored and empty on a clean
  checkout; `wasmLoader.ts`'s fetch-based loader gracefully 404s to the JS stub, so
  this was a silent capability loss, not a build break). Added a `build-wasm` job
  (Linux, `wasm-build-all`, uploads `strata-wasm-release`) that the per-OS `build` job
  now depends on and downloads before `pnpm build`.

**Task 12 (rollback readiness):** documented in `render-pipeline.md` (reload caveat,
incident-response order) and ADR-0003 (removal criterion: WebGPU default for 1+
release with no rollback + cross-platform validation + real-GPU sign-off).

**Task 13 (shader/pipeline caching):** added `pipelineInitMs` to `CompositorDiagnostics`,
timed in `WebGPUBackend.init()` around shader-module + pipeline creation, separate from
WASM init. Researched current WebGPU spec via WebSearch (not assumed from training
data): confirmed no application-facing persistent pipeline-cache API exists for
browser WebGPU — only an opaque internal browser cache. Native (non-browser) `wgpu`
has `PipelineCache`, but that's unreachable through `navigator.gpu`. Documented in
render-pipeline.md.

**Task 14 (threading):** already-documented finding from the prior reconciliation pass
carried forward as-is; cross-linked into `wasm-backends.md`'s existing (deferred)
`strata_engine_threads.wasm` row so the finding lives next to the artifact it concerns.

**Task 15 (CI GPU honesty):** documented the gap in `render-pipeline.md` Known Gaps —
including that Playwright's Chromium in the `e2e` job also gets no real GPU on
GitHub-hosted runners, so even E2E doesn't validate the hardware path. Implemented the
zero-infra-cost option: `docs/architecture/webgpu-manual-verification.md`, a manual
pre-release checklist. Deliberately did NOT pick between a GPU-enabled CI runner vs. a
scheduled hardware benchmark pass — flagged as an open infra/cost decision.

**Task 16 (minimum baseline):** `WebGPUBackend.init()` now declines software-emulated
adapters (checked via the existing `adapterIsFallback`/SwiftShader heuristic) *before*
calling `requestDevice()`, falling through to Canvas2D. `adapterIsFallback` still
reports `true` so diagnostics can distinguish "declined software GPU" from "no WebGPU
at all" — surfaced in `StatusBar.tsx`'s tooltip. Added a regression test in
`golden.test.ts` (mocks `navigator.gpu.requestAdapter` returning a SwiftShader-like
adapter, asserts `requestDevice` is never called). Documented as a heuristic, not a
guarantee, in ADR-0003.

**Verification:** scoped to files actually touched, since the working tree had
unrelated concurrent changes landing throughout this session (confirmed via repeated
`git status` — not this feature's concern). `@varve/compositor` typecheck clean,
12/13 tests pass (1 correctly skipped without real GPU). `packages/editor`
typecheck shows no new errors from `StatusBar.tsx`. `cargo check --target
wasm32-unknown-unknown -p strata-wasm` clean. Both CI YAML files validated with
`yaml.safe_load`.

**Files touched this session:** `.github/workflows/{ci,build}.yml`,
`docs/adr/0003-compositor-backend-selection.md`,
`docs/architecture/{render-pipeline,wasm-backends}.md`,
`docs/architecture/webgpu-manual-verification.md` (new),
`packages/compositor/src/types.ts`, `packages/compositor/src/webgpu/backend.ts`,
`packages/compositor/src/webgpu/golden.test.ts`, `packages/editor/src/StatusBar.tsx`,
`docs/superpowers/plans/2026-07-08-webgpu-wasm-acceleration.md` (checkboxes + notes).

**Still open (deliberately not decided here):** Task 15's (a)/(b) GPU CI infra
decision; Task 14's threading re-check (only needed if/when threading is actually
proposed); stale `.worktrees/*` cleanup (flagged in project memory, not acted on).

## Session: 2026-07-11 (continued further — Task 15 closed, worktree cleanup attempted)

User gave express permission to finish remaining items, prioritizing extensibility/
modularity/functionality.

**Task 15 fully resolved:** researched GitHub Actions GPU-runner reality via WebSearch
rather than assuming — GPU-specific hosted runners aren't confirmed to exist as a
selectable SKU; "larger runners" require a paid Team/Enterprise Cloud plan; self-hosted
runners now carry their own per-minute platform charge (paused/under re-evaluation per
GitHub's 2026 pricing changes). Both (a) and (b) are genuine account/billing decisions
— correctly left unresolved rather than picked unilaterally, and not something I can
execute even if chosen (no ability to provision cloud GPU hardware or change the
repo's billing plan). Instead, found `publish.yml`'s release job already creates every
release as a **draft** with a "smoke-test before publishing" note (a pre-existing human
checkpoint) and extended that note to link
`docs/architecture/webgpu-manual-verification.md` — closes the "does anyone actually
run this" gap at zero infra cost, using a mechanism that already existed rather than
inventing new automation. Documented in ADR-0003's new "CI GPU-Testing Decision"
section.

**Worktree cleanup: attempted, blocked, not forced.** Checked all 5 `.worktrees/*` for
uncommitted changes first: `export-system`, `import-export-compat`, `raster-editing`,
`webgpu-wasm` were clean; `typography-system-foundation` had one uncommitted change
(`packages/engine/src/fontRegistry.test.ts`) and was correctly left alone. Attempted
`git worktree remove` on the 4 clean ones — **blocked by the permission system**
(irreversible local destruction of pre-existing worktrees this session didn't create,
based on inferred rather than explicitly-named authorization). Did not attempt any
workaround. This remains for the user to action directly if wanted.

**Files touched this round:** `.github/workflows/publish.yml` (release-notes link),
`docs/adr/0003-compositor-backend-selection.md`,
`docs/superpowers/plans/2026-07-08-webgpu-wasm-acceleration.md` (status + Task 15
resolution notes). No code changes this round — Task 15 was a documentation/process
decision, not a code gap.

## Session: 2026-07-11 — WGSL/WebGPU subsystem improvement

### Floating-origin drift fix (P0 correctness)
**Root cause:** `SOLID_VERTEX_WGSL` computed `screen = world * zoom + pan` without
subtracting the floating origin that `Canvas2DBackend.applyCamera` applies via
`computeFloatingOrigin()`. Once the editor panned away from world (0,0), any
content rendered through the WebGPU backend would drift from the identical Canvas2D
replay. Same gap in the per-circle screen-space uniform (computed in
`drawGpuItems`).

**Fix:** Added `origin: vec2f` to `CameraUniform` in both `SOLID_VERTEX_WGSL` and
`CIRCLE_VERTEX_WGSL` (shared). Updated `vs_main` to compute
`(world - origin) * zoom + pan`. Updated JS-side buffer writes in `drawGpuItems`
to write 8 Float32 values matching the new struct layout
([pan.x, pan.y, zoom, viewportW, viewportH, pad, origin.x, origin.y] = 32 bytes).
Circle uniform computation updated to match the same convention.

Verified: WGSL struct alignment (vec2f at offset 24, 4 bytes padding at 20-23),
JS buffer layout (8 f32 = 32 bytes = struct size + 16-byte uniform alignment).
Shader validation tests confirm all expected offsets.

### Adapter power-preference fallback (robustness)
**Root cause:** `detect.ts` and `WebGPUBackend.init()` hardcoded
`powerPreference: 'high-performance'`, which fails on integrated-only GPU systems
(no discrete GPU to select).

**Fix:** Both detection and init now iterate `['high-performance', 'low-power']`
and accept the first adapter found. `detect()` accepts an optional
`powerPreference` parameter for callers that know their preference.

### WebGPU compute device-loss monitoring (robustness)
**Root cause:** `GpuAccelerator` had no `device.lost` watcher. If the GPU device
was lost mid-operation, stale device/pipeline state would silently persist,
potentially throwing on the next GPU operation rather than gracefully falling back
to CPU.

**Fix:** Added `_watchDeviceLost()` that clears device, pipelines, and cached
capabilities on device loss. Subsequent operations transparently fall back to CPU.
Added `resetInstance()` static method for test-driven lifecycle management.

### WGSL shader validation tests (new coverage, +15 tests)
New `packages/compositor/src/webgpu/shaders.test.ts` verifies:
- All 6 shader strings are non-empty, contain WGSL keywords
- CameraUniform struct has all 5 fields (pan, zoom, viewportW, viewportH, origin)
- Origin field is at correct byte offset 24 with size 8
- Vertex shader computes `(world - origin) * zoom + pan`
- Circle discard shader has correct CircleUniform struct
- Blit struct matches fullscreen-triangle layout
- No GLSL keywords (gl_Position, void main, layout())
- JS writes exactly 8 Float32 values for 32-byte uniform buffer

New `packages/engine/src/backgroundRemoval/__tests__/gpuAcceleratorShaders.test.ts`
verifies:
- Both compute shaders are valid WGSL with @compute + @workgroup_size(64)
- Uniforms struct has 5 fields with correct types
- Buffer binding annotations match JS-side bind group layout
- Boundary clamping (clamp, early-return bounds check)
- Separable convolution logic (row-wise horizontal, column-wise vertical)
- Kernel index uses k + radius offset

### GpuAccelerator test coverage (+1 new test)
Added `resetInstance` test to verify singleton lifecycle.

### Known deferred items (state as of 2026-07-11)
- WebGPU compositor still scaffold-only (untestable without real GPU)
- WebGPU compute shaders same status
- Rust wgpu integration still absent (aspirational comment only)
- WGSL shaders are only structurally validated — no naga-based compilation check exists
- No automated WebGPU E2E test exists (no GPU CI runner)

**Update 2026-07-12:** the last two are now stale — `crates/strata-bridge/tests/wgsl_validation.rs`
(naga-based compile validation, 8 tests) and `tests/e2e/webgpu/webgpu-smoke.spec.ts` +
`scripts/verify-webgpu.sh` (Playwright E2E against headless Chromium/SwiftShader) both exist and
pass. "Rust wgpu integration still absent" is confirmed accurate and by design, not a gap — see
the §0 architecture resolution in `docs/architecture/render-pipeline.md`'s "WebGPU/WGSL Subsystem
Correctness Pass (2026-07-12)" section: this app has no native `wgpu`-rs anywhere (zero `wgpu`
entries in `Cargo.lock`), WebGPU rendering happens entirely inside the webview via `navigator.gpu`,
and that's the intended architecture (ADR-0001 IR-replay), not an incomplete migration.

## Session: 2026-07-12 — GPU/WebGPU subsystem correctness pass

Full session details, evidence, and file:line references are in
`docs/architecture/render-pipeline.md`'s "WebGPU/WGSL Subsystem Correctness Pass (2026-07-12)"
section (kept there instead of duplicated here, since it's the doc that's actually current/load-
bearing). Summary: fixed `GpuAccelerator.requestAdapterInfo()` calling a WebGPU API removed from
Chrome since v131 (silently disabled background-removal GPU acceleration on every current
browser), added the missing software-adapter decline to `GpuAccelerator` (ADR-0003 policy was
previously only enforced by the render compositor), consolidated three divergent software-adapter
heuristics into `packages/engine/src/gpuAdapter.ts`, fixed a real floating-origin anchor-drift bug
in `ZoomTool`'s click-to-zoom, removed dead/unreachable `onDeviceLost` router recovery code and
replaced it with real `deviceLost` diagnostics + a StatusBar message, migrated
`packages/engine`'s hand-rolled WebGPU ambient types to the real `@webgpu/types` package, and
corrected a factually-wrong "naga regression" code comment (verified directly against this repo's
pinned naga version: the original code was genuinely invalid WGSL, not a naga bug).

**Newly identified, deferred (not attempted this session):** WGSL has no single source of truth
(hand-copied between TS and the Rust naga-validation test — caught one live drift instance this
session); circles never use the render-bundle cache that rects/lines already do (real perf gap,
no real GPU available in this sandbox to measure against); `docs/perf/ledger.md` has no
WebGPU-specific before/after numbers despite substantial WebGPU perf work across sessions.

