# Canvas / render performance scripts

Developer tooling for measuring and gating Strata's canvas and render pipeline.
All scripts are Node ESM and use Playwright's bundled Chromium against a local
dev server.

## Setup

Start a Vite dev server for `apps/desktop`, then point the scripts at it. The
default base URL is `http://localhost:1432`; the scripts read `?perf=1` to opt
in to the diagnostics ring-buffer handle (see
`packages/editor/src/canvas/drawDiagnostics.ts`).

The `?perf=1` query string enables `window.__strataPerf`, which exposes the
frame-diagnostics ring buffer (`totalMs`, `buildIrMs`, `replayMs`, `hashMs`,
`nodeCount`, render path, cache stats) without console flooding. It is inert in
normal usage.

## Scripts

### `bench-replay-browser.mjs`

Real-browser rasterization benchmark for the engine's `replayIr` path, filling
the jsdom gap in `renderPath.bench.ts` — here the browser actually paints
pixels. Runs 100 / 1k / 10k / 50k rects through `replayIr` on a real Canvas2D
context and reports p50/p95/p99 wall time, plus a ratio to a fixed-cost control
loop (machine-speed independent).

```bash
node scripts/perf/bench-replay-browser.mjs           # run + print
node scripts/perf/bench-replay-browser.mjs --update  # write new baseline (.replay-browser-baseline.json)
node scripts/perf/bench-replay-browser.mjs --ci      # fail on ratio regression vs baseline
```

Requires the `visual-harness.html` page (served by the desktop app's Vite dev
server).

### `probe-interaction.mjs`

Measures real interaction frame cost via the diagnostics ring buffer: builds a
document to the requested node count (default ~128), then reports drag frame
total/build/replay/hash p50/p95/p99.

```bash
node scripts/perf/probe-interaction.mjs        # ~128 nodes
# edit the duplication-loop guard to scale up (see file comments)
```

### `probe-duplication.mjs`

Measures the wall-clock of a single select-all + duplicate (Ctrl+A, Ctrl+D) at
~500 nodes — the operation that exposed the O(n²) getParent hotspot (38.3s →
~5s).

```bash
node scripts/perf/probe-duplication.mjs
```

## Baseline files

- `.replay-browser-baseline.json` — ratio baselines for `bench-replay-browser.mjs`.
