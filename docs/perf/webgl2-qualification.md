# WebGL2 renderer qualification

WebGL2 is an opt-in experimental renderer. Canvas2D remains the default until
paired native measurements show a material editing improvement without
correctness, startup, packaging, or memory regressions. Canvas2D may already be
GPU accelerated by the host webview, so the comparison measures the complete
editing pipeline instead of assuming that a GPU API is faster.

## Evidence lanes

The focused workflow runs only on temporary refs named
`codex/webgl2-qualification/*`:

- Hosted Chromium runs compositor/editor checks and the WebGL2 browser E2E.
- Hosted Tauri jobs exercise Linux WebKitGTK, Windows WebView2, and macOS
  WKWebView integration. Linux runs in Xvfb with Mesa software rendering.
- These hosted lanes establish compatibility and fallback behavior. They do
  not establish physical GPU execution or display presentation latency.
- `scripts/perf/run-production-workload.mjs` is a Chromium production-bundle
  screening runner. It records the actual renderer path, renderer submissions,
  Canvas2D fallback items, image uploads, CPU submission/blit costs, fixture
  and asset hashes, and raw gesture samples. Its input-to-commit metric is not
  an input-to-display metric.
- `scripts/perf/run-webgl2-qualification.mjs` first runs three balanced
  Canvas2D main-thread/verified-worker blocks per workload, selects the faster
  verified Canvas2D mode per cell, and selects the slow target before viewing
  WebGL2 results. It then pairs the chosen Canvas2D mode with WebGL2, resampling
  both blocks and gesture samples. Use `--blocks=12` to allow sequential
  extension by three-block groups when uncertainty overlaps a decision limit.

Example screening command (run only on an otherwise idle host):

```bash
TMPDIR=/var/tmp \
node scripts/perf/run-webgl2-qualification.mjs \
  --headed --fixtures=vector-1k,flat-10k,raster-heavy,mixed-raster-vector \
  --workloads=pan,zoom,single-drag --blocks=12
```

`--headed` is needed for a local hardware-renderer browser screen when
headless Chromium selects SwiftShader. It is forwarded to each renderer cell;
the report records `browserMode`. It does not turn CDP pointer events or
browser event-to-commit timing into OS-input or native presentation evidence.
Hosted compatibility jobs should stay headless and cannot pass the performance
promotion gates.

The qualification drivers honor `TMPDIR` for their default output directory.
Set it to a filesystem with enough free space before a long run; use `--outdir`
to choose a specific location.

Each result carries the source commit, dirty-tree state, browser/build
fingerprints, fixture checksum, deterministic raster asset hashes, viewport,
DPR, camera reset, theme, requested renderer, actual path, and machine pressure
signals. Dirty, contended, backgrounded, memory-pressured, software-rendered,
or mode-unavailable runs remain visible in artifacts but cannot enter the
paired comparison. Slow valid observations remain evidence and are not
reclassified as invalid.

## Native input, GPU, and presentation evidence

Native qualification must run on the host under test. SSH may launch the test
driver remotely, but it cannot move measurements back to this workstation and
still call them local timing. A native adapter must perform OS-level pointer
input and correlate a unique input identity with the changed content-frame
identity. It must record clock source and uncertainty. The embedded Tauri
WebDriver smoke test checks integration only; its automation actions are not
accepted as latency evidence.

The native run separately records WebGL context/vendor/renderer diagnostics,
actual GPU submissions, and independent execution evidence. A Vulkan adapter
or WebGL context string alone does not prove hardware execution; software
renderers count as compatibility results only. rAF, GTK after-paint,
estimated GDK times, and screen-capture arrival are diagnostic boundaries, not
physical presentation. An authoritative route requires a correlated native
presentation profiler or an optical measurement setup with documented clock
and identity calibration. Hosts without that evidence report presentation as
unavailable.

The native resource qualification requires 100 actual open→interact→close
cycles and a separate 60-minute navigation soak. A cycle counts only when a
driver reports all three completed phases and an OS-input identity. Memory
must cover the Tauri/WebKit process tree and application caches. The final two
20-cycle median windows may grow by no more than `max(8 MiB, 5%)`; GPU texture
residency remains subject to the compositor's existing 32 MiB and 32-entry
limits. Missing native driver events never turn elapsed timer ticks into
completed work.

