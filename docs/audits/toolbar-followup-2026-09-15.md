# Toolbar follow-up review — diagnosis, repair, verification (2026-09-15, session B)

Scope: the command surfaces the first toolbar review
(`docs/audits/toolbar-review-2026-09-15.md`) explicitly deferred — palette
placement, the over-tall View menu, the status bar, the text quick bar, and
the context/text `role="toolbar"` keyboard contract. The first review's
palette keyboard/overflow work and shape quick controls are not re-opened.

Research ledger: `docs/research/toolbar-followup-2026-09-15.md`.
Ownership record: `docs/agents/toolbar-followup-2026-09-15-ownership.md`.
Canonical contract (updated): `docs/architecture/toolbar-system.md`.

## Findings and repairs

### P1 — The palette could not be moved off a covered bottom edge

**Evidence.** The dominant external complaint for this interaction class is
Figma's UI3 floating toolbar: hundreds of replies across the docking thread
and the forced-switch thread (2024–2026) report the bottom-centre palette
hidden behind the macOS Dock, hidden behind a laptop display on multi-monitor
desks, and overlapping dialogs on small laptops, with users explicitly asking
for a top option and persistence across app and web. The placement study
("Click This!", HFES 2010) also measured the slowest acquisition for bottom
toolbars. In Varve the palette was hard-anchored with
`bottom: var(--space-3)` and no user control.

**Fix.** `toolbarPlacement` is now a workspace preference
(`workspaceTypes.ts`, `workspaceStore.ts`, default `bottom`, stored sparsely),
exposed as a root-level radio pair `View > Toolbar at Bottom / Toolbar at
Top` and applied by `FloatingToolbar` as `.floating-toolbar--top` plus
`data-placement`. The command routes through the action registry like every
other View command and is not part of document history. Docking (drag,
left/right, hide) is deliberately not attempted — see "Remaining".

**Verified.** `workspaceStore.test.ts` (default resolution, merge, sparse
storage, storage round-trip, invalid value rejection, per-mode reset);
`FloatingToolbar.test.tsx` (default bottom, persisted top, switch back);
`FloatingToolbar.css` keeps the palette inside its canvas grid cell in both
positions.

### P1 — The View menu was taller than the viewport (1984px at 1280x800)

**Evidence.** First-session measurement; reproduced structurally: ~55
root-level entries plus separators. External failure evidence for long menus
is consistent and cross-industry (Fluent UI #32311 — items unreachable;
Atlassian JRASERVER-33935 — support tickets caused by users not finding
options, recommended fix is grouping; Wikimedia T344776, GNOME
appindicator, shadcn #6343; UsableNet's screen-reader case where a long
scrolling menu could not be traversed at all).

**Fix.** View is grouped into submenus (Theme, Zoom, Canvas Mode, Viewport,
Rulers & Grids, Guides, Print, Panels, Workspace, Color Blindness) with the
placement pair and focus commands left at the root. The workspace filter now
recurses without mutating the memoized menu definitions, drops submenus whose
children were all filtered out, and re-normalizes separators at every level.

**Bonus defect found by the restructure.** `MenubarSubmenu`'s checked-state
helper compared `'Workspace: Design'`-style action suffixes case-sensitively
against lowercase state values, so every workspace radio *inside a submenu*
rendered `aria-checked="false"` (and the same for colour-blindness radios).
Fixed with `.toLowerCase()` on both. Before the restructure the workspace
items were at the root and used the parent's correct helper, which is why the
latent bug had never been visible.

**Verified.** `Menubar.test.tsx` (23 tests including the submenu radio roles,
workspace filtering, and the withheld-workspace states);
`tests/e2e/menus/visual-integrity.spec.ts` now asserts the grouped root's
`scrollHeight <= clientHeight + 1` (the flat menu could only be reached by
scrolling), and specs that used the old flat paths (`history-panel`,
`history-panel-a11y`, `document-fonts-panel`, `logo-panel`,
`browser/try-demo`) were updated through a new `openSubmenu` helper.

### P1 — The status bar was clipped and its targets were under-sized

**Evidence (structural, reproduced in CSS).** `.editor-status` hard-coded
`height: 28px` while the shell grid row used
`--statusbar-height: clamp(1.5rem, 1.45rem + 0.25vw, 1.75rem)` (24–28px).
With `.editor-shell { overflow: hidden }`, the bar was clipped at every width
below 1920px (1.6px at 1280, 3.2px at 640). Interactive targets were 20px
(icon toggles) and 16px (zoom steps) — under the WCAG 2.2 SC 2.5.8 24×24
minimum, with the zoom pair packed 2px apart so the spacing exception did not
apply either. This mirrors the measured failures other tools shipped
(Photoshop options bar overlap under enlarged UI text; Blender's status bar
not fitting at 1920 with UI scale 1.6; Krita users asking for a compact
status bar).

