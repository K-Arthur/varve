# Canvas navigation quality record — 2026-09-13

Status: implementation checkpoint on `master`. This record covers navigation
and input work separately from the renderer-responsiveness and drawing-input
audits. Documented capabilities, observed code, measured behavior, and
hypotheses are labelled separately.

## Baseline, ownership, and scope

- Repository: `K-Arthur/varve`; working branch: `master`.
- Mission baseline SHA recorded before this work:
  `49415316b128e9e962da9a83950a405cffb57c0f0`.
- Navigation checkpoints include `941479cc2` (rotated pinch anchors),
  `f9aa74979` (shared moving-anchor helper), `d03723021` (canonical zoom
  entry), `7f95ddbd4` (rotated fit return contract), and `d9e154abd`
  (explicit Hand-tool keyboard pan). The current `HEAD` may also contain
  unrelated concurrent work; it is not a clean release snapshot.
- This slice owns pointer/wheel normalization, camera math used by navigation,
  navigation preferences, and focused browser/unit checks. The rendering
  coordinator, worker presentation, CanvasArea/Shell hubs, and website-wide
  responsive layout remain with their existing owners.

No document geometry is rewritten by navigation. View changes commit through
the existing camera path, are local view state, and do not create artwork undo
entries or mark the artwork dirty.

## Prioritized issue matrix

| Priority | Reproduction / symptom | Evidence and root cause | Fix / owner | Regression evidence |
|---|---|---|---|---|
| P0 | Fit a many-image document, then pan while a worker frame is pending; old image pixels can remain visible or smear. | Existing render documentation and the `many-image-render` oracle identify asynchronous worker refusal after the surface was painted as the cause. Frame-rate counters cannot detect it. | Synchronous worker admission and authoritative main-thread fallback in the existing render owner; no new pixel-reuse path was added here. | Run `window.__varvePerf.forceFullRedraw()` at the same camera and compare hashes; the oracle remains the required gate. |
| P1 | Zoom or fit in a rotated view, then interact with ZoomTool or pinch. The focal point/fit can be solved with rotation-blind math. | ZoomTool, fit actions, and pinch did not consistently carry active rotation or a moving screen anchor. | Shared `fitBoundsCameraWithRotation`, `centerBoundsCameraWithRotation`, `zoomAboutPoint`, and `placeWorldPointAtScreen`; ZoomTool and viewport actions use the canonical camera. | Shared viewport tests, ZoomTool tests, viewport-ops tests; focused E2E still required for browser pixels. |
| P1 | Enter fractional or extreme zoom; displayed range and camera limits disagree, or an unrelated rerender overwrites an edit. | Shared limits are 0.1%–6400% while the old field contract was narrower; draft state was coupled to unrelated state updates. | One validated field contract (`0.1`–`6400`%, finite fractional values, Enter/blur commit, Escape cancel) routed through canonical actions. | StatusBar tests and the existing UI action path. |
| P1 | Native WebKit gesture events arrive with a moving pinch centroid while Pointer Events also arrive for the same contacts. Artwork drifts or zooms twice. | Native gesture scale is cumulative; Pointer Events are incremental. A fixed centroid or dual ownership causes drift/duplication. | Native gesture owns touch contacts until `gestureend`; it captures a world anchor at start and uses `placeWorldPointAtScreen` as the centroid moves. Cleanup is scoped and idempotent. | Rotated/moving-anchor viewport tests; native path remains runtime/device-pending. |
| P1 | Users need a non-drag way to traverse the canvas without stealing arrows from text, panels, or object editing. | Existing arrows belong to selection nudge and specialized controls. A global arrow binding would regress editing and accessibility. | Arrow/Shift+Arrow pan only when Hand is active, including temporary Space-Hand, in CSS pixels; other contexts retain their owner. | `inputPipeline.test.ts`; browser keyboard E2E is required. |
| P2 | Fast or ambiguous wheel input gets application momentum layered over OS momentum, producing sticky/doubled travel. | Browsers expose `deltaMode`/deltas, not a universal device identity. Sequence classification must remain conservative. | Existing sequence classifier remains the owner; unknown and trackpad sequences are direct-only. Settings now bind sensitivity, pan/zoom policy, and optional detented-mouse continuation. | `wheelClassifier.test.ts`, settings normalization tests, browser wheel sequence E2E. |
| P2 | Adaptive preview is mistaken for final quality, or users cannot opt into full-resolution movement. | Renderer already has adaptive interactive scale and settled full-resolution promotion; no user override existed. | Existing Performance settings expose Automatic vs Full interactive preview. Exports remain authoritative regardless of this setting. | Settings tests plus render oracle/visual comparison. |

