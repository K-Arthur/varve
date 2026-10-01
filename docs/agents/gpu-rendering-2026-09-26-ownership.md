# GPU implementation, rendering, and acceleration — ownership record (2026-09-26)

**Started:** 2026-09-26
**Base:** `master` at `f263e1ee2` (108 commits ahead of `origin/master`)
**Coordinator:** GPU rendering/acceleration continuation task (single writer for
its scope)

## Scope and boundaries

Continuation of `gpu-rendering-2026-09-24-ownership.md` (which remains the
record for the 2026-09-24 correctness repairs). This session owns:

- WebGPU compositor correctness/quality (oval edge parity, ordered-run
  behavior), its tests under `tests/e2e/webgpu/` and
  `packages/compositor/src/webgpu/`
- Lifecycle/resume/DPR full-redraw invalidation for the render surface
- GPU compute effect-chain consumer work (per `gpu-acceleration.md` §5/§9)
- Rendering/acceleration docs: `docs/architecture/gpu-acceleration.md`,
  `render-pipeline.md`, `webgpu-manual-verification.md`, this record, and the
  2026-09-26 audit record
- Marketing website rendering/acceleration copy under `apps/website/src/`
  where it describes GPU scope

Expected edited paths are recorded here before editing. Anything else is
recorded before editing.

Recorded additions (2026-09-26):

- `playwright.config.ts` — first extended the `chromium-gpu` `testMatch`
  for a standalone timing spec, then **reverted before commit**: the timing
  test now lives inside `gpu-agreement.spec.ts` (already matched by that
  project), because any `playwright.config.ts` change forces a full-suite
  validation escalation (`validation-impact.config.mjs` always-escalate
  list). No config change ships.
- `tests/e2e/webgpu/circle-transform-parity.spec.ts` — rect/fractional-zoom
  fixtures and per-case metric logging for the edge-antialiasing milestone.
- `packages/compositor/src/webgpu/effects/harness.ts` — timing samples
  (`HarnessTiming`) behind an opt-in `timing` option.
- `crates/varve-bridge/tests/wgsl_validation.rs` — naga mirrors regenerated
  from `shaders.ts` (byte-identical, drift-guard enforced).
- `packages/editor/src/tools/selectionCoverage.test.ts` — stale-assertion
  triage repair, committed separately as `f554ca0f4`.

## Existing work to preserve (starting tree, 2026-09-26)

`master` has ~145 uncommitted changes belonging to at least three other tasks:

- **Token-sync task** — staged edits under `packages/tokens/`,
  `packages/scene/src/tokens/`, `packages/editor/src/tokenSync/`,
  `TokenSync/`, plus staged `tests/e2e/canvas/mockup-mesh.spec.ts`.
- **Canvas-fluidity task** (record:
  `canvas-fluidity-2026-09-25-ownership.md`) — unstaged edits to
  `docs/architecture/render-pipeline.md`, `docs/architecture/canvas2d-system.md`,
  input pipeline, dirty-region/invalidation files, and untracked
  `docs/audits/canvas-fluidity-2026-09-25.md`.
- **Mockup/other tasks** — `docs/screenshots/`, `tests/e2e/canvas/`,
  website design-tokens page, `Cargo.lock`.

Untracked GPU-adjacent artifacts already present at start (not created by
this session): `docs/screenshots/gpu-acceleration/hardware-parity/*.png`
(16 files, no generating spec found), an untracked
`tests/e2e/visual/replay.spec.ts-snapshots/content-aware-strokes-gpu-chromium-visual-gpu-linux.png`,
and an unstaged improvement to `tests/e2e/webgpu/app-gpu-capture.spec.ts`.
None belongs to this session; preserve them untouched.

No branch switch, stash, reset, clean, broad `git add`, or full-index commit
is authorized. Commits use `git commit -- <owned paths>` so other tasks'
staged index entries remain staged. Playwright/GPU runs go through
`scripts/quality/heavy-lease.mjs` with isolated ports and artifact dirs.

## Session log

### 2026-09-26 — reconnaissance and research

- Starting state recorded above; two background tracks completed: fresh
  platform/failure research (WebKitGTK 2.54 notes carry no WebGPU; Safari
  26.3 device-loss under interleaved write/submit — WebKit PR #71563;
  `alphaMode` also affects `drawImage`; per-frame canvas resize destroys the
  drawing buffer — gpuweb #4388; pipeline-compile hitches; Krita 490641,
  Penpot/tldraw DPR, Affinity RTX-50, Adobe GPU color firsthand reports) and
  a code audit reconciling `gpu-acceleration.md` with runtime. Audit results:
  the §9.2 "resume" gap is real, its "DPR" half was already implemented
  (doc stale); the oval shader discards with no AA and solid rects alias at
  fractional zoom; the effect chain still has zero production callers and its
  only sensible consumer (export filters) sits inside the synchronous
  1,100-line `replayStructuredSceneInner` closure tree (4 filter sites, 5
  external callers, one sync `renderSubtree` callback contract).

### 2026-09-26 — milestone 1: system-resume authoritative redraw

- Added `subscribeToSystemResume` (pageshow-persisted, Page Lifecycle
  `resume`, visible-page timer-gap heartbeat; hidden gaps parked until
  visible) to `packages/editor/src/canvas/canvasSurface.ts`, wired in
  `CanvasArea.tsx` (no new import declaration) to drop `paintedSurfaceRef`
  and request `system-resume`/`backing-store-recovery`. 6 new unit tests.
