# Low-end effects and model runtime device kit

**Purpose:** finish the physical ChromeOS acceptance that host emulation cannot
establish. Use this kit on the supplied Lenovo Chromebook Duet or a named
equivalent device. Record actual output; do not convert pending checks into
passed claims.

## Current evidence boundary

Host-side Linux Chromium emulation and unit tests exercise the browser flow,
but they do not establish ChromeOS system-gesture dispatch, physical pen input,
keyboard occlusion, suspend behavior, or ARM64 Crostini rendering. The
following physical runs are pending:

| Route | State | Required device run |
|---|---|---|
| ChromeOS browser | Pending | Open the public browser demo in Chrome; record ChromeOS/Chrome versions, actual viewport, DPR, and device model. |
| Installed browser/PWA | Pending | Install after an online visit, then repeat with the PWA window and offline reopen. |
| ARM64 Crostini | Pending | Confirm `uname -m`, install the currently published ARM64 package from the verified release guide, and record first launch plus package version. |

Current release-package facts and installation commands are maintained by the
[Chromebook guide](../../apps/website/src/pages/docs/chromebook.astro) and
[`docs/release/website.md`](../release/website.md). Re-read those sources on the
test date; package channels and artifacts can change.

## Capture the actual environment

Create one evidence directory per device and route. Keep screenshots and short
recordings free of private documents. Include:

```text
Device model / board:
ChromeOS version:
Chrome version (`chrome://version`):
Varve version / source SHA:
Route (browser / installed PWA / ARM64 Crostini):
Architecture (`uname -m` for Crostini):
Display orientation and physical resolution:
CSS viewport (`window.innerWidth` × `window.innerHeight`):
`window.devicePixelRatio`:
`window.visualViewport` width × height / scale / offset:
Connected display or split-screen state:
Keyboard (docked / floating / dismissed) and active field:
Available storage estimate before / after model installation:
Capability report JSON path:
Evidence directory:
Run date and operator:
```

Read the browser values from DevTools on the target page:

```js
JSON.stringify({
  innerWidth,
  innerHeight,
  dpr: devicePixelRatio,
  visualViewport: visualViewport && {
    width: visualViewport.width,
    height: visualViewport.height,
    scale: visualViewport.scale,
    offsetLeft: visualViewport.offsetLeft,
    offsetTop: visualViewport.offsetTop,
  },
  screen: { width: screen.width, height: screen.height, orientation: screen.orientation.type },
})
```

Do not substitute Playwright's emulated viewport for these physical values.

## Run the workflow

Use the same document, image files, and order on each route. Save the original
test document before starting and retain the exact input files with hashes.

1. Open the same representative artwork in the selected route. Include one
   ordinary document, the existing 150-node effects-heavy fixture, a large
   transparent image with thin detail, and a nested-mask/backdrop case. Note
   dimensions and pixels per source image in the evidence log.
2. Open Effect Studio in portrait orientation. Physically tap Before, After,
   Compare, Fit, 100%, a numeric treatment value, Preview, Cancel preview, Add
   to stack, Reset controls, and one move-up/down action. Check that the entire
   frequent target is usable without repeated precision taps. Record any
   control the software keyboard or navigation surface covers.
3. While a heavy preview or inference request is running, pan/zoom, select a
   different object, switch workspaces, and make a small edit. Confirm that
   input remains available, stale previews are rejected, and explicit export
   stays usable. Record the visible stage and wall time; include failures.
4. Start an optional model download explicitly. Capture its source, displayed
   transfer/storage size, peak working-memory estimate, progress, verification
   result, and final installed state. Cancel once during transfer and confirm
   the dialog waits for cleanup before saying the transfer was cancelled.
   Retry online, verify the ready state, then open the feature once. Record the
   actual provider from the capability report; do not infer NPU use from the
   device specification.
5. With the on-screen keyboard open in a numeric field, confirm the focused
   field and its Apply/Cancel controls remain visible. Repeat with the keyboard
   docked and floating if ChromeOS offers both. Capture the viewport and
   keyboard placement in each state.
6. Create a derived result, apply it, save the document, close Varve, enable
   airplane mode, reopen the saved document, and export the result. Compare the
   reopened/exported pixels with the saved result. The model must not be needed
   to reopen committed pixels.
7. Repeat with suspend/resume between preview and save. Record whether the
   preview was cancelled, resumed, or restarted; verify that the document and
   accepted effects remain intact after resume.

For the browser/PWA route, verify offline reopen only after one complete online
visit. For Crostini, keep ChromeOS/browser memory pressure and Linux process
memory distinct in the notes; both consume the device's shared physical RAM.

## Mixed-workload measurements

Collect three alternating rounds per route when hardware time allows. Alternate
the current production build and candidate build on the same device, power
state, viewport, document, and input sequence. Separate cold model/session
startup, warm preview, final refinement, inference stages, export, cancellation,
and transfer costs. Record raw samples and sample counts before reporting any
percentile. Keep the 50 ms lightweight-feedback goal and display-relative
ordinary frame budget as targets; record misses rather than dropping them.

Run 100 mixed cycles of navigation, edits, model preview/inference, cancel,
save, and export. Capture resident-memory observations at fixed intervals and
the final/peak value available to the OS. Browser JS heap alone is not total
process memory. If the OS does not expose useful per-process data, mark the
measurement unavailable rather than estimating it from the model budget.

On host builds, retain the same-camera forced-full-redraw oracle for any path
that reuses painted pixels. Physical screenshots do not replace the oracle;
compare optimized and authoritative renders at the same camera and document
state.

## Evidence record

| Case | Result (pass / fail / pending) | Timing or actual dimensions | Screenshot/recording/log path | Notes and exact failure |
|---|---|---|---|---|
| Route and version inventory | Pending | | | |
| Portrait preview and touch targets | Pending | | | |
| Pen/touch drawing and pan/zoom | Pending | | | |
| Keyboard occlusion, docked | Pending | | | |
| Keyboard occlusion, floating | Pending | | | |
| Download cancellation and recovery | Pending | | | |
| Model verification and provider | Pending | | | |
| Navigation during effect/inference | Pending | | | |
| Suspend/resume | Pending | | | |
| Save, offline reopen, and export | Pending | | | |
| Three alternating rounds | Pending | | | |
| 100-cycle memory soak | Pending | | | |

Do not publish device-speed or battery claims from one run. Report the device,
route, source SHA, workload, conditions, sample count, failures, and pending
cases with every result.
