# Canvas / render performance scripts

Developer tooling for measuring and gating Varve.s canvas and render pipeline.
All scripts are Node ESM and use Playwright's bundled Chromium against a local
dev server.

## Setup

Start a Vite dev server for `apps/desktop`, then point the scripts at it.
The scripts split on target port:

- **`http://localhost:1430`** (hardcoded): `bench-replay-browser.mjs`,
  `probe-baseline.mjs`, `probe-scale.mjs`, `probe-large-doc.mjs`,
  `probe-latency.mjs`
- **`http://localhost:1432`** (default, override with `VARVE_PERF_URL`):
  `probe-interaction.mjs`, `probe-cpu-profile.mjs`
- **`http://localhost:1432`** (hardcoded): `probe-duplication.mjs`

The app's own dev server (`pnpm dev` in `apps/desktop`) listens on
`http://localhost:1420` (strictPort), so probes do not point at it by
default — run a dev server on 1430/1432 (e.g. `vite --port 1430 --strictPort`)
or set `VARVE_PERF_URL` for the probes that support it.

The scripts read `?perf=1` to opt in to the diagnostics ring-buffer handle
(see `packages/editor/src/canvas/drawDiagnostics.ts`).

The `?perf=1` query string enables the editor diagnostics handle (currently
exposed under the legacy `window.__strataPerf` name). Production workload
tooling also accepts `window.__varvePerf` so a future public rename remains
compatible. The handle exposes the frame-diagnostics ring buffer (`totalMs`,
`buildIrMs`, `replayMs`, `hashMs`, `nodeCount`, render path, cache stats)
without console flooding and is inert in normal usage.

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

### Probe family (same diagnostics-ring interface as `probe-interaction.mjs`)

Each probe drives a real browser against the local dev server and reports
frame/interaction percentiles from the `?perf=1` ring buffer.

| Script | What it measures | Notes |
|---|---|---|
| `probe-baseline.mjs` | Canvas frame timing at a fixed node count | `NODES` env var |
| `probe-scale.mjs` | Frame cost + interaction response as node count scales | `[nodeCount]` arg |
| `probe-large-doc.mjs` | Frame cost on a large `.varve` doc opened via the real Open dialog | `[nodeCount]` arg |
| `probe-latency.mjs` | Interaction latency; fails (exit 1) on budget breach | CI-fence style check |
| `probe-cpu-profile.mjs` | Self-time ranking of hot functions | `--callers=<fn>` attribution |

All probes: `node scripts/perf/probe-*.mjs [nodeCount]` against a running dev
server on `http://localhost:1430` (see [Setup](#setup) for the port split and
`VARVE_PERF_URL` override).

> One-off debugging dumps are not kept in this directory — they live only in
> git history. If you need a throwaway probe, name it `probe-<what>.mjs` and
> either graduate it into this README or leave it uncommitted.

## Baseline files

- `.replay-browser-baseline.json` — ratio baselines for `bench-replay-browser.mjs`.

### `run-production-workload.mjs`

Deterministic workload corpus against a production build, driven with real CDP
pointer/keyboard input. Records commit, build mode, machine state (load,
memory, governor, thermal, background repo activity) and a per-workload
validity classification with every result; only `valid` runs are authoritative
regression evidence.

Each workload also records trace-kind counts, frame-disposition counts and
p50/p75/p90/p95/p99/max distributions for every observed interaction span and
correlated frame total. Empty distributions retain a zero `count` and `null`
percentiles, so missing presentation evidence cannot be reported as zero
latency.

```bash
node scripts/perf/run-production-workload.mjs --fixture=vector-1k \
    --workloads=single-drag,nudge,zoom --out=results.json
node scripts/perf/run-production-workload.mjs --duplications=10  # ~2048-node scene
```

`--fixture` seeds a deterministic corpus fixture (see
`packages/editor/src/performance/workloadCorpus.ts`: vector-100/500/1k/5k,
dense-overlap, wide-spread, many-small, few-large, clipped-frames,
masked-content, rotated-skewed, thick-strokes, effects-heavy, blend-modes,
raster-heavy, mixed-raster-vector, hidden-locked, offscreen-mixed,
boundary-crossing, multi-page, text-heavy, deep-nesting, ...) through the
app's own fixture seeder (`window.__varvePerf.fixtures.seed`), so the file,
checksum and node count all come from the corpus code under test.

Workloads include: `pointer-move-idle`, `single-drag`, `multi-drag`,
`marquee-select`, `pan`, `zoom`, `undo-redo`, `resize`, `rotate`, `alt-drag`,
`nudge`, `tool-switch`, `layer-visibility`, `canvas-resize`.
