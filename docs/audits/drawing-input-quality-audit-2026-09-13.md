# Varve drawing input quality audit — 2026-09-13

Status: web-route implementation complete and browser-engine validation passed
for the focused regressions below. The separate Stage 2 production-artifact
checks also covered PWA install readiness, offline launch, update activation,
and browser export; physical Duet/PWA/Crostini runs remain pending. This
report records evidence and limits; it does not turn synthetic PointerEvents
into hardware certification.

## Hardware and runtime boundary

The reference configuration is the Lenovo Chromebook Duet 11M889 with
Kompanio 838, Mali-G57 MC3, **8 GB RAM / 128 GB eMMC**, 10.95-inch 1920×1200
panel, ChromeOS, and an optional USI Pen 2. Lenovo lists 4 GB/64 GB variants
too, but the reference SKU is not a 4 GB device. A 4 GB representative device
is a separate constrained target.

The routes are intentionally separate:

| Route | What this work can verify | Not claimed |
|---|---|---|
| Chrome tab in ChromeOS | Chromium DOM routing, persisted controls, synthetic mouse/touch/pen sequences, screenshots, document invariants | USI pressure, palm rejection, ChromeOS digitizer behavior, physical latency |
| Installed PWA | Stage 2's served `/try/` artifact passed install-readiness, offline-launch, update-activation, and export checks; the drawing code is the same web route | The installed ChromeOS window, OSK, Files integration, and physical pen/touch behavior still need a device run |
| Tauri Linux ARM64/Crostini | Published v0.2.1 ARM64 artifact/dependency evidence and the WebKitGTK capability boundary | A package/dependency check or Linux launch is not pen-pressure or multitouch evidence; no ARM64 Chromebook hardware run is claimed here |

The physical panel resolution is not used as a CSS viewport assumption. The
automated matrix records `window.innerWidth`, `window.innerHeight`,
`devicePixelRatio`, canvas CSS bounds, and canvas backing-store ratio. Duet
display scaling, browser zoom, orientation, split-screen, external display,
on-screen keyboard, and installed-PWA window geometry still require a device
run.

## Research ledger

