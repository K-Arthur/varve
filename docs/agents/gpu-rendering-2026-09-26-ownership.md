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
