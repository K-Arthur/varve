# Render Path Verification — Visual Regression + Performance Harness

Companion to `docs/quality/test-reality.md` (§5 priority 3: "a CanvasArea pixel/structural
regression check... the highest-value gap of the entire audit — CanvasArea is the actual render
path and currently has zero correctness verification, only call-count verification"). This
document covers the harness built to close that gap, plus the performance baseline required before
any structural change to the render path.

## The existing "golden" test was never real

`packages/engine/src/__goldens__/goldenReplay.test.ts` hashes `canvas.getContext('2d')`'s
`getImageData()` output and asserts hash stability. Verified directly: in this repo's jsdom test
environment, `fillRect`/etc. are no-ops and `getImageData` always returns an all-zero buffer. The
existing test only proves `replayIr` is deterministic given identical input — it has never
verified that anything is actually drawn correctly. This is why the new harness renders in a real
browser (Playwright) instead of extending that pattern.

## A. Visual regression harness

- **Render harness**: `apps/desktop/visual-harness.html` + `visual-harness-main.ts` — a minimal
  page that calls `replayIr` directly (not a full app boot), exposed via `window.__renderFixture()`
  and a fixed-time motion fixture entry point. Image sources are decoded before the frame is
  painted so image fixtures cannot snapshot a loading placeholder.
- **Fixtures** (`tests/e2e/visual/fixtures.ts`): node types, opacity and blend modes, translated
  and rotated gradients, image fills, filters/LUTs, fixed-time motion-bound properties, all line
  caps, joined/dashed strokes, multilingual text, and a 1,500-node pathological generator.
  Full-editor compositing coverage is provided by the companion canvas E2E spec.
- **Comparison**: Playwright's built-in `toHaveScreenshot()` (pixelmatch under the hood already —
  no new dependency needed), **per-fixture tolerance** scaled by DPR². Three Chromium DPR projects
  run in the default visual gate (`chromium-visual-1x`, `-2x`, and `-3x`).
- **Structural signal** (`packages/engine/src/__goldens__/drawCallRecorder.ts`): a Proxy-based
  canvas-context recorder that snapshots the sequence of draw calls, independent of real
  rasterization — runs in plain Vitest, no browser needed. **This was verified against the actual
  bug classes found uncaught in `test-reality.md`'s bug-injection pass (paint order, blend mode,
  dropped/mishandled node type)** — not a hoped-for property, a directly confirmed one. This closes
  the loop: the specific gap the bug-injection audit found (CanvasArea has no correctness
  verification) now has a concrete, fast, proven-effective test in place for at least the draw-call
  level, independent of whether pixel rendering is available in a given environment.
- **CI**: `scripts/build-visual-diff-manifest.mjs`, wired into the `e2e` job in
  `.github/workflows/ci.yml`, uploads a side-by-side diff artifact on failure only.
- **Baseline storage**: in-repo and namespaced by fixture, runtime, DPR, and host platform. The
  expanded corpus remains reviewable at the current scale; revisit storage if it grows materially.
- **Review UI** (`tests/e2e/visual/review.html`): static, zero-dependency, zoom/pan per pane. Since
  a static page can't write files, "Accept" reveals the exact local `--update-snapshots` command
  to run instead of pretending to write a baseline server-side — the honest version of the
  requested affordance, not a compromise made silently.

### Deferred (explicit, not silently dropped — see `tests/e2e/visual/README.md`)

Nested groups and masks/clipping require the real-editor compositing spec rather than the flat
`replayIr` harness. GPU-backed Chromium and Firefox/WebKit replay projects have separate,
opt-in baseline namespaces; they are not required by the default Linux gate until their runtime
availability is guaranteed in CI. Font-pinning remains deferred for the multilingual fixture;
the Linux CI image is the canonical text-rendering environment and cross-platform baselines must
be generated and reviewed on their target platform.

## B. Performance harness