## Coordinate and gesture contract

The shared camera uses CSS-pixel pan, document/world coordinates, optional view
rotation, and a separate DPR boundary. The invariant tested by the shared
helpers is:

```text
worldAnchor = inverse(oldCameraMatrix) × oldAnchorCSS
newCameraMatrix × worldAnchor = newAnchorCSS
```

For a fixed pointer, old and new anchors are the same CSS point. For a native
pinch, the world anchor is captured once and the CSS anchor follows the current
centroid. Zoom is clamped before translation is solved. Pan remains fractional;
screen-space thresholds and keyboard travel are not divided by zoom. The
floating-origin function remains zero until scene geometry, shaders, overlays,
hit testing, caches, and native/browser boundaries can be rebased atomically.

Supported camera limits are `0.001`–`64` (`0.1%`–`6400%`). The zoom field, menu
actions, wheel, pinch, ZoomTool, fit/reveal, and minimap must use those limits
rather than maintaining a second range.

## Input ownership decisions

- Plain wheel pans in both axes; Shift+vertical wheel is horizontal pan;
  Ctrl/Cmd+wheel is zoom in the standard policy. DOM line mode uses the
  explicit 16 CSS-pixel application policy and page mode uses the element's
  client height. No wheel delta is rounded.
- A sequence classifier can identify mouse, trackpad, or unknown, but unknown
  remains usable direct manipulation and receives no application inertia.
  Trackpad momentum is not replayed by Varve. Users can disable the optional
  mouse continuation or select an explicit pan/zoom policy in Settings.
- Two touch contacts own navigation. A provisional tool interaction is
  cancelled only for its pointer; no global undo is invoked. A remaining
  contact after a pinch stays navigation-owned, so it cannot unexpectedly
  start a stroke. Pen ownership suppresses foreign touch/compatibility contacts.
- Keyboard pan is narrow: Hand or temporary Space-Hand plus Arrow/Shift+Arrow.
  Select, text editing, fields, sliders, trees, guides, and specialized tools
  retain their existing arrow semantics. IME composition and browser/OS-
  reserved shortcuts remain outside the canvas claim.
- Blur, hidden-window reset, pointer cancellation, lost capture, unmount, and
  native gesture end clear owned transient state. Normal capture release is
  not treated as unexpected cancellation.

## Settings and persistence

The existing Settings dialog exposes:

- Finger/unknown contact: draw or navigate.
- Wheel behavior: Standard, Always pan, or Always zoom.
- Wheel sensitivity: bounded `0.25×`–`4×`, default `1×`.
- Optional detented mouse-wheel continuation, with trackpad/unknown input
  remaining direct-only.
- Interactive preview quality: Automatic or Full resolution while navigating.

Settings are local-first and normalized on load. Runtime mirrors avoid
localStorage reads in wheel/frame hot paths and are refreshed by the existing
settings controls. View state remains separate from authored document state and
artwork history.

## Research ledger (accessed 2026-09-13)