- Docs: `gpu-acceleration.md` §7 row 5 gap closed, §9.2 marked done with the
  stale-DPR correction.
- Triage repair (separate commit `f554ca0f4`): `e6ca12e68` (retouch task)
  changed singular transforms to return a fail-closed empty mask but left
  `toBeNull()` in `selectionCoverage.test.ts`, red on master; assertion now
  matches the documented semantics.
- Validation: `pnpm verify:plan --staged` (editor closure, no full-suite
  escalation). `pnpm verify:affected --staged`: format/lint, audit:emoji,
  audit:docs, typecheck:e2e, js-unit file (17/17) all pass;
  `js-unit:@varve/editor` 819/820 with the single failure being that stale
  assertion (repaired, exact file then passes 4/4); `js-unit:@varve/desktop`
  80/80 and `typecheck:@varve/desktop` pass. Two lanes blocked by other
  tasks' live in-flight work, not this task: `typecheck:@varve/editor` shows
  one error in `tokenSync/importWorkflow.test.ts` (token-sync task), and the
  broad editor lane ran concurrently with it. `e2e:canvas` and `bench:render`
  (Tier 4) deferred to the combined heavy validation after milestone 2 so
  the shared machine runs them once.

### 2026-09-26 — milestone 2: analytic edge antialiasing + presentation probe

- Both WGSL fragment stages now derive ~1 device-pixel analytic coverage via
  `fwidth` (the oval's hard `discard` is gone); vertex stages expand their
  quad ~1 px so the outside band has geometry; solid geometry folds into a
  unit quad on the CPU (`composeItemAffine`, no layout/upload change).
- `defaultPresentationProbe` validates the offscreen → present `drawImage`
  path at init and on device recovery with a known premultiplied color;
  failure declines WebGPU with a named `initFailureReason` before any frame
  draws. Scene pipelines moved to `createRenderPipelineAsync`.
- naga mirrors regenerated (byte-identical); `cargo test -p varve-bridge
  wgsl` 9/9; compositor 95/95; typechecks + biome clean.
- Evidence (heavy lease, isolated port 1467, automatic baseline-file swap
  with trap + diff verification):
  - Baseline (pre-antialias) vs after on 9 parity fixtures: mean channel
    diff improved 2.7-65x per fixture (uniform circle 5.81 -> 0.09; rotated
    rect 3.84 -> 0.40; fractional-zoom rect 2.74 -> 0.01); coverage ratios
    went 0.958-1.000 -> 0.999-1.011 vs Canvas2D. Thresholds tightened
    (mean < 4, coverage within 3%) - the baseline would now fail 3 fixtures.
  - Before/after frames and 6x edge crops inspected side by side and
    retained under `docs/screenshots/gpu-acceleration/edge-aa/`.
  - All `tests/e2e/webgpu/` specs pass on the real AMD adapter (8/8 warm);
    the first-run `app-gpu-capture` failure was the cold-start startup
    watchdog (bundle loaded, never rendered) and passed on warm re-run
    (40.7 s). The parity suite not skipping proves the presentation probe
    succeeds on hardware; its fail-closed path is unit-tested.
  - Regenerated UI captures (`app-canvas-*`, `app-settings-performance`)
    inspected: probe reads "Device created", rendering reads
    "Canvas2D - GPU ready".

### 2026-09-26 — milestone 3: effect-chain measurement (the section 5 gate)

- Added opt-in timing to `effects/harness.ts` (cold first-use + per-iteration
  samples, alternating CPU/GPU order, sequential-only when timing) and the
  report-only timing test merged into `tests/e2e/effects/gpu-agreement.spec.ts`
  (already matched by the `chromium-gpu` project — no config change).
- Result on this host's real AMD adapter: GPU 3-64x faster than CPU across
  all nine kernels at 512/1024/2048 square (crt at 1024 square: 1014 ->
  15.9 ms), cold pipeline compile 6-106 ms. Raw:
  `reports/gpu-effects-timing.json`; table: `docs/perf/ledger.md`.
- Decision recorded in `gpu-acceleration.md` section 5: wiring the async
  chain into export is justified by measurement; execution is a dedicated
  milestone because all four filter call sites sit in the synchronous
  `replayStructuredSceneInner` tree whose `mockupExport.renderSubtree`
  callback contract would silently swallow an unawaited promise. Not landed
  this session; exact shape documented.

### 2026-09-26 — docs and website

- `gpu-acceleration.md`: section 2.6 presentation probe, six new section 7
  research rows, section 3 matrix updated with hardware evidence, section 5
  rewritten as a measured decision, section 9 remaining work rewritten
  (items 2 and 3 done, 1 and 5 restated, new macOS-soak item 6).
- `webgpu-manual-verification.md`: checklist items for system resume, the
  probe reason, and fractional-zoom/rotation edge quality.
- `docs/perf/ledger.md`: edge-parity before/after table + effect timing
  table. New record: `docs/audits/gpu-rendering-2026-09-26.md`.
- Website: `product.astro` eligibility sentence now includes the one-time
  presentation self-test (claimed only after the hardware pass);
  troubleshooting/known-issues copy audited as accurate.
