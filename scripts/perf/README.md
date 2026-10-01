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
exposed under the legacy `window.__varvePerf` name). Production workload
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

The runner drains `window.__varvePerf.interactions.getTraces(50)` after every
measured iteration and replaces earlier copies by trace id. This keeps browser
retention bounded while allowing a production result to aggregate at least 100
warm samples. Each result preserves the trace schema version, timestamp source,
trusted/untrusted clock counts, initial/max/span queue delay, frame disposition,
missing-presentation count, runtime/build/fixture checksum, and machine-validity
classification. A canvas-changing workload with a trace that has no caused,
coalesced, or reused presented frame is an instrumentation error, not a zero.

Trace schema v4 separates `inputToCommitMs` from actual
`inputToNextPaintMs`. The latter is populated only by trusted Event Timing or
native-profiler evidence; rAF is retained only as a lower-bound diagnostic.
Every event has a bounded sequence ID and queue-delay clock classification.
Native bridge gesture samples are explicitly handler-origin. A canvas-changing
trace must carry a `caused`, `coalesced`, or `reused` frame or the workload is
classified as an instrumentation error.

The runner discards ten warm-up interactions and measures until each required
distribution has 100 valid samples or 500 attempts. It exits non-zero for
dirty builds, insufficient samples, instrumentation errors, unsupported
Chromium presentation evidence, threshold breaches, or an invalid machine.
WebKit reports presentation as unavailable unless native profiling supplies
it, while queue, handler, and commit distributions remain gated. Raw v4
traces, span attributes, event IDs, clock trust, causal frame relations,
fixture checksum, runtime/build metadata, and missing counts remain in the
result artifact.

`brush`, `brush-large-tip`, and `eraser` profiles use CDP pointer strokes on
the canvas and undo each stroke between samples. The reset keystroke is
excluded from their pointer-trace distribution. Each also records its first
cold stroke separately from the warmed distribution. Use `small` for brush
work and `retouch-raster` for eraser work so the eraser acts on existing paint.
Variable-pressure DOM-synthetic samples are useful for handler-path diagnosis,
but are untrusted input and cannot qualify the production latency
distributions or stand in for a physical pen.

```bash
node scripts/perf/run-production-workload.mjs --quality=full --fixture=vector-1k \
    --workloads=single-drag,nudge,zoom --out=full.json
node scripts/perf/run-production-workload.mjs --quality=automatic --fixture=vector-1k \
    --workloads=single-drag,nudge,zoom --out=automatic.json
node scripts/perf/run-production-workload.mjs --quality=full --fixture=small \
    --workloads=brush,brush-large-tip --out=brush-full.json
node scripts/perf/run-production-workload.mjs --quality=full --fixture=retouch-raster \
    --workloads=eraser --out=eraser-full.json
node scripts/perf/run-production-workload.mjs --quality=full --fixture=vector-1k \
    --workloads=single-drag --width=1024 --height=768 --out=drag-narrow.json
node scripts/perf/run-production-workload.mjs --quality=full --fixture=vector-1k \
    --workloads=single-drag --width=1920 --height=1080 --out=drag-wide.json
node scripts/perf/run-production-workload.mjs --duplications=10  # ~2048-node scene
node scripts/perf/run-production-workload.mjs --headed --mode=webgl2 \
    --preflight-only --out=headed-webgl2-preflight.json
```

The `--width` and `--height` options default to 1600×1000 and let the same
scene and input workload be repeated at matched narrow and wide viewports.
This reproduces viewport-dependent drag reports without changing the document
or device scale factor.

The --quality argument pins the existing interactive-preview preference for
the run (default: automatic) and records it at the report and workload
levels, so Full and Automatic runs can be kept separate during comparison.
Run matched Full comparisons first, then repeat the same fixture and workload
set in Automatic mode.