| Source | Documented finding | Decision or uncertainty |
|---|---|---|
| [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/) | Pointer capture, cancellation, coalesced events, predicted events, and `touch-action` are lifecycle contracts; hardware feel is not specified. | Implement ownership against pointer lifecycle; do not claim physical palm rejection from DOM tests. |
| [MDN `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) | UA panning/zooming is decided from the gesture-start intersection; late changes cannot reliably reclaim a gesture. | Keep canvas touch policy stable and cancel only the owning draft. |
| [MDN `WheelEvent`](https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent) | `deltaMode` is pixel/line/page; wheel events do not universally equal scrolling and can represent zoom gestures. | Normalize units explicitly, preserve fractions, and use one semantic Ctrl/Cmd-wheel path. |
| [Chrome aligned input](https://developer.chrome.com/blog/aligning-input-events?hl=en) | Continuous input may be aligned/coalesced to rendering; `getCoalescedEvents()` preserves samples where drawing needs them. | Navigation may coalesce camera work, but drawing samples stay separate. |
| [Chrome browser scrolling pipeline](https://developer.chrome.com/blog/inside-browser-part4/) | Compositor scrolling and main-thread work can differ; callback count does not prove fresh pixels were displayed. | Use presented-content age and the full-redraw oracle, not FPS alone. |
| [Chrome timer/rAF behavior](https://developer.chrome.com/blog/timer-throttling-in-chrome-88) | `requestAnimationFrame` follows refresh scheduling and can pause/throttle when hidden. | Use elapsed-time physics with bounded deltas and stop/reseed on resume. |
| [Tauri WebView versions](https://v2.tauri.app/reference/webview-versions/) and [process model](https://v2.tauri.app/concept/process-model/) | Linux uses system WebKitGTK; Windows uses WebView2; macOS uses WKWebView; boundaries are route-specific. | Chromium evidence cannot certify the installed desktop app. |
| [WebKitGTK 2.52 release](https://webkitgtk.org/2026/03/18/webkitgtk2.52.0-released.html) | The installed family has accelerated Canvas2D/async scheduling work, but application acceleration needs end-to-end verification. | Keep Canvas2D fallback and treat native pinch bridge as device-pending. |
| [Playwright Touchscreen](https://playwright.dev/docs/api/class-touchscreen) and [touch events](https://playwright.dev/docs/touch-events) | Automation is limited and dispatched events are untrusted; it is not a pen, multitouch, or palm-rejection emulator. | Label synthetic touch/pen checks and keep physical lanes pending. |
| [WCAG 2.2 target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | Frequent controls need usable target size/spacing. | Keep keyboard-free view controls and existing target-size audits. |

First-party editor workflows were checked for the existence of Hand/Zoom,
focal zoom, touch workspace, and keyboard alternatives in [Adobe Illustrator
tools](https://helpx.adobe.com/illustrator/using/tools-in-illustrator.html),
[touch workspace](https://helpx.adobe.com/illustrator/using/illustrator-touch-workspace.html),
and [viewing artwork](https://helpx.adobe.com/ca/illustrator/using/viewing-artwork.html).
These informed discoverability only; Varve retains its own ownership and
shortcut choices.

## Real complaints checked and realistic responses

These are failure reports, not claims that Varve reproduced them:

| Reported failure | Realistic Varve response |
|---|---|
| [tldraw stylus interrupted by multitouch](https://github.com/tldraw/tldraw/issues/7846) and [pinch during selection drag](https://github.com/tldraw/tldraw/issues/10395) | Explicit per-pointer ownership, pen priority, scoped provisional cancellation, and no post-pinch stroke reuse. |
| [tldraw PNG artifacts while scrolling](https://github.com/tldraw/tldraw/issues/8482) | Keep worker/partial-paint reuse as a loan only when synchronous admission proves an authoritative replacement is coming; otherwise replay. |
| [Excalidraw touch metadata/gesture friction](https://github.com/excalidraw/excalidraw/issues/9705) and [Wacom zoom/pan stuck state](https://github.com/excalidraw/excalidraw/issues/8476) | Stable touch policy, pointercancel/lost-capture cleanup, route separation, and visible non-gesture controls. |
| [Excalidraw palm rejection concern](https://github.com/excalidraw/excalidraw/issues/6088) | Do not promise OS palm rejection; suppress foreign contacts while pen owns the stroke and require device verification for the rest. |
| [Excalidraw zoom recovery request](https://github.com/excalidraw/excalidraw/issues/1399) | Keep fit/reveal/100%/status field/minimap recovery on the canonical camera and preserve view persistence. |
| [Illustrator zoom freeze report](https://community.adobe.com/questions-652/illustrator-freezes-when-zooming-on-windows-1548827) and [wheel lag report](https://community.adobe.com/questions-652/windows-mouse-wheel-causes-lag-after-first-save-or-share-button-818032) | Bound in-flight work, coalesce latest camera state, defer optional work during navigation, and expose opt-in diagnostics. |

## Runtime/device matrix and claim boundaries

| Route/device | Evidence in this workspace | Remaining lane |
|---|---|---|
| CachyOS Linux desktop, Wayland primary | Repository/toolchain and WebKitGTK development dependencies are present; browser/unit paths are runnable. | Physical Wayland trackpad pinch, pen, and native Tauri bridge still need manual capture. |
| Chromium browser/compatibility route | Playwright Chromium is installed; synthetic wheel/pointer/keyboard checks are valid browser-engine checks. | Not proof of ChromeOS hardware feel or native WebKitGTK. |
| Tauri desktop/WebKitGTK | Source bridge and route contract inspected; Canvas2D fallback remains available. | Native launch/pinch/presentation evidence must be run in the installed desktop app. |
| Lenovo Chromebook Duet reference | Repository audit records Lenovo Duet 11M889, 8 GB/128 GB, Kompanio 838/Mali-G57 MC3, 1920×1200; 4 GB-class coverage is separate. | Exact current SKU, free memory, ChromeOS/browser version, CSS viewport/DPR, and physical input require the device. |
| Crostini/Debian ARM64 desktop | Correctly treated as a distinct Linux/WebKitGTK route, not ChromeOS Chrome. | ARM64 package/runtime availability, scaling, multitouch, and pressure are pending. |
| Windows/WebView2, macOS/WKWebView, X11, PWA, Firefox/Safari | Contract documented from route-specific platform sources. | No local runtime evidence; claims remain pending. |

## Measurements and visual evidence

Measurements use browser timestamps and test-run timings; they are not
touch-to-photon measurements. No percentile is reported because these focused
runs are correctness tests, not sufficiently sampled controlled navigation
benchmarks. The shared host was running many compilers, Vitest, Playwright,
and architecture jobs, so startup durations are not frame-budget baselines.

| Check | Result | Interpretation |
|---|---|---|
| Navigation correctness closure | 7 files, 157 tests passed; 416.92 s wall time under contention | Camera, viewport actions, pointer/wheel policy, ZoomTool, settings, and Settings UI checks passed. Wall time is not a product frame budget. |
| Targeted Biome check | 14 navigation source files clean | Formatting/import contracts passed for the input, camera, settings, and render preference slice. |
| Settings E2E source check | 1 file clean | The real Settings workflow is formatted and type-checked separately from the unit UI suite. |
| Website production build | 100 routes built; 1m16s; exit 0 | The updated canvas, keyboard-shortcut, and touch documentation routes compile in static output. |
| Website canvas browser E2E | 1 test passed; 18.0 s; exit 0 | Desktop and mobile responsive copy/layout assertions passed; both screenshots were inspected. |
| Editor navigation browser E2E | Hand keyboard pan and stationary edge auto-pan passed in the broad run; 2 other tests failed in setup and 6 did not run | Real DOM canvas routing and artwork/document invariants passed for the two completed workflows. The failures were setup timeouts under concurrent Vite/Playwright load, not assertion failures. |
| Partial-redraw visual oracle | 3 tests failed before rendering because Vite could not resolve a concurrently moved `SpecPanel/export` module | This is an environment/worktree race, not a passing oracle; it remains a required retry before claiming stale-pixel coverage. |

Completed visual loop for the Hand/auto-pan slice: reproduce the gesture in the
real editor DOM, capture before/moving/settled states, open the screenshots,
and verify artwork movement, selection-overlay alignment, unchanged layer
count, and no checkerboard/smear. The inspected artifacts are
`test-results/var/tmp/varve-nav-final/e2e-results/canvas-input-navigation-Na-156ed-thout-changing-the-document-chromium/navigation-before.png`,
`navigation-after-right.png`, and `navigation-settled.png`.

The website canvas E2E likewise captured and inspected desktop/mobile output.
Wheel pan, Ctrl/Cmd-wheel zoom, rotated ZoomTool/pinch, minimap/fit, and the
settled optimized-vs-authoritative surface hash still require a clean targeted
browser run. The partial-redraw oracle attempt was blocked before the harness
loaded by a concurrent missing-module race, so it is not represented as
evidence. Existing artifacts from concurrent Stage 3 validation are under
`/tmp/varve-chromeos-stage3-visual/`; this record does not represent them as
physical-device evidence.

## Exact remaining limitations

- Physical Chromebook touchscreen, USI pen, detachable trackpad, ChromeOS
  reserved-shortcut dispatch, PWA install behavior, Crostini ARM64, Tauri
  WebKitGTK native pinch, Windows WebView2, and macOS WKWebView are not
  certified by local synthetic tests.
- The existing render worker/oracle and presentation-age work remains the
  authority for stale-pixel and sustained-load correctness. This slice did not
  replace that scheduler or claim a universal 60/120/144 Hz result.
- Native gesture bridging depends on WebKitGTK emitting a usable page-zoom
  notification. The web payload is validated, but physical gesture cadence is
  pending.
- Browser rAF, screenshot capture, software GPU, CPU contention, and
  Playwright input are proxies. They must not be described as display latency,
  physical palm rejection, or Duet certification.
