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
| `@strata/compositor` | **11/11 pass** (1 skipped native GPU) |
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
`git status` — not this feature's concern). `@strata/compositor` typecheck clean,
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