**Fix (editor.css).** The shell floors `--statusbar-height` to 26px and the
bar uses the same token, so row and bar always agree; toggles, zoom steps,
the unit select, and the zoom field are 24px targets; the zoom chip has no
vertical padding so its targets define its height; and the bar scrolls
horizontally (informational text still ellipsizes first) rather than silently
clipping a control if content overruns the row.

**Verified.** `StatusBar.test.tsx` (7 tests, unchanged behavior) plus the new
E2E geometry assertions (row height agreement, no target under 24px, no
clipped control at 1440/1280/1024/900/768/640) — see "Browser verification".

### P2 — The quick bars declared `role="toolbar"` without the keyboard model

**Evidence.** `ContextControlBar` and `FloatingTextBar` rendered
`role="toolbar"` on a plain `div`; every control was a tab stop and arrow keys
did nothing, so the role promised an interaction model that did not exist
(APG Toolbar pattern).

**Fix.** Both bars now render through `@varve/ui`'s `Toolbar` primitive. The
primitive gained an optional class name (replacing the default surface class
so a consumer that owns its chrome is not half-overridden) and — needed for
these bars — yields arrow handling when the event target is a text-entry or
select widget, so the font-size field keeps native stepping and a select keeps
its own navigation. The size field remains a second tab stop by design.

**Verified.** `packages/ui/src/components/Toolbar.test.tsx` (12 tests
including the new arrow-yield and class cases);
`ContextControlBar.test.tsx` (13 tests, including a passthrough `Toolbar` in
its `@varve/ui` mock); `FloatingTextBar.test.tsx` unchanged and passing.

### P2 — Two copies of the typography controls during a text edit session

**Evidence.** First-session remaining work #3; reproduced by inspection:
`ContextControlBar` renders `TextSection` whenever a text node is selected,
and `CanvasOverlays` renders `FloatingTextBar` while the edit session is
active — both show family/weight/bold/italic/size at the same time.

**Fix.** A tiny external store (`context/textEditSession.ts`, same pattern as
`tools/retouchOverlayState.ts`) is published by the floating text bar (mounted
exactly while the session is live). The context bar renders a one-line pointer
("Editing on canvas — formatting is on the floating text bar") instead of a
second control set; the selection quick bar had already used the same concept
via `resolveQuickBarProfile`. No editor-context re-render is added.

**Verified.** `ContextControlBar.test.tsx` (the new suppression test) and the
E2E quick-bar journey — see below.

**Observed behavior worth documenting (not a defect).** While a canvas edit
session has a *collapsed caret*, a font-size change from the floating bar is
staged as pending format for the next keystrokes rather than resizing existing
text (`typographyCommand.applyTypographyChanges`: a collapsed range goes to
`setPendingFormat`, which is transient and creates no history entry; a
character selection applies to the range). The journey spec now selects the
authored characters before resizing, which is also the correct way to resize
text that already exists.

### P1 — Confirming a size in the floating bar ended the edit session

**Evidence (found by the combined E2E journey, reproduced in a real browser).**
Type in a text node, click the floating bar's size field, enter a value, press
Enter: the in-canvas editor unmounts, the bar disappears, and the node commits
at its old size (the screenshot shows `Text: Launch` at 16px after typing
"Launch 2026" and confirming 28). Typing cannot continue because there is no
surface left; only re-entering editing (double-click) works, and the pending
size is silently discarded.

**Root cause.** `TextEditOverlay` decides whether a textarea blur ends the
session by sampling `document.activeElement` two animation frames plus 100 ms
later, and commits when focus is not inside
`[data-text-edit-surface]`/`[data-varve-overlay]`/inspector
(`TextEditOverlay.tsx` `handleBlur`). Clicking the size field is inside the
bar's overlay, so the session survives that handoff — but Enter in the field
blurred it to `<body>` before the sample ran, so the deferred check saw focus
outside the editing surface and committed the session, unmounting the bar
mid-formatting.

**Fix.** `FloatingTextBar`'s size field now returns focus to the in-canvas
editor on Enter (`[data-text-edit-surface="true"]`) instead of blurring to
`<body>`. The input's blur handler still commits the draft exactly once, the
session stays alive, and subsequent typing applies the pending format. If no
edit surface exists the field falls back to blur.

