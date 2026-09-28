# WebKitGTK native profiling runbook

Linux WebKitGTK is a first-class profiling target. Chromium DevTools
conclusions do not automatically transfer: WebKitGTK has its own web-process
architecture, compositor, canvas-acceleration and OffscreenCanvas support.

## Environment capture

Run this before every WebKitGTK trace so reports are comparable:

```bash
node scripts/perf/capture-webkit-env.mjs        # full report + runbook
node scripts/perf/capture-webkit-env.mjs --json # machine-readable report only
```

Recorded metadata: distro, kernel, desktop environment, Wayland/X11 session,
WebKitGTK / GTK / Mesa versions, GPU + driver, Tauri/Rust/Node versions,
display refresh and DPR hints, total/available memory, CPU governor, and which
native profilers exist on the machine.

### Reference environment (2026-08-02, CachyOS)

| Field | Value |
|---|---|
| OS | CachyOS Linux, kernel 7.1.3-2-cachyos |
| DE / session | KDE, Wayland (`wayland-0`) |
| WebKitGTK | 2.52.5 (webkit2gtk-4.1) |
| GTK | 3.24.52 |
| Mesa | 3:26.1.6-1, radeonsi (AMD Lucienne / Renoir) |
| CPU | 8 cores, `performance` governor |
| Memory | 23,888 MB total |
| Profilers | gdb available; perf / strace / valgrind not installed |

The 2026-09-27 comparison host was CachyOS/KDE Wayland, WebKitGTK 2.52.6,
GTK 3.24.52, Mesa 26.2.3 (radeonsi, AMD Lucienne/Renoir), 8 CPU threads,
23.9 GB RAM, and a 60 Hz 1920×1080 display at scale 1. This is a second dated
observation, not a replacement for the reference table above. The user-space
profilers `perf`, `strace`, `valgrind`, and `bpftrace` were unavailable; gdb
was present.

WebKitGTK 2.54 was released on 2026-09-16 with a Skia web-process compositor,
more damage-aware composition, and scrolling-thread changes. Those upstream
changes are a reason to run a separate comparison when a supported 2.54 host
is available; they do not show that Varve's canvas drag or custom pan is fixed.
This host still runs 2.52.6.

## Native profiling workflow

All costs run in the web process, not the Tauri host:

```bash
# Attach to the WebKitWebProcess and capture a backtrace on a hang:
gdb -p "$(pgrep -f WebKitWebProcess | head -1)" \
  -ex 'thread apply all bt' -batch

# With perf installed, sample the Tauri host and WebKit processes during a
# slow interaction. Use the exact process IDs from the app you launched; do
# not attach to another task's browser or native app:
perf record -F 199 -g -p "$(pgrep -f 'WebKit|varve-desktop' | paste -sd, -)" -- sleep 15
perf report
```

For an interaction comparison, build the release frontend and native app from
the same frozen source tree. Include Tauri's `custom-protocol` Cargo feature,
record the native executable hash and embedded frontend manifest, and verify
the actual IPC transport in the runtime log. A debug binary without that
feature can fall back to `postMessage`; its timings do not qualify the
production IPC path. Use the same artwork, canvas size, DPR, preview quality,
input sequence, and worker policy in each browser/runtime.

Report input-handler time, native request/response or IPC wait, JavaScript
work, render-worker queue/delivery, canvas commit, artwork movement, and rAF
cadence as separate measurements. rAF intervals are a cadence lower bound;
they are not input-to-display or input-to-photon latency. If presentation
timestamps cannot be correlated with the input clock, mark presentation
unavailable.

WebKit inspector (remote): relaunch the app with
`WEBKIT_INSPECTOR_SERVER=127.0.0.1:9222` and attach a WebKit inspector to
`127.0.0.1:9222` for JS timelines and the console.

## Capability flags and fallbacks (in-app)

`detectPlatformCapabilities()` (packages/editor/src/canvas/adaptiveProfile.ts)
reports, cached once per page:

- `engine: 'webkit' | 'chromium' | 'gecko' | 'unknown'` and `webKitVersion`
- `hasOffscreenCanvas` and `hasCreateImageBitmap` explicitly (WebKitGTK
  OffscreenCanvas support is unreliable across point releases)
- `hasWebGL`, `hasWebGPU`, `hasWorker`, `deviceMemory`, `hardwareConcurrency`

Fallbacks in place:

- Worker eligibility is **capability-gated, not UA-gated**
  (`render/workerEligibility.ts`). The former blanket `!isWebKitGTK` ban was
  replaced on 2026-08-07 after the full OffscreenCanvas chain was verified on
  WebKitGTK 2.52.5 — construct in worker, 2D context, replay,
  `transferToImageBitmap`, transfer back, **pixels verified exact**, 1,000
  frames, resize. See
  [`2026-08-07-webkitgtk-render-path.md`](2026-08-07-webkitgtk-render-path.md).
- On WebKitGTK, activation requires a **verified** probe result
  (`render/offscreenCapabilityProbe.ts`). The worker is enabled by default
  after that probe succeeds; the old explicit opt-in policy is no longer
  current. For a controlled diagnostic, `?renderWorker=0` or
  `localStorage['varve.renderWorker'] = 'off'` forces main-thread rendering;
  `?renderWorker=1` or the `on` preference forces use only after capability
  verification. These overrides are not performance recommendations.
- `createRenderWorkerHost` still feature-detects and returns null rather than
  retrying a worker that can only fail. Note it **does not** return null on
  WebKitGTK 2.52.5 — the profile policy is the gate that actually decides.
- Do not gate on `webKitVersion`: WebKitGTK reports the frozen
  Safari-compatibility token `605.1.15` regardless of the real library version.
- Visible in Settings → Performance and via
  `window.__varvePerf.renderPath()`, which reports the current path and the
  gate that selected or declined it.

## Measurement limitation — clock resolution

Measure timer resolution on each runtime before comparing sub-millisecond
phases. Earlier testing measured `performance.now()` quantisation to about
1 ms on WebKitGTK 2.52.5 and about 5 µs on Chromium; those are dated host
observations, not guarantees for later versions. Treat 0/1 ms spans as below
the clock's useful resolution and aggregate them or report them as lower bounds.

## Trace correlation

JS-side spans use `performance.now()` (monotonic). Rust/Tauri spans use their
own monotonic clock. Do not compare absolute timestamps across process clock
domains without calibration; correlate by sequence/revision instead
(`docVersion`, `renderRevision`, interaction correlation id).

## Known WebKitGTK-specific watch items

- Canvas2D acceleration and large-canvas limits differ from Chromium; check
  real frames via the frame diagnostics HUD (`?perf=1`), not Chrome DevTools.
- Wayland frame scheduling can delay presentation; capture at the same
  session type for comparable results.
- OffscreenCanvas is the key capability gate: confirm with
  `typeof OffscreenCanvas !== 'undefined'` in the attached inspector before
  blaming the worker path.
- A WebKit-only regression should be claimed only after a matched production
  comparison. Separate the browser engine from Tauri's native IPC, configured
  compositor, worker path, and event transport; a localhost development build
  differs in all of those dimensions.
- Do not set `WEBKIT_DISABLE_DMABUF_RENDERER=1` as a global Linux workaround.
  A 2026-09-18 WebKitGTK 2.52.6 report describes a one-frame-late **WebGL**
  canvas with DMABUF disabled, while ordinary 2D canvas in its reproduction
  was timely. This is not evidence about Varve's default Canvas2D path, but it
  does make that override unsuitable as a blanket latency fix.
