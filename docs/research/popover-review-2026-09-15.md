# Popover review — research and evidence ledger (2026-09-15)

Status: research gate for the 2026-09-15 app-wide popover review. Sources are
primary (W3C/MDN/spec/browser-engine trackers/verified product forums) plus
first-party product forums for real-user failure reports. Timings and counts
quoted from forum posts are user reports, not measurements taken here.

## 1. Standards and platform facts that bound this review

| Fact | Source (checked 2026-09-15) | Consequence for Varve |
|---|---|---|
| Popover API is Baseline 2025; popovers created with it are **always non-modal**; `<dialog>` is the modal primitive. `showPopover()`/`hidePopover()` are the imperative route. | MDN, “Popover API”, last modified 2025-12-17 — https://developer.mozilla.org/en-US/docs/Web/API/Popover_API | `Popover.tsx` may use `popover="auto"` only for non-modal surfaces; modal consumers must keep a real dialog/focus boundary. |
| Interest invokers (`interestfor`, `interest-delay`, `interest`/`loseinterest`) now provide declarative hover/focus popovers. | Same MDN page; https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using_interest_invokers | Hover-triggered overlays should prefer the platform primitive over hand-rolled enter/leave timers where the target runtime supports it; keep a fallback. |
| Hover/focus-triggered content must be **dismissible, hoverable, persistent** (WCAG 2.2 AA 1.4.13). Escape while keeping pointer still is the canonical dismiss mechanism; a gap that closes content mid-travel is a failure. | W3C WAI Understanding 1.4.13 — https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html ; SCR39 https://w3c.github.io/wcag/techniques/client-side-script/SCR39 | Any hover/focus popover (tooltips, hover cards, previews) must keep open while the pointer travels into it, never auto-hide on a timer, and close on Escape. |
| Modal dialog pattern: focus moves into the dialog on open and returns to the invoker on close; mark `aria-modal` only when content outside is truly inert **and** visually obscured. Non-modal dialogs still contain their tab sequence. | WAI-ARIA APG, Dialog (Modal) — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ (checked 2026-09-15) | A popover marked `role=dialog` must either move focus in (and return it) or must not claim modality. `aria-modal="true"` with an interactive background is a conformance risk. |
| Target Size (Minimum) is 24×24 CSS px with exceptions; 44×44 remains the enhanced target this repository already targets for touch. | W3C WAI Understanding 2.5.8 / 2.5.5 (both linked in AGENTS.md) | Popover trigger and in-popover controls keep the repository's existing target rules; compact desktop density does not shrink below the AA minimum. |

## 2. Real-user failure reports from comparable tools