**Verified.** `FloatingTextBar.test.tsx` — a new test appends a
`data-text-edit-surface` element, confirms Enter commits `fontSize` and the
element receives focus (37 tests pass). The combined journey confirms a size
with Enter, asserts the in-canvas editor stays visible and focused, and then
types the rest of the text so the committed node carries the complete
content.

**Related observation (for the Typography owner, not fixed here).** With a
collapsed caret, confirming a new size from the floating bar keeps the session
alive (after the fix above) but the subsequently typed characters still render
at the old size in this build — the committed node keeps `fontSize 16` and its
line box stays ~19px. `typographyCommand.applyTypographyChanges` stages a
collapsed-range change through `setPendingFormat`, and `CanvasOverlays`'
`onUpdateText` passes `editor.state.pendingFormat` into
`replaceRichTextContent`, so the intended path exists; whether the overlay's
flush clears the pending format before the next input, or the rich-text
replacement ignores it, needs the Typography owner's instrumentation. The
journey deliberately does not assert the rendered size.

### P3 — Documentation drift

`docs/getting-started.astro` still said tools were selected "from the toolbar
(left side)"; it now describes the floating palette and the placement option.
`interface.astro`, `workspaces.astro`, `features/workspaces.astro`, and
`tools/typography.astro` document the placement command and the
single-formatting-surface behavior.

## Verification performed

Environment: Linux (CachyOS), Node 22.23.2, Chromium via Playwright 1.62,
isolated dev-server ports under the heavy-task lease. The machine was running
several concurrent agent sessions throughout (5–8 dev servers, 2–4
Playwright runs; load average 13–18), which is relevant to the browser
results below.

| Command | Result |
|---|---|
| `npx vitest run packages/editor/src/Menubar.test.tsx` | 23 passed |
| `npx vitest run packages/editor/src/workspace/workspaceStore.test.ts` | 39 passed (incl. 6 new placement tests) |
| `npx vitest run packages/editor/src/components/FloatingToolbar/FloatingToolbar.test.tsx` | 11 passed |
| `npx vitest run packages/ui/src/components/Toolbar.test.tsx` | 12 passed |
| `npx vitest run packages/editor/src/components/ContextControlBar/ContextControlBar.test.tsx` | 13 passed |
| `npx vitest run packages/editor/src/components/FloatingTextBar/FloatingTextBar.test.tsx` | 36 passed |
| `npx vitest run packages/editor/src/StatusBar.test.tsx` | 7 passed |
| `npx biome check --write <touched files>` | clean |
| `pnpm typecheck:e2e` | clean at the time of the last self-run; the shared gate is intermittently broken by other sessions' in-flight files |
| `node scripts/audit-docs.mjs` / `audit-emoji.mjs` | clean |
| `pnpm audit:tokens` | 153/153 pairs pass, 3 themes |
| `tests/e2e/canvas/toolbar-followup.spec.ts` (new, 4 tests) | 4/4 passed in the clean run (2.3m); details in the browser note |

### Browser verification

The new E2E spec (`tests/e2e/canvas/toolbar-followup.spec.ts`) covers the
placement radio pair and persistence, the status-bar geometry/targets across
six widths, the quick-bar keyboard contract and duplication suppression, and a
combined journey (photo + drawn shape + live text, a size edit, placement
switch, Edit-menu undo/redo round-trip, reload).

**Final clean run (2026-09-15 18:20, port 1673, one worker): 4 passed in
2.3 minutes** — palette placement 37.7s, status bar 17.7s, quick bar 16.2s,
combined journey 40.2s. A follow-up single-test run confirmed the journey's
deterministic history step (Edit menu Undo → Redo restores the typed content;
the keyboard chord after a menubar click was not reliably handled from menu
focus, which had made an earlier version of that step vacuous).

Evidence:
`docs/screenshots/2026-09-15-toolbar-followup/palette-at-top-with-view-menu-1440x900.png`
(placement, radio state, grouped View root) and `combined-journey-1440x900.png`
(complete document: photo + rectangle + live text "Launch 2026", palette at
top, status bar).

