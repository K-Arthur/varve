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

## Native profiling workflow

All costs run in the web process, not the Tauri host:

```bash
# Attach to the WebKitWebProcess and capture a backtrace on a hang:
gdb -p "$(pgrep -f WebKitWebProcess | head -1)" \
  -ex 'thread apply all bt' -batch

# With perf installed (sudo pacman -S perf on Arch/CachyOS), sample all
# processes during a slow interaction:
perf record -F 199 -g -p "$(pgrep -f 'WebKit|strata' | tr '\n' ',')" sleep 15
perf report
```

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

Fallbacks already in place:

- The render worker is disabled on WebKitGTK: `profileForTier` requires
  `hasWorker && hasOffscreenCanvas && !isWebKitGTK` (quality/balanced tiers).
  `createRenderWorkerHost` additionally feature-detects OffscreenCanvas and
  returns null (main-thread Canvas2D) rather than retrying a worker that can
  only fail.
- These are also visible in the Performance settings tab and `window.__strataPerf`.

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