`packages/editor/src/canvas/__benchmarks__/renderPath.bench.ts` + `scripts/audit-render-perf.mjs`,
following this repo's existing baseline-file convention (`.architecture-baseline.json` etc.).
Measures full-frame render, incremental-frame render (via the real `SubtreeIrCache`), pan/zoom
frame time, time-to-first-paint, and heap growth per frame, at 100 / 1,000 / 10,000 / 50,000 nodes.
Same jsdom caveat as above applies: these measure JS-side replay cost (traversal, transform math,
draw-call construction/dispatch), not real rasterization time — the right thing to benchmark for
the switch-vs-dispatch-table question this harness exists to answer, not a substitute for a
real-browser paint benchmark if one is needed elsewhere.

**Ratio-based CI gate, not absolute wall-clock** — directly motivated by a flaw found earlier in
this same audit chain (`test-reality.md` §4 flagged `replay.bench.ts`'s sibling
`canvas10k.bench.test.ts`-style absolute-ms assertions as exactly the kind of contention-sensitive
test that flakes on noisy CI machines). `audit-render-perf.mjs --ci` compares
`metric-p50 / control-p50` against the committed `.render-perf-baseline.json` with 1.5x headroom.
Verified stable: `--ci` passed cleanly on a fresh re-run despite ~5-10% natural run-to-run
variance — the exact failure mode an absolute threshold would not have survived. Wired into the
`js` job in `.github/workflows/ci.yml`, after `pnpm test`.

### Baseline, measured now, before any refactor

| Nodes | Fixture build | Full-frame | Incremental (1% dirty) | Pan/zoom | Time-to-first-paint |
|---|---|---|---|---|---|
| 100 | 0.2ms | 0.5ms | 0.01ms | 0.3ms | 1.7-3.1ms |
| 1,000 | 0.3-0.5ms | 2.7-3.1ms | 0.5ms | 1.8-2.9ms | 4.5-4.9ms |
| 10,000 | 0.5-0.7ms | 19.8-24.1ms | 3.9-4.2ms | 24.9-36.3ms | 35.1-38.4ms |
| 50,000 | 15.5-27.4ms | **130.5-139.9ms** | 16.3-18.0ms | 133.6-137.4ms | **178.0-178.1ms** |

**Flagged loudly, not buried**: at 50k nodes, full-frame render is already **8-9x over a
16ms/60fps frame budget**, and incremental (1%-dirty) rendering scales sub-linearly and stays
comfortably fast (16-18ms even at 50k) — meaning the dirty-region cache is doing real work, and
the actual risk in any render-path refactor is regressing *that* path specifically, not full-frame
render (which is already known-slow and likely bounded by document-open/first-paint UX, not
per-frame interaction). This is today's number, pre-refactor — independent of anything else in
this audit chain, it's a real ceiling worth product attention.

## C. The switch-vs-dispatch-table rule

Added to `AGENTS.md` (new subsection after "Hook ordering invariance"): any structural change to
`replaySubtreeToCtx`, `replayIr`, or an equivalent per-node/per-frame dispatch function must be
benchmarked against this baseline before merge, and a regression is not justified by a readability
win in this specific function — full text in `AGENTS.md`.

## What this means for the Phase 3 CanvasArea refactor

Combined with `test-reality.md`'s finding that CanvasArea currently has zero test coverage for
paint order, blend mode, or node-kind routing: the draw-call recorder (this doc, §A) is the
**minimum viable safety net** for that refactor to proceed at all, and it did not exist before this
audit chain. The performance harness (§B) is the second prerequisite — any dispatch-table/visitor
refactor of `replaySubtreeToCtx` must show a ratio no worse than the committed baseline, per the
AGENTS.md rule this document backs. Neither harness alone clears the refactor for a go; both
existing is a necessary, not sufficient, condition — the remaining gap is the deferred fixture
coverage (masks, groups, image fills) listed above, which matters most for exactly the kind of
subtle visual regression a context/render-path split is likely to introduce.