Earlier runs (recorded because they explain the fixes): the shared `/tmp`
tmpfs filled to 100% — Chromium's profile and shared memory live there —
and crashed renderers during navigation and in Playwright's global setup
until runs used `TMPDIR` on the main filesystem. Under 5–8 concurrent agent
dev servers, other sessions' in-flight sources were occasionally mid-edit
(a Vite `PARSE_ERROR` in `BatchBgRemoveDialog.tsx` appeared during one run),
and the heavy-task lease was queued behind another session's E2E for up to 10
minutes. Those runs nevertheless surfaced the real defects now fixed: six
sub-24px status-bar controls across two iterations, the P1 session-lifetime
bug in the size field, and four test-flow corrections (the bar element *is*
the toolbar; roving focus needs enabled buttons because the default font has
no italic face; the geometry check must skip ancestor-hidden controls; Escape
in the size field cancels the draft before it closes).

A neighboring-surface regression batch (12 specs / 58 tests: menu
keyboard-nav, flyout-dismissal, visual-integrity; toolbar layout, per-mode,
keyboard-overflow, workspace-toolbar visuals, font-toolbar visuals, selection
quick bar, logo panel, history panel, document fonts panel) then ran on the
clean machine: **52 passed, 6 failed**, and the failures were triaged:

- `logo-panel` exposed a **real defect**: the Panels submenu's hand-copied
  role helper lacked the `toggleLogoPanel` case, so the Logo toggle rendered
  as a plain `menuitem` with no checked state once it moved out of the root.
  Fixed by single-sourcing the role/checked logic in
  `menu/menubarItemState.ts` (also removes the second copy that had caused
  the workspace/colour-blindness radio case bug), with a new unit test.
- `font-toolbar-visual` (3 DPR variants) and `workspace-toolbar-visual` were
  spec updates for intended behavior: the context bar no longer shows
  typography during an edit session (single-surface rule), and Customize
  Workspace moved into the Workspace submenu.
- `menus/keyboard-nav` failed a *different* test in each run (`disabled menu
  item…`, then `ArrowRight opens submenu…`), all after programmatic
  `.focus()` on menu rows; that suite's focus/index sync is not part of this
  session's changes and the role/checked contract it touches is now covered
  by `Menubar.test.tsx`. Recorded as pre-existing flakiness, not fixed here.

## External failure evidence (summary)

Full table and sources: `docs/research/toolbar-followup-2026-09-15.md`.

| Documented failure (other products) | Varve action |
|---|---|
| Figma UI3: bottom-centre floating palette cannot be moved/docked; hidden by the macOS Dock and laptop displays; users ask for top + persistence | Top/bottom preference, persisted per workspace, in the View menu |
| Long application menus extending past the screen; items unreachable or unfindable (Fluent UI, Atlassian, Wikimedia, GNOME, KDE, shadcn) | View grouped into submenus, root asserted to fit without scrolling |
| Status/options bars that clip or overlap controls at narrow widths or with enlarged text (Photoshop, Blender), and users asking for more compact status bars (Krita) | Row/token agreement, 24px targets, tiered hiding plus horizontal scroll as a last resort |
| Toolbars that promise an interaction model they do not implement (role without keyboard behavior) | Shared APG Toolbar with one roving stop and arrow yielding to text-entry widgets |
| Two simultaneous copies of the same formatting controls | One formatting surface during text editing; the other surface points to it |

Nothing here is a claim about Varve's own users: no user study was run and no
screen-reader or physical-touch pass was performed in this session.

## Remaining work and recommendations

1. **Visual baselines for full-editor screenshots** (`full-editor-*`,
   `email-full-editor-*`) need regeneration now that the status-bar chrome
   changed; not regenerated here because the shared tree still carries other
   sessions' uncommitted UI, which would bake foreign screens into the
   baselines (the same reason the Inspector session documented). Command:
   `pnpm screenshots:product`-style scene runs or the affected visual specs,
   after the tree is clean.
2. **Palette docking beyond top/bottom** (drag, left/right, hide-when-idle):
   still the larger shell-grid feature the first review deferred. Left/right
   placement measured fastest in the placement study but interacts with the
   layer/inspector columns and is not attempted here.
3. **Touch target promotion in the status bar.** 24px meets WCAG 2.2 AA; the
   project's 44px enhanced target would require a taller bar under
   `(pointer: coarse)`. Dense chrome promotion needs its own visual pass.
4. **Native menu placement entries.** The native (Tauri) menu and the HTML
   menubar are separate sources. The placement commands are in the HTML
   menubar and the action registry; adding them to `menu/defs.ts` requires
   updating the native-adapter snapshot, which another session had in flight
   at the time of writing.
5. Not performed: screen readers (NVDA/VoiceOver/Orca), forced-colors
   rendering of the new targets, physical touch/pen verification, and
   left-to-right mirroring checks for the placement radio group.