The focused GitHub workflow also builds the release AppImage through the
library-pruning pipeline and launches it twice under Xvfb: once with the
AppImage default workaround and once with an explicit
`WEBKIT_DISABLE_DMABUF_RENDERER=0` user override. The smoke report checks that
the WebKit web process starts with the expected value and that no known EGL
startup-abort signatures appear. This is packaged X11/software compatibility
evidence; it does not qualify Wayland, GPU execution, or display presentation.
Keep the current default workaround until packaged checks on a clean candidate
pass for both cases and the resulting Linux configurations are reviewed.

The host-local coordinator is
`scripts/perf/run-native-qualification.mjs`. Its adapter is an executable that
launches the supplied release binary, uses OS-level input, observes trusted
DOM input and a changed content-frame identity, and emits JSONL on stdout. For
each cycle it must emit a record shaped like:

```json
{"type":"cycleComplete","index":1,"phases":{"open":"completed","interact":"completed","close":"completed"},"input":{"source":"os","trusted":true,"identity":"input-1"},"frame":{"changed":true,"identity":"frame-1"},"rendererPath":"webgl2","gpuSubmittedItems":12,"gpuTextureBytes":1048576,"gpuTextureEntries":1,"applicationCacheBytes":2097152}
```

Navigation events use `type: "navigationInteraction"`, sequential `index`,
`foreground: true`, the same input/frame identity fields, and a `presentation`
object with source `optical` or `native-profiler-correlated`, a trusted clock,
matching input/frame identities, monotonic timestamps, measured
`inputToPresentationMs`, and `uncertaintyMs`. Input and presentation timestamps
must use the same nonempty `clockId`; a cross-clock measurement must include a
verified `clockCorrelation` with source/target clock IDs, offset, and mapping
uncertainty. The reported latency must agree with the correlated timestamp
difference within the combined uncertainty. A same-clock sample has this shape:

```json
{"type":"navigationInteraction","index":1,"foreground":true,"input":{"source":"os","trusted":true,"identity":"input-1","clockId":"host-monotonic","monotonicTimestampMs":1000},"frame":{"changed":true,"identity":"frame-1"},"rendererPath":"webgl2","gpuSubmissionIdentity":"submission-1","gpuSubmittedItems":12,"hardwareExecution":"verified-hardware","hardwareExecutionEvidence":{"source":"gpu-trace","submissionIdentity":"submission-1","executionIdentity":"gpu-work-1","deviceProfileId":"local-profile-hash","softwareRenderer":false},"gpuTextureBytes":1048576,"gpuTextureEntries":1,"applicationCacheBytes":2097152,"throttlingEvidence":{"cpu":{"status":"clear","source":"linux-thermal-counters"},"gpu":{"status":"clear","source":"vendor-driver-telemetry"}},"presentation":{"source":"optical","clockTrust":"trusted","clockId":"host-monotonic","monotonicTimestampMs":1016.7,"inputIdentity":"input-1","contentFrameIdentity":"frame-1","inputToPresentationMs":16.7,"uncertaintyMs":0.2}}
```

The result retains validated protocol fields (rather than arbitrary adapter
payloads): lifecycle, input, frame, timing, clock, renderer, submission, and
memory fields. GPU timing also needs
`hardwareExecution: "verified-hardware"` and a
`hardwareExecutionEvidence` record from an API profiler, driver counter, or GPU
trace that correlates `gpuSubmissionIdentity` to an execution identity, names a
non-identifying device profile, and explicitly rules out software rendering.
Context strings or Vulkan capability alone do not establish hardware execution;
the coordinator retains this evidence for independent review and never promotes
the renderer by itself. The included WebDriver smoke
test is a native webview compatibility check, not an implementation of this
OS-input adapter.

Benchmark-mode drivers receive the frozen fixture, gesture, block, scenario
path/hash, renderer, 10 warmups, and measured interaction count as arguments
and environment variables. Warmups must not be emitted as measured events. A
measured event uses `type: "benchmarkInteraction"` and repeats the exact
fixture/workload/block labels. Optional diagnostic fields are kept separate:
`phaseTimingsMs` may provide scene preparation, replay, queueing, GPU submit,
GPU execution, copy/compositing, and presentation-wait costs;
`webviewGraphics` may provide WebKit/WebGL backend, vendor, renderer, and
software-rendering diagnostics; `nativeVulkan` records native-compute discovery
and execution separately. Neither context strings nor Vulkan capability prove
that a submitted WebGL draw executed on physical GPU hardware.

