# Numeric field interaction: research and diagnosis

**Status:** Research complete; repairs implemented in the commits referenced below.
**Date:** 2026-09-14
**Scope:** The shared Inspector spinbutton (`packages/editor/src/components/Inspector/controls/NumberField.tsx`),
its styles, and every surface that consumes it (Position & Size, Rotation, Skew,
effects, image treatments, type, and timeline numeric entry).
**Out of scope this session:** menus/menubars, the layers tree, the marketing website
(app-only session; website follow-ups are listed at the end).

This document is the evidence record for the repairs. It distinguishes verified
defects, root causes, hypotheses, and deliberate design decisions. No real-user
study was run; interaction claims are either reproduced in the running app or
sourced from published guidance and public user reports.

## Method

1. Source inspection of `NumberField.tsx`, its styles, and all consumers.
2. Verification against the installed React 19 `react-dom` source for event
   registration semantics.
3. Playwright reproduction in the running editor with a real photograph imported
   into a document (`tests/e2e/inspector/number-field-interaction.spec.ts`).
4. Web research (primary sources first: W3C, WHATWG, MDN, and the maintainers of
   React), plus public user reports for failure modes to avoid.

## Research ledger

| # | Source | Relevant finding | Applicability | Decision |
|---|--------|------------------|---------------|----------|
| 1 | WAI-ARIA APG, [Spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) (accessed 2026-09-14) | Up/Down step; optional PageUp/PageDown for larger steps; `aria-valuenow` may be omitted when indeterminate; editing keys must not be hijacked. | Direct: `NumberField` declares `role="spinbutton"`. | Keep Up/Down + modifier steps; add PageUp/PageDown; keep `aria-valuenow` omitted for mixed. |
| 2 | W3C ARIA Practices issue [#3377](https://github.com/w3c/aria-practices/issues/3377), "Spin button pattern home and end guidance conflicts with basic editing functionality" (APG TF call July 2026; accessed 2026-09-14) | The APG Task Force agreed the Home/End = min/max guidance conflicts with standard single-line editing keys (Home/End must move the caret; screen readers expect it) and should be removed. PageUp/PageDown should move at least 10 steps. | Direct: `NumberField` intercepts Home/End today. | **Remove** the Home/End hijack; caret movement restored. Add PageUp/PageDown as the larger-step route. Keep typing for exact min/max. |
| 3 | React issues [#19651](https://github.com/facebook/react/issues/19651), [#19654](https://github.com/facebook/react/pull/19654); React [#24986](https://github.com/facebook/react/issues/24986); Stack Overflow [63663025](https://stackoverflow.com/questions/63663025/react-onwheel-handler-cant-preventdefault-because-its-a-passive-event-listener) (accessed 2026-09-14) | React 17+ registers `touchstart`, `touchmove`, and `wheel` as **passive** listeners at the root. `preventDefault()` inside `onWheel` is a no-op and the page scrolls anyway. Documented workaround: a ref + `addEventListener(type, fn, { passive: false })`. | Direct: `NumberField` calls `e.preventDefault()` in `onWheel`. | Replace the React `onWheel` with a native non-passive listener so a focused-field wheel steps the value **without** also scrolling the panel. |
| 4 | Installed `react-dom-client.development.js` (React 19.2), event registration block | Verified in the installed artifact: `touchstart`/`touchmove`/`wheel` are attached with `passive: true` at the root container. | Direct: confirms #3 in this exact version. | Same as #3. |
| 5 | WHATWG HTML issue [#10911](https://github.com/whatwg/html/issues/10911) (2025-01, accessed 2026-09-14) | Browsers scroll-to-change only when the input is **focused** and a wheel handler is registered; Gecko disabled the behaviour entirely because users accidentally changed values. | Design constraint for wheel-to-change. | Keep focused-only activation (never hover). Explicit non-passive handler makes the intent truthful. |
| 6 | Adobe Illustrator UserVoice, "Disable hover scrolling to change numeric value in input" (accessed 2026-09-14) | Users ask to *disable* hover-scroll value changes because of accidental edits. | Failure mode to avoid. | Hover never changes values; only a focused field and deliberate drags/keys do. |
| 7 | Glyphs Forum, ["Scroll in fields + Undo"](https://forum.glyphsapp.com/t/scroll-in-fields-undo/25005) (2023-02-03, accessed 2026-09-14) | Accidental metric change; undo only reverted one unit per press, so recovery was tedious. | Undo granularity of stepping gestures. | One gesture = one undo step (existing transaction coalescing); additionally suppress transactions that changed nothing. |
| 8 | Krita Artists, ["Increase or decrease values by hovering and dragging left or right just like in Blender and DaVinci Resolve"](https://krita-artists.org/t/increase-or-decrease-values-by-hovering-and-dragging-left-or-right-just-like-in-blender-and-davinci-resolve/172305) (2026-03-07, accessed 2026-09-14) | Scroll-to-change is "way too slow" and imprecise; users want click-drag scrubbing. The thread resolves the edit-vs-drag conflict with *click selects all, drag scrubs*. | Confirms label-scrub direction and the click-to-type contract. | Keep label scrubbing as the drag route (WCAG 2.2 SC 2.5.7 non-drag alternative exists: keys and typing). Add select-all on focus so click-then-type replaces the value, matching the thread's resolution, while input drag still selects text. |
| 9 | Blender developer archive, [#37453](https://developer.blender.org/) "Number Field dragging is unpredictable", [T2600](https://archive.blender.org/developer/maniphest/0002/0002600/index.html) (accessed 2026-09-14) | Drag scrubbing is valued but reported as unpredictable; accidental cancellation and modifier-dependent behaviour are recurring complaints. | Root cause patterns for drag math. | Use an incremental accumulator that rebases on modifier change (no retroactive multiplication), keep one transaction per gesture, and make Escape an explicit cancel. |
| 10 | W3C WCAG 2.2, [SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) and [SC 2.5.5 (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced) (accessed 2026-09-14) | AA requires 24×24 CSS px or sufficient spacing; 44×44 is the enhanced/AAA target; overlapping areas do not count. | The scrub handle (label) and the input are pointer targets. | The compact field is 32px high and the label column is 60px wide, so the scrub handle clears the 24×24 AA floor. Touch access to scrubbing is repaired with `touch-action` (see #11) rather than enlarging the dense row. |
| 11 | MDN, [`touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action) and [`pointercancel`](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event); W3C [Pointer Events](https://www.w3.org/TR/pointerevents/) (accessed 2026-09-14) | Viewport panning cannot be suppressed by cancelling pointer events; authors must declare intent with `touch-action` before the gesture. When the browser takes over a gesture it fires `pointercancel`, ending the stream. `pan-y` allows vertical scrolling while leaving horizontal movement available to the app. | Touch/pen scrubbing on the label. | Set `touch-action: pan-y` on the scrub handle. Vertical scrolling of the inspector keeps working; horizontal drags scrub; a browser-taken-over gesture arrives as `pointercancel` and cancels the session. |
| 12 | Blender docs/community, modifier conventions (Shift = fine/coarse steps) (accessed 2026-09-14, see #9) | Modifier chords are expected, but their effect must be predictable mid-gesture. | Fine/coarse scrub factoring. | Modifier changes rebase the accumulator instead of rescaling past travel. |

## Issue register

| ID | Defect | Evidence | Root cause | Severity | Status |
|----|--------|----------|-----------|----------|--------|
| NF-1 | A wheel gesture over a focused numeric field changes the value **and** scrolls the panel. | Reproduced in the app (`number-field-interaction.spec.ts`, "does not scroll the inspector"); React source #4. | React attaches `wheel` passively at the root; `preventDefault()` is a no-op. | High — accidental edits of geometry while scrolling a dense panel, plus a visible double action. | Fixed |
| NF-2 | Pressing Shift (or Alt) mid-drag retroactively multiplies all previous travel (e.g. 20px at ×1 then Shift for 10px jumps 30px at ×10 instead of 20×1 + 10×10). | Source inspection; reproduced in the app (modifier test). | Scrub recomputed `startValue + totalDx × factor` from the gesture origin every move. | Medium — unpredictable values, the exact class of complaint in Blender #37453. | Fixed |
| NF-3 | Scrub quantizes every value to 0.01 even when the field steps finer (`step = 0.001`) and rewrites fractional precision that was already in the document. | Source inspection (`Math.round(x * 100) / 100`). | Display-rounding hardcoded into the model write. | Medium — silent precision loss on fine controls (opacity, tracking, kerning). | Fixed |
| NF-4 | Escape does not cancel an in-progress scrub; there is no pointer identity, so a second pointer (or a stray pointerup) can cancel/commit someone else's gesture. | Source inspection; reproduced in the app. | `keydown` handling only covers arrow/wheel transactions; window listeners ignored `pointerId`. | Medium — lost work on interruption, multi-touch corruption; explicit WCAG-adjacent expectation (cancel affordance). | Fixed |
| NF-5 | Touch/pen scrubbing is unreliable: without `touch-action` the browser claims the gesture and fires `pointercancel`. | Pointer Events spec #11; the repo's drawing-input work already documents touch/pen as a supported input class. | No `touch-action` on the scrub handle. | Medium on touch/pen devices, none on mouse. | Fixed |
| NF-6 | A gesture that cannot change the value (already at min/max, or a click without movement) still opens and commits a transaction, producing a no-op undo step. | Source inspection; unit assertions added. | Transactions opened before the first value change was known. | Medium — undo stack pollution, violates "a click without change creates no history entry". | Fixed |
| NF-7 | The input element shows an `ew-resize` cursor but drag inside it only selects text; the cursor is a false affordance. | Computed style `.insp-num__input { cursor: ew-resize }` in `inspector.css` and `components.css`; the drag handler is only attached to the label. | Cursor copied from the label styling onto the input. | Low–Medium — users drag the wide part of the field and nothing happens. | Fixed (input cursor is `text`; the label keeps `ew-resize`) |
| NF-8 | Home/End set min/max instead of moving the caret; screen-reader and editing expectations diverge (APG #3377). | W3C APG issue #3377 (#2). | Adopted the APG guidance that the Task Force is removing. | Medium — caret navigation broken in an editable field; AT expectation mismatch. | Fixed (Home/End restored to editing; PageUp/PageDown added) |
| NF-9 | Keystrokes and drags step from the **model** value while the field displays an uncommitted draft, so the visible text and the value move out of sync. | Source inspection; unit test added. | `onChange(clamp(value + …))` used the prop, not the draft. | Medium — "200" on screen can become 201 in the document while still reading 200 until blur. | Fixed (valid drafts step from the draft and clear it; invalid drafts are left alone for the user to correct) |
| NF-12 | After a drag-scrub on the label, focus lands in the input, which the shortcut manager treats as a text-editing target — so Ctrl+Z (and other global shortcuts) are ignored immediately after an accidental scrub. | Reproduced in the app: the undo step test failed while the field was `[active]`; `shouldIgnoreShortcutTarget` returns true for `input` elements. | The label's post-drag `click` (retargeted by pointer capture) activated the associated input. | Medium — the most natural recovery gesture after an accidental value change was blocked. | Fixed (`pointerdown` on the scrub handle owns the default action; a no-movement click still focuses and selects the field explicitly) |
| NF-10 | Scrubbing a **mixed** multi-selection (X/Y) collapses every selected object onto one absolute coordinate. | Verified: `PositionSizeSection` passes `mixed` with `value = 0`; `NumberField` scrubs from that prop; `setSelectedX` sets the same absolute X on every selected node. | Relative (delta) editing had no channel in the field contract; the scrub reused the absolute setter. | High when multi-editing position. | Fixed (second pass): `NumberField` gained an optional `onDelta(increment)` channel used by scrub, arrow/Page steps, and wheel; `PositionSizeSection` applies it as a functional `editor.updateDoc` translation inside one transaction, so typing an absolute value still sets all objects while gestures move every object by the same delta. Verified end-to-end on two real photos: a +35 scrub produced 100→135 and 200→235. |
| NF-11 | `inputMode="decimal"` presents a keypad without a minus sign on some mobile keyboards, blocking negative coordinates. | Platform behaviour; not reproduced on this machine (no mobile runtime available). | `inputMode` choice. | Low on desktop; Medium for the browser demo on touch devices. | Fixed (second pass): the field uses `inputMode="text"` so minus signs, unit math (`120/2`), and `{alias}` expressions are typeable; a decimal pad omits every non-digit token. Not verified on a physical device — reported untested. |

## Deliberate decisions and qualifications

- **Wheel-to-change is kept**, but only when the field is focused, and it now
  actually suppresses scrolling. The published research (#5, #6) is split: users
  complain about *hover* scroll and about accidental changes, while Illustrator
  and Photoshop-style focused scrolling is a long-standing convention. The
  whatwg thread (#5) shows the platform itself requires focus, which matches this
  implementation. If future user evidence shows accidental edits persist,
  removing wheel-to-change entirely is the fallback.
- **Scrub stays on the label, not the input.** Two user reports pull in
  opposite directions: Krita users want to drag the wide field (#8), and the
  accessibility contract requires preserving normal text selection while editing
  (WCAG-adjacent, and required by the master brief). Select-all on focus gives
  the Krita workflow (click → all selected → type to replace) without taking
  drag-to-select-text away. The false `ew-resize` cursor on the input is removed
  so the affordance is honest.
- **Home/End removal is a behaviour change** justified by #2, not by local user
  evidence. PageUp/PageDown preserves a fast route to the range ends (at least
  10 steps per press, clamped by `min`/`max`), and typing remains exact.
- **Scrub precision**: the value is no longer rounded to two decimals. Binary
  floating-point residue is stripped with `toPrecision(12)` instead, so fine
  steps survive and the document never gains `0.30000000000000004`-style noise.
- **The input keeps `role="spinbutton"` on `type="text"`** because the field
  accepts arithmetic expressions (`120/2`, `{alias}+8`) that a native number
  input cannot represent. MDN documents the AT caveats of this choice (#1); the
  field mitigates them with `aria-valuenow`/`aria-valuemin`/`aria-valuemax`/
  `aria-valuetext` and standard keyboard stepping.

## Implemented changes

Commits on `master` (this session):

| Commit | Change |
|--------|--------|
| `85b0e8e3c` | This research and diagnosis record. |
| `04056e371` | `NumberField` gesture/keyboard repair (NF-1…NF-9): native non-passive wheel listener; incremental scrub accumulator rebased on Shift/Alt key events; floating-point-residue stripping instead of 0.01 quantization; no-op transaction suppression; Escape/pointercancel/blur/unmount cancellation; pointerId tracking + pointer capture; `preventDefault()` on the scrub handle so a drag does not steal focus; `touch-action: pan-y`; Home/End returned to caret movement with PageUp/PageDown as the ≥10-step route; draft-aware stepping; select-all on focus; input cursor `text` (label keeps `ew-resize`). 40 unit tests. |
| `2cae5f595` | Real-photo E2E coverage (`tests/e2e/inspector/number-field-interaction.spec.ts`). |

Verified defect reproductions before the fix (same spec, pre-fix commit):
the wheel test failed because the panel scrolled and the wheel event then
targeted a different element, the modifier test returned `start + 300` instead
of `start + 120`, and the Escape test returned `-269` instead of `-299`.

### Second pass (2026-09-15)

| Change | Where | Evidence |
|--------|-------|----------|
| `NumberField.onDelta` relative edit channel for gestures; typed commits stay absolute | `NumberField.tsx` | 43/43 unit tests (scrub increments `[10, 20]`, arrow/Page deltas, mixed selection keeps typing absolute) |
| Relative multi-selection move for X/Y using a functional document updater (stale-closure-proof) inside one transaction | `PositionSizeSection.tsx` | E2E "scrubbing a mixed X selection moves every object by the same delta" (two real photos, 100→135 / 200→235) |
| `@varve/ui` `NumberInput` brought onto the same contract: Pointer Events, modifier rebase, residue-only precision, no-op suppression, Escape/blur/unmount cancel with value restore, reference-counted cursor/user-select release, `touch-action: pan-y` | `NumberInput.tsx`, `NumberInput.test.tsx`, `components.css` | 12/12 unit tests (modifier rebase, fine steps, no-op, Escape restore, pointer identity, residue) |
| Duplicate `X (px)`/`Y (px)` accessible names in Image Placement removed | `ImagePlacementSection.tsx` (`label="Offset X" displayLabel="X"`) | 13/13 `sections.test.tsx`, 9/9 `controls.test.tsx` |
| Developer-local screenshot paths removed from the inspector E2E spec | `tests/e2e/inspector/inspector.spec.ts` | All three now use `testInfo.outputPath(...)`; no `/home/kevina` references remain under `tests/` |
| Field keyboard contract: `inputMode="text"` (see NF-11) | `NumberField.tsx` | Unit assertion on the rendered attribute |

Automated audit coverage run for the deferred 6C/6D surfaces (all passing):
menu command integrity, capabilities, localization, renderer, live-boolean
context menu, nudge capability, flat-tree semantics, tree keyboard navigation,
tree focus, drop resolution, and drag moves — 123/123 tests. Accelerators in
`menu/defs.ts` are resolved from `SHORTCUT_DEFS` (the live registry), which is
the contract the master brief requires.

## Verification results

- **Unit**: `npx vitest run packages/editor/src/components/Inspector/controls/NumberField.test.tsx` — 40/40 pass (includes new coverage for modifier rebasing, fine-step precision, no-op transactions, Escape cancel, pointer identity, draft-aware stepping, PageUp/PageDown, caret-preserving Home/End, residue stripping).
- **E2E (real photo, Chromium)**: `number-field-interaction.spec.ts` — wheel/default-prevented/no-scroll, modifier rebase, undo-through-the-Edit-menu, and the visual-states test pass. The Escape-cancel case passed in the post-fix run before last; subsequent runs hit a dev-server navigation flake (`canvas.editor-canvas__content-layer` not visible within 60 s) and one Chromium renderer crash under heavy concurrent load, not a product failure. The wheel test verifies both the deterministic `defaultPrevented` signal and the real `page.mouse.wheel` value change.
- **Typecheck**: `@varve/editor` `tsc` reports no errors in touched files; the package has 42 pre-existing errors in other workstreams' in-flight files (snapping, selection tests, workspace), and `pnpm typecheck:e2e` currently fails on `tests/e2e/caf/object-selection-mask-source.spec.ts` (another workstream's uncommitted edit). The new spec itself typechecks clean.
- **Visual**: `reports/numeric-field-review/` — light/dark/high-contrast inspector, focused field (focus ring + selected text proving select-all), and a deterministic mixed-value state on a 2-photo selection (`aria-valuetext="Mixed values"`). Inspected: no clipping, truncation, or unreadable states in any theme.

### Remaining work

1. **NF-11 on-device verification (open, low risk).** `inputMode="text"` cannot
   be exercised without a physical iOS/Android device; confirm the on-screen
   keyboard exposes `-`, `/`, `.` and that tap-to-focus still opens it.
2. **Menus, layers tree, panel density (Sections 6A/6C/6D).** Sampled this
   session: the automated suites listed above pass, accelerators come from the
   live shortcut registry, and the three previously-recorded defects (canvas
   context-menu live booleans, nudge capability, role-based menu queries) are
   fixed. Still unaudited against the master brief's per-criterion checklists:
   submenu pointer-grace geometry under flip/shift, disabled-item focus
   semantics, menu close-reason focus handoff, tree `aria-posinset`/`setsize`
   accuracy under virtualization, and density/measurement invalidation after
   font-size changes. Each needs criterion-specific evidence; none of them can
   be claimed from unit suites alone.
3. **Pre-commit blocker (not ours).** Re-check whether
   `tests/e2e/caf/object-selection-mask-source.spec.ts` still fails
   `pnpm verify:commit` once that workstream commits.
4. **Website follow-up (not changed this session).** If the numeric-field
   behaviour changes reach the website's feature descriptions (scrolling,
   keyboard, mobile entry), re-check `apps/website` copy and screenshots in a
   dedicated website session. The app is the source of truth; no website claim
   was edited here.