| Source (accessed 2026-09-13) | Version/status | Decision supported | Uncertainty |
|---|---|---|---|
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) | Recommendation 2026-06-30 | Track `pointerId`; preserve `pointerType`, `button`/`buttons`, coalesced samples, capture/cancel; predictions are latency hints, not document data. | Browser/WebKitGTK conformance still needs route-specific tests. |
| [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) and [multitouch](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction) | Current MDN pages, accessed 2026-09-13 | Use one pointer stream and a per-pointer map; do not use one global dragging flag. | MDN describes web APIs, not ChromeOS palm quality. |
| [MDN `PointerEvent.pressure`](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/pressure) | Current MDN page | `0.5` is a normalized default/possible mouse value; one reading cannot prove a pressure sensor. | Actual device signal must be observed on hardware. |
| [MDN `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) | Current MDN page | Scope gesture arbitration to the canvas surface; expect `pointercancel` when the UA wins. | Native shell gestures can sit outside page CSS. |
| [Chrome desynchronized canvas](https://developer.chrome.com/blog/desynchronized) and [aligned input](https://developer.chrome.com/blog/aligning-input-events/) | Chrome guidance, accessed 2026-09-13 | Keep low-latency hints optional and measured; use pointermove/coalescing as the baseline and avoid duplicate raw streams. | No new raw/prediction path is justified by JS timing alone. |
| [Google Chromebook stylus help](https://support.google.com/chromebook/answer/7073299?hl=en) and [touch help](https://support.google.com/chromebook/answer/2766492?hl=en) | Current support pages | Document physical stylus/touch checks separately from browser automation. | Device firmware and USI implementation vary. |
| [Lenovo Duet 11M889 PSREF](https://psref.lenovo.com/Detail/Lenovo_Chromebook_Duet_11M889?M=83HH000FMC) and [official datasheet](https://psrefstuff.lenovo.com/syspool/Sys/PDF/datasheet/Lenovo-Chromebook-Duet-11-9_MediaTek_9170L4DR-240725_HR.pdf) | Official hardware specification | Keep the 8 GB/128 GB reference distinct from 4 GB variants; USI Pen 2 is optional. | The specification does not establish hover, tilt, barrel, eraser, or palm behavior in this app. |
| [Tauri Webview versions](https://v2.tauri.app/reference/webview-versions/) | Tauri v2 reference | Treat Linux as the system WebKitGTK route, separate from Chrome/PWA. | Installed WebKitGTK version and device package availability need Crostini verification. |
| [Playwright touchscreen](https://playwright.dev/docs/api/class-touchscreen) and [emulation](https://playwright.dev/docs/emulation) | Current Playwright docs | Use Playwright for DOM/layout/route regressions and label it synthetic. | `hasTouch`/tap/CDP pen do not prove pressure, palm rejection, or real multitouch dispatch. |
| [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) and [dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | WCAG 2.2 guidance | Aim for ~44 CSS px for frequent tablet controls; separately test the 24×24 AA minimum and provide non-drag alternatives. | 44 px is not the universal AA rule. |
| [Figma vector networks](https://help.figma.com/hc/en-us/articles/360040450213-Vector-networks) | Figma Learn page, accessed 2026-09-13 | Keep anchor placement, curve dragging, close-target feedback, and open-path completion explicit. | Figma's interaction model is a product reference, not a Varve compatibility guarantee. |
| [Adobe Illustrator Pen curves](https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/draw-shapes/draw-curves-with-the-pen-tool.html) and [path preview](https://helpx.adobe.com/uk/illustrator/desktop/draw-shapes-and-paths/draw-shapes/preview-paths-drawn.html) | Official Illustrator guides; updated 2026-02-25 / 2026-02-11, accessed 2026-09-13 | Preserve a live rubber-band curve, visible close affordance, and keyboard-independent pointer semantics in Varve's touch toolbar. | Illustrator's modifier-key and exact handle conventions are not copied wholesale. |

## Complaint-derived, realistically fixable failures

These issue reports identify failure modes, not universal compatibility facts:

| Reported failure | Varve fix or decision | Evidence boundary |
|---|---|---|
| [Excalidraw #9705](https://github.com/excalidraw/excalidraw/issues/9705): two-finger gestures drawing stray lines, palm/pen confusion, missing last segments | Per-pointer ownership; second touch cancels only the provisional owner; navigation contacts never enter tools; Pencil retains dynamics-only/final samples. | Synthetic and unit coverage first; physical palm behavior remains pending. |
| [Excalidraw #138](https://github.com/excalidraw/excalidraw/issues/138): second pointer should abort a provisional tap/gesture | Explicit policy returns the owner ID; no global undo is used to repair the document. | Tool-specific transaction behavior is tested; browser capture still needs E2E. |
| [Excalidraw #7764](https://github.com/excalidraw/excalidraw/issues/7764) / [#6088](https://github.com/excalidraw/excalidraw/issues/6088): pen/finger separation and palm complaints | Active pen suppresses foreign touch/compatibility input; unknown pointers follow a reversible user setting instead of a UA guess. | Suppression heuristics are not advertised as perfect palm rejection. |
| [Excalidraw #7763](https://github.com/excalidraw/excalidraw/issues/7763): pressure preference ambiguity | Settings expose pressure enablement and curve; default/constant data is reported as unknown rather than “pressure supported”. | A real USI pressure curve still needs hardware evidence. |
| [Excalidraw #5281](https://github.com/excalidraw/excalidraw/issues/5281) / [#7668](https://github.com/excalidraw/excalidraw/issues/7668): eraser-end/device differences | Eraser uses active `buttons` as well as the transition `button`; route capabilities remain observed/unknown. | No eraser-end claim is made for WebKitGTK or the Duet until observed. |

## Root-cause matrix

| Reproduction / evidence | Expected | Previous actual/root cause | Fix / regression |
|---|---|---|---|
| Second touch after a touch drawing contact | Cancel only the provisional drawing contact; two contacts navigate; no history entry | Adapter passed the **new** finger's event to `handlePointerCancel`, while one global active pointer was overwritten | `inputPolicy.ts` per-pointer map and owner-ID cancellation; `drawing-input.spec.ts` |
| Foreign touch during pen stroke | Pen remains owned; touch does not pan or cancel | No canonical pointer ownership in the adapter; Pen had no ID-aware cancel override | Pen owner ID + ignored foreign contacts; Pen unit/E2E coverage |
| Pen capture lost/blur/pointercancel | Idempotent abort of active contact; open path draft keeps its semantics | Pen did not release capture on normal up and inherited a cancel path that did not know its pointer | Pen lifecycle methods; capture-loss/focus paths in adapter |
| Draft update between pointerdown and pointerup | The same contact must remain owned through a React rerender | Native-listener effect cleanup cleared the ownership map when the first draft update rerendered the canvas | Ownership cleanup now follows hook unmount; the Pen close E2E reproduces and guards this path |
| Same coordinate/time, changed pressure/buttons | Preserve both samples | Coalesced parent dedupe compared only x/y/time; canonical key did the same | Dynamics-aware equality/key and throwing API fallback; normalizer tests |
| Pen eraser held after transition | Active eraser state stays true | Checked only `button === 5` | `buttons` bitfield and optional `eraserButtons` support; normalizer test |
| Default `.5` pen sample | Capability remains unknown | One positive reading was treated as genuine stylus data | Conservative `hasGenuineStylusData` and observed capability state |
| Pen/Pencil zero pressure/final endpoint | Preserve valid zero and small final movement; taps remain taps | Pencil substituted `.5` for every zero and discarded sub-pixel/final stationary dynamics | Preference-aware pressure and force-final-without-duplicate rule; Pencil tests |
| User cannot choose one-finger policy | Reachable touch/mouse control | Policy was implicit and one-finger touch always entered the active tool | Settings > Drawing Input; local-first `drawingInput` section |

## Capability matrix

| Route / target | Touch draw/navigation | Pen recognition | Pressure/tilt/twist/eraser | Rendering/input evidence | Status |
|---|---|---|---|---|---|
| Chromium tab, automated | Synthetic pointer routing; user setting; pinch path retained | Synthetic `pointerType` only | Normalizer preserves fields; observed capability starts unknown | Existing Canvas2D/worker path plus focused E2E/screenshots | Focused Chromium tests passed; not hardware certification |
| Installed PWA | Stage 2's served `/try/` artifact passed install/offline/update lifecycle checks; same drawing implementation and local-first storage | Same web API fields; no physical pen recognition claim | Not separately tested on an installed physical window | PWA artifact and export checks passed; installed-window geometry/input remain pending | Automated artifact checks passed; physical run pending |
| Tauri Linux ARM64/Crostini | Adapter can fall back to unknown/default policy | System WebKitGTK behavior is runtime-specific | Pressure/tilt/eraser unknown until actual WebKitGTK + device run | Tauri uses system WebKitGTK; no ARM64 package or pressure claim inferred | Pending/manual |
| Windows/macOS/non-Chromium | Existing repository regressions remain required | No new certification from this change | Route-specific observed capabilities required | No claim beyond tests actually run | Pending affected validation |
| Lenovo Duet 11M889 + USI Pen 2 | Required acceptance workflow documented below | Must record events actually observed | Must test pressure range, tilt/twist, barrel/eraser, hover and palm | Must record CSS viewport/DPR/usable canvas and route | Hardware unavailable/pending |

## Validation and visual evidence

Required loop: reproduce → inspect event/code → failing regression → implement →
affected tests → open screenshots/recordings/exports → compare state/performance.

The focused Chromium ownership run on isolated port 1495 passed 3/3 tests:
second-finger cancellation, foreign touch during a pen stroke, and the
post-pinch fresh-contact rule. The inspected `second-finger-cancel.png` shows
the empty canvas with no stray mark, stale draft, or added layer. The Pen
visual run on isolated port 1500 passed the close-target case; the inspected
`pen-close-target.png` shows two anchors, a live segment, and the highlighted
first anchor before closure. The live cubic-handle run also passed and was
inspected. These are browser-engine and synthetic-pointer results, not
physical pressure or palm-rejection evidence.

The real-DOM Pen touch-action regression on isolated port 2007 passed 1/1:
the toolbar exposed Close only after a second anchor, committed one closed
path through the active Pen tool, and removed the draft toolbar without a
global undo. This remains synthetic browser input; it does not certify a
physical touchscreen or stylus.

Two later attempts to run the same test with an attached toolbar screenshot
(ports 2011 and 2012) timed out in global setup before the editor loaded while
the shared machine was running many concurrent Playwright/Vitest/typecheck
jobs. They produced no screenshot and no test-body result; the screenshot is
not presented as visual evidence. The previously opened Pen live-handle,
multi-anchor, and close-target artifacts remain the inspected visual evidence.

The separate ChromeOS Stage 2 production-artifact run served `/try/` from a
disposable local origin and passed its three PWA checks: incomplete offline
setup showed a truthful unavailable page, a completed setup reopened the
editor offline, and a waiting update was offered rather than forced. Its
browser export checks also passed. Those results establish the PWA artifact's
service-worker/install lifecycle, not a physical ChromeOS installed-window
input result; the latter remains on the Duet checklist below.

## Performance method

The provisional 60 Hz budget is 16.7 ms per frame. Input handler time, sample
normalization, preview, authoritative rendering, finalization, and persistence
must be reported separately. JavaScript event timestamps and screen recordings
are not physical pen-to-photon latency. Before/after runs must use the same
fixture, browser/runtime, viewport, DPR, and event sequence; p50/p95/p99 are
reported where the sample count makes them meaningful. This patch keeps the
existing coalesced pointermove baseline and does not introduce a raw-event
stream or speculative worker path.

The normalizer benchmark compares the old identity-only key with the
dynamics-aware key on the same generated packet sets. In the Node run, the
current implementation measured mean canonicalization times of 4.125/0.977/
3.177 ms for 64/256/1024-sample packets, versus 0.404/0.544/1.902 ms for the
identity-only comparison in that run. The extra work is
the cost of retaining pressure/contact dynamics; it is bounded to the input
packet and does not change committed artwork. These figures are JavaScript
benchmark results, not ARM/Mali frame or pen-to-photon measurements.

## Physical acceptance checklist

On the real Duet, with keyboard attached/detached and in portrait/landscape,
split-screen, external display, browser zoom, display scaling, browser tab,
installed PWA, and Linux/Crostini separately:

1. Record actual CSS viewport, DPR, display scale, usable canvas, and OSK state.
2. Create a document; select Pencil/Pen/Paint; draw taps, slow diagonals, fast
   curves, loops, corners, long strokes, and variable-pressure marks.
3. Put a finger down before and after the pen; add a second finger during a
   stroke; pinch then lift one finger; move the pen across a toolbar; release
   outside the canvas; trigger capture loss/blur if reproducible.
4. Adjust color/size/pressure settings, pan/zoom with touch and trackpad, edit
   and close a path, erase the intended target, undo/redo, save, reopen, and
   export. Confirm one ordinary stroke is one undo step and no provisional or
   predicted point is serialized.
5. Record observed `pointerType`, pressure range, tilt/twist/eraser/button
   fields, cancel/capture events, frame/finalization timing, battery/memory
   behavior, and limitations. Do not infer absent capabilities from the pen
   product name.