Each benchmark/navigation event also needs independent CPU and GPU
`throttlingEvidence` with `status: "clear"` and a nonempty telemetry source.
Detected throttling, missing telemetry, unavailable host thermal readings,
high CPU pressure, or the runner's host-load/memory limits invalidate latency
qualification. The coordinator records CPU frequency and pressure as context;
it does not treat an observed frequency ratio alone as proof of throttling.

Example measured WebGL2 benchmark event:

```json
{"type":"benchmarkInteraction","index":1,"fixture":"vector-1k","workload":"pan","block":1,"foreground":true,"input":{"source":"os","trusted":true,"identity":"input-1","clockId":"host-monotonic","monotonicTimestampMs":1000},"frame":{"changed":true,"identity":"frame-1"},"rendererPath":"webgl2","gpuSubmissionIdentity":"submission-1","gpuSubmittedItems":12,"hardwareExecution":"verified-hardware","hardwareExecutionEvidence":{"source":"gpu-trace","submissionIdentity":"submission-1","executionIdentity":"gpu-work-1","deviceProfileId":"local-profile-hash","softwareRenderer":false},"gpuTextureBytes":1048576,"gpuTextureEntries":1,"applicationCacheBytes":2097152,"throttlingEvidence":{"cpu":{"status":"clear","source":"linux-thermal-counters"},"gpu":{"status":"clear","source":"vendor-driver-telemetry"}},"presentation":{"source":"optical","clockTrust":"trusted","clockId":"host-monotonic","monotonicTimestampMs":1016.7,"inputIdentity":"input-1","contentFrameIdentity":"frame-1","inputToPresentationMs":16.7,"uncertaintyMs":0.2}}
```

`scripts/perf/run-native-paired-qualification.mjs` runs the full native latency
screen on one clean Linux host. It first measures three blocks of Canvas2D main
thread and Canvas2D worker for each fixture/gesture, chooses the faster verified
Canvas2D route, and selects the slow target from those Canvas-only results. It
then runs paired, alternating Canvas2D/WebGL2 blocks for all cells. Each block
uses 10 warmups and at least 100 OS-input gestures. If an interval overlaps a
promotion boundary, it extends the experiment in three-block groups up to 12.
The tool writes every single-cell report plus a paired `qualification.json`.
It refuses to start from a dirty checkout, a debug binary, or without a frozen
scenario map, release binary, and host-local driver.

The scenario map points to one frozen JSON file per exact fixture and gesture;
those files carry fixture/asset hashes, the gesture-sequence hash, viewport,
DPR, initial camera, and theme. Example map:

```json
{
  "vector-1k": {
    "pan": "./scenarios/vector-1k-pan.json",
    "zoom": "./scenarios/vector-1k-zoom.json",
    "single-drag": "./scenarios/vector-1k-drag.json"
  }
}
```

Run on the idle target machine after building the exact release binary and
installing a driver that implements the documented JSONL protocol:

```bash
node scripts/perf/run-native-paired-qualification.mjs \
  --scenarios=/path/to/scenario-map.json \
  --binary=/path/to/target/release/varve-desktop \
  --driver=/path/to/native-os-input-adapter \
  --fixtures=vector-1k,flat-10k,raster-heavy,mixed-raster-vector \
  --workloads=pan,zoom,single-drag --blocks=12
```

The paired report recomputes latency from preserved input/presentation clocks,
checks each event and summary against the protocol, verifies the release binary
and scenario identity across paired blocks, and retains rejected-run reasons.
Its `performanceDecision` reports only the native latency thresholds. Promotion
stays disabled until correctness, resource soak, startup, and packaged
AppImage/DMA-BUF checks are attached and pass; native benchmark JSON alone can
never change renderer support status.

## Decision rule

The slow target is chosen from the Canvas2D-only baseline screen before the
WebGL2 results are examined. The comparison uses the faster verified Canvas2D
path for each workload. Promotion requires at least a 20% improvement on the
slow target, no more than a 5% regression on every other primary workload,
uncertainty intervals that clear both limits, exact settled-frame/full-redraw
agreement, full-frame Canvas2D reference checks (exact interior pixels and at
most two channel levels only within the analytic one-device-pixel edge mask),
and passing save/export, recovery, startup, packaging, and memory/soak checks.

The initial support target is an explicitly qualified Linux configuration
profile. Qualification does not transfer between GPU vendors, drivers, display
backends, CPU architectures, or operating systems. NPU availability and native
Vulkan compute remain separate features. If native presentation or an idle
physical GPU host is unavailable, the result is inconclusive and Canvas2D
remains the recommended renderer.
