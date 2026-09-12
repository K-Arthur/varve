# ChromeOS Stage 4 audit: responsive workspace, input, accessibility

**Status:** in progress — implementation and evidence appended as milestones land
**Research access date:** 2026-09-12
**Repository snapshot:** `c4e16a7f763887b2f1feb64a20e7c5c621da307e`
**Device reference:** Lenovo Chromebook Duet 11M889, 8 GB primary target
**Ownership record:** [`chromeos-stage4-ownership.md`](../agents/chromeos-stage4-ownership.md)

This document separates vendor/spec research, repository implementation,
measured test evidence, and device-only hypotheses. No real Duet was available
during this stage; device items are listed as unverified handoffs.

## 1. Research ledger

| Question | Primary source and date | Finding and confidence | Implementation consequence | Unresolved conflict |
|---|---|---|---|---|
| What input model should the editor code against? | [Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/), W3C Recommendation 2026-06-30, accessed 2026-09-12 | Unified `pointerType` (`mouse`/`pen`/`touch`), `pressure` (active hardware without pressure reports `0.5`), `tiltX/tiltY`, `twist`, `altitudeAngle`/`azimuthAngle`, coalesced and predicted events, and explicit `pointercancel` suppression rules. `touch-action` — not `preventDefault()` on pointer events — governs UA pan/zoom. **High** | Keep `tools/inputNormalizer.ts` as the single normalization point; keep `touch-action` scoped to the canvas; never synthesize a session-wide "input mode". | Whether the Duet's USI stack reports tilt/twist/altitude at all is unmeasured. |
| What is the minimum target size requirement? | [Understanding SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), W3C WAI, updated 2026-05-11, accessed 2026-09-12 | AA requires 24x24 CSS px per target, with a spacing exception (24 px-diameter circles must not intersect); 44 px is a best practice, not the AA minimum; the requirement is zoom-independent. **High** | Keep the project's 44 px coarse-pointer goal, but validate the hard floor at 24x24 for dense chrome and record spacing where undersized. | None. |
| May dragging be the only way to do something? | [Understanding SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html), W3C WAI, updated 2026-08-10, accessed 2026-09-12 | Every drag-operated function needs a single-pointer, non-drag alternative (G219); an equivalently functioning separate control is acceptable. **High** | Verify move/resize/marquee/guide-drag paths expose non-drag alternatives (nudge, inspector fields, tap-to-place where present); long-press menus already cover right-click-only actions. | Object resize on touch may still be drag-only; inspector numeric fields are the intended equivalent and need a test. |
| May pinch be the only zoom path? | [Understanding SC 2.5.1 Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html), W3C WAI, updated 2026-08-10, accessed 2026-09-12 | Multipoint/path-based gestures need a single-pointer alternative; pinch zoom must be complemented by buttons or fields. **High** | Existing StatusBar zoom field, menubar zoom input, keyboard zoom, and Zoom tool provide the alternative; keep them reachable at tablet widths. | None. |
| How does the virtual keyboard change viewports, and how do we adapt progressively? | [VirtualKeyboard API](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API), MDN, last modified 2025-11-06; [Full control with the VirtualKeyboard API](https://developer.chrome.com/docs/web-platform/virtual-keyboard/), Chrome for Developers, updated 2021-09-09; [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport), MDN, last modified 2026-08-12; all accessed 2026-09-12 | The OSK shrinks the visual viewport without changing the layout viewport. Chromium 94+ exposes `navigator.virtualKeyboard` (`overlaysContent`, `boundingRect`, `geometrychange`) and `keyboard-inset-*` env vars; Firefox/Safari do not. VisualViewport (`resize`/`scroll`, `height`, `offsetTop`, `scale`) is widely available and is a usable fallback signal. **High** for Chromium; **Medium** for non-Chromium fallback completeness | Publish an inset as CSS custom properties only when measured; treat the VirtualKeyboard API as an enhancement, compute from VisualViewport otherwise, and do nothing when neither is present. Never block text editing on OSK detection. | Headless/browser tests cannot prove real OSK behavior; Duet run required. `interactive-widget` behavior in the installed PWA vs tab is unmeasured. |
| What does ChromeOS itself require from keyboard and trackpad handling? | [Chromebook keyboard shortcuts](https://support.google.com/chromebook/answer/183101?hl=en), Google, current page accessed 2026-09-12; [Use your Chromebook touchpad](https://support.google.com/chromebook/answer/1047367?hl=en), Google, current page accessed 2026-09-12 | OS-reserved combinations include `Ctrl+1`-`Ctrl+8` (tab switching), `Ctrl+0`-reset page zoom only via browser, `Ctrl+Shift+B` (bookmarks bar), `Alt+=`/`Alt+-` (maximize/minimize), `Ctrl+Shift++/-/0` (screen resolution), `Alt+[`/`Alt+]` (dock), `Search`/`Launcher` combinations, three-finger swipes (tabs/overview), two-finger tap (right-click), `Alt+click` (right-click alternative). **High** | Document conflicts in the behavior matrix; ensure no essential editor action is only reachable through an OS-reserved combination; keep pointer alternatives for chorded modifiers. | The Duet's French/English layout uses different dead-key and AltGr behavior than the fetched US page; unverified. |
| Which browser/OS version is the reference? | [Stable Channel Update for ChromeOS](https://chromereleases.googleblog.com/2026/09/stable-channel-update-for-chromeos_0586661566.html), Google Chrome Releases, 2026-09-08; [Chrome two-week release cycle](https://developer.chrome.com/blog/chrome-two-week-release), Chrome for Developers, 2026-03-03 | ChromeOS stable is OS 16765.41.0 / browser 152.0.7977.113 (2026-09-08). Chrome moves to a two-week cycle from Chrome 153 (2026-09-08). The VirtualKeyboard API (94+) and VisualViewport are available. **High** | Guidance targets Chromium 152 behavior; do not depend on newer Canary-only APIs or on non-Chromium virtual-keyboard APIs. | Duet's exact channel/build and whether it has already moved to 152 is unverified until the device run. |
| How do we emulate the target matrix honestly? | [Emulation](https://playwright.dev/docs/emulation), Playwright, current page accessed 2026-09-12 | Playwright can set `viewport`, `deviceScaleFactor`, `hasTouch`, `isMobile`, `colorScheme`, `locale`, and can dispatch touch through `page.touchscreen`; Chromium CDP can dispatch mouse/pen events with `pointerType`, `force`, `tiltX/tiltY`. **High** for emulation mechanics; **none** for hardware fidelity | Use explicit emulated viewports and CDP touch/pen events for regression coverage, and label every such result as synthetic. Real OSK pressure/palm/latency stays a device checklist. | CDP pen emulation does not exercise the USI digitizer or ChromeOS palm heuristics. |

Research was performed before implementation selection. A focused re-check is
required before any future decision that changes PWA display mode, browser
support tiers, or input semantics.

## 2. Repository implementation at the snapshot

The input core already exists and is documented by
[`input-system-behavior-matrix.md`](../architecture/input-system-behavior-matrix.md):

| Area | Implementation | Evidence |
|---|---|---|
| Pointer normalization | `packages/editor/src/tools/inputNormalizer.ts` — canonical events, coalesced/predicted handling, genuine-stylus detection, canonical ordering | unit tests `tools/__tests__/inputNormalizer.test.ts` |
| Navigation gestures | `packages/editor/src/canvas/navigationState.ts` + `inputPipeline.ts` — explicit touch-pan/touch-pinch/wheel states, pointer cancel/blur resets | `navigationState.test.ts`, `inputPipeline.test.ts`, E2E `canvas/input-navigation.spec.ts` |
| Wheel/trackpad classification | `canvas/wheelClassifier.ts`, `canvas/wheelGesture.ts` — detented vs high-resolution wheels, ctrl+wheel pinch signal, no double momentum | `wheelClassifier.test.ts`, `wheelGesture.test.ts` |
| Touch multi-select | `floating-toolbar` toggle (`state.touchMultiSelect`), SelectTool marquee suppression | E2E and unit tests |
| Long-press context | SelectTool long-press for touch/pen opens deep-selection menu | `tools/SelectTool.ts` (`LONG_PRESS_MS`) |
| Drag threshold | `BaseTool.DRAG_THRESHOLD_CSS_PX = 3` screen-space (CSS px), not zoom-scaled | `tools/__tests__/dragThreshold.test.ts` |
| Responsive drawers | `Shell.tsx` + `editor.css` `@media (max-width: 899px)` — panels become focus-trapped drawers with backdrop and focus return | E2E `a11y/responsive-panels.spec.ts` |
| Coarse-pointer sizing | `--touch-target-min: 44px` used by FABs, workspace dock, floating text bar, shared UI controls | CSS; not yet measured at the WCAG floor |
| Reduced motion | `context/reducedMotionManager.ts`, honor `prefers-reduced-motion` without deleting authored animation | unit/context tests |
| Adaptive profiles | `canvas/adaptiveProfile.ts` — frame-timing-driven tiers with hysteresis; capabilities cached | `adaptive-residency` E2E + unit tests |
| Canvas geometry under DPR/zoom | `canvas/canvasSurface.ts` — ResizeObserver + VisualViewport subscriptions, anchor-preserving resize | `canvasSurface.test.ts`, `responsive-geometry.spec.ts` |

## 3. Confirmed gaps this stage addresses

1. **No virtual-keyboard / visual-viewport inset model.** The only
   Viewport consumers were canvas geometry subscriptions; no surface adapted
   to an OSK, and no `keyboard-inset-*` usage existed. Fixed by
   `canvas/keyboardInset.ts` + a document-level CSS-variable publication,
   dialog/toast/FAB adaptation, and a visual-viewport clamp in
   `FloatingPortal` (commit `1952bc945`).
2. **No emulated device-matrix acceptance test.** Responsive coverage was a
   single 640x700 drawer test; nothing asserted overflow/target geometry at
   the requested CSS sizes, touch gestures, or pen events. Added
   `tests/e2e/interaction/chromeos-device-matrix.spec.ts` (13 tests, all
   passing on Chromium, commit `f76d98eb1`).
3. **Legacy `min-width: 600px` document floor** forced horizontal page drift
   in split-screen and at the 200%-zoom-equivalent width. Replaced with the
   320 CSS px WCAG reflow floor (commit `f76d98eb1`).
4. **Bottom chrome overlap:** drawer FABs covered floating-toolbar controls at
   every `<=899px` width because their offset assumed a fixed toolbar height.
   The toolbar now publishes its measured height and the FABs clear it in all
   workspaces, asserted in Design and Draw modes (commit `f76d98eb1`).
5. **Undersized compact chrome on coarse pointers:** menubar items, tabs,
   status-bar toggles, the zoom stepper, save/layout/debt badges, and the
   units select measured 12-22 CSS px. They now meet the 24x24 floor under
   `(pointer: coarse)` while their bars keep their heights (commit
   `f76d98eb1`).
6. **ChromeOS-reserved shortcut conflicts were undocumented.** Section 8 of
   [`input-system-behavior-matrix.md`](../architecture/input-system-behavior-matrix.md)
   now lists browser/OS-owned combinations, the touch/pen policy, the target
   policy, and the virtual-keyboard contract.

## 4. Acceptance plan

| Check | Method | Evidence required |
|---|---|---|
| No horizontal document drift at 960x600, 1200x750, 1280x800, 600x960, 800x1280, 480x640 | Playwright matrix spec, `documentElement.scrollWidth <= clientWidth + 1` | passing spec + inspected screenshots per viewport |
| Canvas keeps usable drawable size at each viewport | bounding box > minimum, renderer still paints | spec + screenshot inspection |
| Coarse-pointer targets >= 24x24 CSS px (44 px goal for primary controls) | measured bounding boxes of a fixed control list at 480x640 `hasTouch` | spec output + report table |
| Two-finger pinch zooms the canvas without changing page zoom | CDP `Input.dispatchTouchEvent` two contacts, assert zoom indicator/scale changes and `visualViewport.scale === 1` | passing spec |
| One-finger touch routes to the active tool (not pan) | touch drag with a creation tool, assert document mutation | passing spec |
| Pen pointer events preserve pressure and create a stroke | CDP `Input.dispatchMouseEvent` `pointerType:'pen'` with `force`, assert path exists and no page errors | passing spec (synthetic; device gap documented) |
| Keyboard inset publication and surface accommodation | unit tests for the pure model + E2E setting the variable and asserting floating surface offset | unit tests + passing spec |
| No uncaught errors during the matrix | Playwright `pageerror` collection | spec assertion |

## 5. Device-only verification (handoff, not claimed)

- [ ] Actual CSS viewport, `devicePixelRatio`, and ChromeOS display scaling in
      laptop/tablet, landscape/portrait, browser tab/PWA/Linux window,
      split-screen, and external display.
- [ ] Installed-PWA virtual keyboard: caret and commit/cancel controls remain
      visible; workspace restores after dismissal.
- [ ] USI Pen 2: pressure range, tilt/twist availability, eraser end, barrel
      button, hover, palm touches, rapid lifts, prediction on/off.
- [ ] Two-finger pinch/pan and trackpad pinch; no page zoom during canvas
      gestures; momentum does not double.
- [ ] ChromeVox focus/announcements; keyboard-only core flow; high-contrast
      and forced-colors states; reduced motion.
- [ ] French/English detachable keyboard: dead keys, AltGr, accent
      composition, virtual-keyboard editing of text nodes.

## 6. Evidence log

| Milestone | Command | Result | Artifacts inspected |
|---|---|---|---|
| Keyboard/visual-viewport model + floating UI clamp (`1952bc945`) | `pnpm exec vitest run packages/editor/src/canvas/__tests__/keyboardInset.test.ts packages/ui/src/components/overlayGeometry.test.ts packages/ui/src/components/FloatingPortal.test.tsx` | 37/37 passed | test output |
| Typechecks | `pnpm --filter @varve/ui typecheck`, `pnpm --filter @varve/editor typecheck`, `pnpm --filter @varve/desktop typecheck`, `pnpm typecheck:e2e` | all passed | compiler output |
| Responsive/input acceptance (`f76d98eb1`) | `VARVE_E2E_PORT=1494 VARVE_E2E_OUTPUT_DIR=stage4-final pnpm exec playwright test tests/e2e/interaction/chromeos-device-matrix.spec.ts --project=chromium --reporter=list` | 13/13 passed (3.8m) | Screenshots inspected: 960x600, 1200x750, 1280x800, 600x960, 800x1280, 480x640, 640x400 (200% equivalent). Under load one run hit a renderer `Target crashed`; the isolated rerun passed, recorded as environment flake. |
| Bottom-chrome clearance fix | `... -g "portrait-600x960\|portrait-800x1280\|split-480x640\|zoom200\|bottom chrome clearance"` | 4/5 passed; split-480 rerun passed alone | Screenshots show FABs clear of the toolbar at 480x640, 800x1280, 640x400; clearance test passes in Design and Draw |
| Floating toolbar unit tests | `pnpm exec vitest run packages/editor/src/components/FloatingToolbar/FloatingToolbar.test.tsx` | 9/9 passed | test output |
| Coarse-target measurements | `coarse-target-measurements.json` attachment from the passing run | after fixes: zero controls below 24x24 at 800x1280 | attachment + inspected screenshot |

Pre-fix measurements retained for the record: the coarse-target test first
failed with 13 undersized controls (menubar items 19.25px tall, tabs 18px,
status toggles/zoom 12-17.44px, save badge 20px, units select 22px); the
480x640 matrix first failed with `documentScrollWidth 600 > clientWidth 480`
caused by `html { min-width: 600px }`.

### Regression checks and known unrelated failures

- `tests/e2e/canvas/toolbar-layout.spec.ts` passed after the toolbar-height
  publication change.
- `tests/e2e/menus/overlay-reliability.spec.ts` has one failing subtest
  ("keeps menubar flyouts and context menus attached through real input"): the
  Logo submenu stays mounted after the first Escape. This is **not caused by
  Stage 4**: reverting the only overlay change (the `FloatingPortal` visual
  clamp) to its pre-Stage-4 content reproduces the identical failure, and all
  placement assertions in that test pass before the Escape step. The failure
  coincides with active uncommitted `Menubar.tsx` work (menu item additions and
  removal of `ContextAwareShortcuts`) by another writer; handed off in the
  ownership record.
- `pnpm verify:plan` over the Stage 4 commits escalates to full suite because
  other agents' interleaved commits in the same worktree include
  workspace/config changes; `pnpm verify:plan` over uncommitted files reports
  120 files that are not part of Stage 4. The targeted Tier 0-2 checks for the
  Stage 4 paths were run directly (above).