The default headless browser uses SwiftShader in this environment. `--headed`
allows a local GPU compatibility preflight and paired browser screen, and records
`browserMode` in both reports. For paired screening, pass it to
`run-webgl2-qualification.mjs`; the flag is forwarded to every renderer cell.
These remain browser evidence, not Tauri/WebKitGTK timing or physical
presentation evidence.

Ordinary-workload response targets are also reported against the observed
requestAnimationFrame interval lower bound (`2T` at p95, `3T` at p99), separate
from the existing fixed regression gates. At least 8 recent rAF intervals are
required to publish that basis; the rAF estimate is cadence evidence, not
input-to-photon timing or proof of a physical display's refresh rate. A p95
claim requires 100 valid samples and p99 requires 1,000; smaller p99
distributions remain descriptive and do not affect the threshold outcome.
Presentation results are omitted when the runtime cannot provide a supported
input-to-next-paint signal.

Renderer qualification and its native host-driver event contract are described
in [webgl2-qualification.md](../../docs/perf/webgl2-qualification.md). For
local browser-only comparison, use `run-webgl2-qualification.mjs`; its
Chromium results are screening evidence and cannot qualify native GPU timing.

The native coordinator accepts a host-local executable adapter which launches
the release Tauri binary and emits one JSON object per line. The adapter must
perform OS-level input and independently confirm the resulting frame identity;
WebDriver-dispatched events are not accepted as native input evidence.

```bash
node scripts/perf/run-native-qualification.mjs \
  --mode=cycles --cycles=100 --binary=/path/to/target/release/varve-desktop \
  --driver=/path/to/native-adapter --out=webgl2-cycles.json
node scripts/perf/run-native-qualification.mjs \
  --mode=navigation --duration-ms=3600000 \
  --binary=/path/to/target/release/varve-desktop \
  --driver=/path/to/native-adapter --out=webgl2-navigation.json
node scripts/perf/run-native-paired-qualification.mjs \
  --scenarios=/path/to/scenario-map.json --blocks=12 \
  --binary=/path/to/target/release/varve-desktop \
  --driver=/path/to/native-adapter
```

The JSONL protocol and required event fields are documented in the
qualification guide. Missing drivers, IDs, cache measurements, textures, or
presentation evidence produce an unsupported/inconclusive result. The older
`native-soak.mjs` remains a process-lifetime monitor; its one-second samples are
not interaction cycles and must not be used as the qualification soak.

### Repeated Tauri workflow soak

The WDIO workflow soak exercises the Tauri/WebKitGTK application through
repeated create/edit/navigate/brush/save/close cycles. It verifies a visible,
nonzero editor surface, changed artwork pixels, a settled local save, a closed
document, and a screenshot before counting each cycle. The runner checkpoints
whole-process-tree RSS and host memory/load after completed cycles and detects
sleep, missing events, screenshots, hidden/zero-size WebViews, and runner
failures. It does not claim trusted OS input, physical pen/touchpad behavior,
or input-to-photon latency: the pointer and wheel events are explicitly
WebDriver DOM-synthetic.

Build a fresh Tauri WDIO executable with its matching embedded frontend, then
run the repeated workflow under the heavy-task lease:

```bash
node scripts/quality/heavy-lease.mjs "native: build Tauri WDIO executable" -- \
  pnpm desktop:build:test
node scripts/quality/heavy-lease.mjs "native: Tauri workflow soak (100 cycles)" -- \
  node scripts/perf/native-workflow-soak.mjs \
    --binary=apps/desktop/src-tauri/target/debug/varve-desktop \
    --cycles=100 --out=artifacts/perf/native-fluidity-100-cycles.json
```

Fewer than 100 cycles are useful for smoke testing but are marked incomplete
for soak evidence. Even a complete run remains synthetic-input evidence and
does not qualify a renderer or physical input device.

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
`nudge`, `brush`, `brush-large-tip`, `eraser`, `tool-switch`, `layer-visibility`,
`canvas-resize`.