| Report | Source | Failure class | Relevance to Varve |
|---|---|---|---|
| “Nearly every time I want to draw an object or move something around, I get an annoying box full of options… I don't need to see them every darn time.” | Adobe Illustrator UserVoice, “Annoying popup windows in toolbar”, 2023-11-06 — https://illustrator.uservoice.com/forums/601447-illustrator-desktop-bugs/suggestions/47434838 | Tool-options popup opens implicitly and repeatedly | Directly matches `ToolOptionsPopover`, which auto-opens on every supported tool selection. |
| Variable-binding popover re-opened over the panel when a variable was already bound; community asked for it to behave like the fill picker. Adobe/Figma staff shipped a fix. | Figma Forum, “Not get used to this new feature”, thread 52843 — https://forum.figma.com/ask-the-community-7/not-get-used-to-this-new-feature-52843 | Unrequested popover covers the control the user was editing | Binding/colour popovers must not reopen implicitly over the field that is already bound. |
| Names in an insert popover are truncated after ~11 characters with no way to see the full name on hover. | Figma Forum, thread 37614 — https://forum.figma.com/suggest-your-feature-11/how-to-distinguish-similarly-named-components-in-insert-popover-37614 | Truncation without a full-name path | Applies to layer/asset names and any popover list of like-named items. |
| Popover content hidden behind panels; user must move panels to see it. | Adobe Community thread 1636868, 2026-08-13 — https://community.adobe.com/questions-712/...1636868 | Overlay below another panel's stacking context | Positioning must be verified against every panel edge, not only the viewport. |
| Resized dropdown anchors to the wrong corner and can leave the screen; requires restart. | Illustrator UserVoice, suggestion 49978965, 2025-06-02 | Runaway geometry / no recovery | Overlay geometry changes must be bounded and reversible. |
| Hover popovers/tooltips disappear when the pointer moves onto them (WCAG 1.4.13 failure). | Bootstrap issue #42065 (2026-02-05) — https://github.com/twbs/bootstrap/issues/42065 | Hoverable requirement missing | Check every hover-triggered overlay in Varve (tooltip, hover cards, font previews). |
| Hover popovers either disappear immediately or teleport to top-left after a mouse move. | Bootstrap issue #33340 (2021) — https://github.com/twbs/bootstrap/issues/33340 | Position/visibility race between open and measurement | Matches the “measure hidden, then place” pattern; ensure no frame paints at 0,0 or hidden-after-visible. |
| Nested popover in a shadow DOM/portal closes the parent on light dismiss (WebKit bugs 263081, 308293; fixed later). Light dismiss must use the flat tree and account for control buttons inside the popover. | WebKit bug 263081, bug 308293, PR 19314 | Nested overlay dismisses its parent | Varve portals nested overlays outside the parent popover's DOM subtree; native light dismiss can close a parent when a nested portal is clicked. |
| Programmatic `showPopover()` + a regular button: clicking the invoker while open can light-dismiss on `pointerup` and then reopen on `click`, so the toggle “doesn't close”. Opening during `focus` (e.g. inputs) gets light-dismissed on the same pointer sequence. | WHATWG HTML issue #12157 — https://github.com/whatwg/html/issues/12157 | Same-trigger toggle unreliable for imperative popovers | `Popover.tsx` calls `showPopover()` imperatively and toggles from click; verify the double-toggle at runtime on the target Chromium. |
| `popover=auto` light-dismiss inside an open `<dialog>`/top-layer ancestor requires care; `commandfor`/`popovertarget` is the declarative route. | WHATWG HTML PR #12184 (checked 2026-09-15) | Nested top-layer ordering | When a popover opens inside a dialog, verify the dialog isn't dimmed/closed by the same press. |

## 3. Gaps this review must close (working hypotheses)

Each is verified in the running app before a fix is committed; entries that
did not reproduce are removed from the fix list and recorded here.

1. **Non-modal popovers are not keyboard-reachable.** The trigger opens a
   portaled surface without moving focus, and the portal lives at the end of
   `<body>`, so Tab from the trigger walks the rest of the page first.
   `role=listbox`/`role=dialog` content with no keyboard entry violates APG
   and 2.1.1.
2. **Trigger semantics are overwritten.** `Popover.tsx` clones the child and
   forces `aria-haspopup="dialog"` even when the consumer declared
   `aria-haspopup="listbox"` (Home workspace filter, workspace switcher).
3. **Same-trigger toggle can fail** when native light dismiss and the React
   click handler both run on one press (WHATWG #12157 class).
4. **Nested overlays can dismiss their parent** when a nested portal is
   outside the parent popover's DOM subtree (WebKit-class bug).
5. **Tool options open implicitly and take focus.** Selecting a tool
   auto-opens `ToolOptionsPopover` and moves focus to its first control —
   the Illustrator complaint, plus a canvas-focus loss for keyboard users.
6. **Popover test coverage is symbolic.** `Popover.test.tsx` “outside click”
   and “Escape” tests call `hidePopover()` directly instead of dispatching the
   real interaction, so neither behavior is actually pinned.
7. **No rendered evidence** exists for popovers near panel/viewport edges,
   inside scrolled panels, under text enlargement, or in dark/high-contrast
   themes.

## 4. Decisions

- Keep the native Popover API path, but make trigger toggling deterministic
  (single owner of the open state per press) and keep the registry fallback
  for browsers without the API.
- Do not force `aria-haspopup`; respect a consumer-provided value, defaulting
  to `dialog` only when absent.
- Non-modal popovers that contain focusable content get focus entry on open
  **only when opened via keyboard**, with focus return on close; pointer opens
  do not steal focus. This matches APG dialog guidance and the “don't steal
  canvas focus” requirement.
- Tool options remain available from an explicit trigger; implicit
  auto-open on tool selection is removed only if runtime evidence shows it
  steals focus or coverage tasks. Where auto-open is retained for pointer
  users, it must not move focus.
- Hover-triggered overlays are checked against WCAG 1.4.13 (hoverable,
  dismissible, persistent); interest invokers are used only with a verified
  fallback.
- No new dependency: the existing Floating UI + registry stack covers the
  required behavior after the fixes above.
