# Popover review and repair — 2026-09-15

Status: complete for the surfaces listed below; see "Remaining / not claimed".
Owner record: `docs/agents/popover-review-2026-09-15-ownership.md`.
Research ledger: `docs/research/popover-review-2026-09-15.md`.
Contract: `docs/architecture/popover-system.md`.

## Scope

Every popover in the app — the shared `Popover` primitive and its consumers
(Home filters, Home workspace filter, workspace switcher, floating text bar
colour picker) plus the rich `FloatingPortal` popovers (tool options,
section manager, align/distribute, variable modifier, floating text bar
"More"). Menus, selects, comboboxes, tooltips, and dialogs remain their own
families and were touched only through shared overlay/focus code.

## Method

Code inventory, then rendered probes on the real Home and editor surfaces
with Playwright, then fixes at the lowest shared layer, then unit + rendered
contract coverage, then visual inspection of captured states. The research
gate (W3C/MDN/spec/browser trackers plus first-party product forums for user
reports) is recorded in the ledger; the real-user complaint classes that
shaped priorities were unrequested tool-option popups (Illustrator), a
variable popover covering the bound field (Figma), popovers hidden behind
panels (Photoshop), hover popovers that vanish on the way in (WCAG 1.4.13
failures), and nested light-dismiss closing a parent (WebKit).

## Findings and repairs

| # | Surface | Evidence | Root cause | Fix |
|---|---|---|---|---|
| F1 | `Popover` (Home filters, workspace filter, text colour) | Rendered probe: `dialog visible after Escape: true`, `aria-expanded: true` with focus on the trigger | Native `popover=auto` only handles Escape while focus is inside the panel, and the registry fallback was disabled whenever the API existed | Registry now owns Escape for popovers in every browser (`Popover.tsx`) |
| F2 | `Popover` consumers | Probe: Tab from the trigger walked `Sort descending → input → Settings → …` and never entered the dialog | The portal mounts at the body end; nothing moved focus in and Tab cannot reach a portaled node from the trigger | Keyboard opens (Enter/Space, or ArrowUp/Down for listbox triggers) move focus into the panel; pointer opens do not; `initialFocus` added to `FloatingPortal` for dialog-style consumers; `FocusTrap` retries while nothing inside has focus |
| F3 | `Popover` triggers | Rendered run: workspace-filter trigger announced `aria-haspopup="dialog"` although the content is a listbox | The primitive overwrote the child's `aria-haspopup` | A consumer-declared value is respected; `aria-controls` wired while open |
| F4 | Home workspace filter / `WorkspaceSwitcher` | No arrow, Home/End, type-ahead, or roving focus model existed | The listbox pattern was never implemented | Shared `handleListboxKeyDown` helper + roving `tabIndex`; unit-tested |
| F5 | Tool options | Rendered run: focus stayed inside the panel after selecting a brush by click, and the panel carried focus through the whole tool session (Illustrator-class complaint) | Implicit tool-change open moved focus to the first control | Open source decides the policy: implicit tool change / pointer click never moves focus; explicit keyboard/command activation moves focus in |
| F6 | Tool options / `FocusTrap` | Rendered run: keyboard open left focus on the trigger even though the handler "succeeded" | The handoff treated "found a control" as success, but a control inside a not-yet-visible floating layer cannot take focus, and the observer only watched childList, so the placement visibility change never retried | Handoff verifies the focused element and retries through style/attribute changes until focus is really inside; `FocusTrap` retries on animation frames while nothing inside has focus |
| F7 | Toolbar unit test | Test asserted the old focus-stealing policy | — | Test now pins both policies (implicit open keeps focus out, keyboard open moves it in) |

### Complaint classes checked and not reproduced

- **Trigger toggle double-handling** (WHATWG HTML #12157 class): repeated
  trigger activation closes reliably in Chromium; pinned by spec.
- **Nested light dismiss closing a parent** (WebKit 263081 class): current
  consumers do not nest a raw portal inside a native popover; the contract
  records the rule that nested surfaces must be registered
  `FloatingPortal` descendants.
- **Popover hidden behind panels / off-screen** (Photoshop, Illustrator
  reports): the shared `flip`/`shift`/`size`/visual-viewport clamping kept
  every reviewed surface inside the usable viewport at 1440×900 and 1280×720.
  No defect found in this session's scope.

### Deliberate deviation

`InspectorColorPopover` keeps `role="dialog" aria-modal="true"` with a
`FocusTrap` but no dimming scrim. Focus is contained and outside pointer
input is consumed by dismissal, while the artwork stays visible so the colour
can be judged against it. Documented in the architecture contract as an
explicit exception, not an accessibility claim.

## Implementation

| Commit | Subject |
|---|---|
| `3d44cf3c4` | docs: ownership, research ledger, popover system contract |
| `5cd3137bb` | fix(popover): dismissal, trigger semantics, keyboard entry |
| `1ef9f517d` | feat(floating-portal): opt-in focus entry and Tab handoff |
| `ecd754840` | fix(home): make the toolbar popovers keyboard operable |
| `8bca6c0a7` | fix(editor): stop implicit tool-options focus theft |
| `faed98bc2` | fix(popover): verify focus lands before ending the handoff |
| `fefb76200` | test(e2e): rendered popover contract coverage |

Files: `packages/ui/src/components/{Popover,FocusTrap,FloatingPortal}.tsx`,
`packages/ui/src/components/focusOrder.ts`,
`packages/home/src/{HomeToolbar,WorkspaceSwitcher,listboxKeyboard}.ts`,
`packages/editor/src/components/FloatingToolbar/ToolOptionsPopover.tsx`,
`packages/editor/src/components/Inspector/{SectionManagerTrigger.tsx,
controls/VariableModifierPopover.tsx, sections/AlignDistributeBar.tsx}`,
plus their unit tests, `tests/e2e/popovers/popover-contract.spec.ts`, and
`apps/website/src/pages/docs/keyboard-shortcuts.astro`.

## Validation actually run

Unit (all passing):

- `Popover.test.tsx` 11 — real keydown/pointerdown dismissal, pointer vs
  keyboard focus policy, `aria-haspopup` respect, trigger toggle.
- `FloatingPortal.test.tsx` 11 — including the new `initialFocus` and
  `yieldTabToAnchor` behaviours.
- `FocusTrap.test.tsx` 3.
- `packages/home`: `listboxKeyboard.test.tsx` 6, `WorkspaceSwitcher` 5,
  `FilterDropdown` 11.
- `packages/editor`: `FloatingToolbar` 11, `SectionManagerTrigger` 2,
  `AlignDistributeBar` 9, `controls.test.tsx` 9, `FloatingTextBar` 36.

Rendered (`tests/e2e/popovers/popover-contract.spec.ts`, Chromium, isolated
`VARVE_E2E_PORT`, heavy-task lease): **4/4 pass in one integrated run**
(1.8 min) and in repeated targeted runs.

- Home filters: keyboard entry focuses the first checkbox; Escape closes
  from the trigger and from inside and returns focus; trigger toggles;
  editing a date keeps the panel open; outside press closes.
- Workspace filter listbox: `aria-haspopup=listbox`; ArrowDown opens and
  focuses the selected option; ArrowDown then `p` reaches Pinned Only;
  Enter chooses and updates the trigger label; Escape restores focus.
- Text colour popover: pointer open keeps focus on the swatch; Escape
  returns it; second activation closes; keyboard open focuses inside.
- Tool options: implicit open leaves focus outside the panel; keyboard open
  focuses the first control; Tab past the last control closes and leaves
  focus in the page; Escape returns focus to the trigger.

Visual review of the captured states (inspected directly, not just saved):

- `filters-keyboard-open.png` / `-dark.png` — light and dark; focus ring on
  the first checkbox; readable labels; no clipping.
- `filters-date-editing.png` — typed date visible while the panel stays open.
- `workspace-filter-open.png` / `-arrow-focus.png` — selected option is
  distinguishable from the arrow-key focus ring.
- `tool-options-implicit-open.png` — panel visible, no focus inside.
- `tool-options-keyboard-open.png` — focus ring on the first control.
- `text-colour-keyboard-open.png` — full picker inside the viewport.

Typecheck: `@varve/ui` and `@varve/home` clean; `@varve/editor` clean **for
every file this task touched** (remaining errors are other sessions'
in-flight files: `LayersPanel/layerContextMenu.test.ts`, `vectorOps.ts`,
`workspace/layoutVariants*`, `snapping.ts`, `Sam2SegmentationTool.ts`,
`Menubar.tsx`, and others); `pnpm typecheck:e2e` clean.

Pre-commit checkpoints on each commit: staged format/lint, secret scan,
contacts, and `audit:docs` all passed.

## Environment limitations observed

The shared machine was running several other sessions' Playwright, Cargo,
and typecheck jobs. `/tmp` is a 12 GiB tmpfs and was full (98–100%) for most
of this session, and system RAM reached global OOM several times; Chromium
was OOM-killed inside global setup on earlier attempts. Successful runs used
`TMPDIR` on the root filesystem and the heavy-task lease, and waited behind
other sessions' leases. This is an environment condition, not a product
defect; the failing runs crashed before any assertion.

## Remaining / not claimed

- `pnpm verify:affected` was not run in its planner-inflated form: the
  shared working tree contains extensive uncommitted work from other
  sessions (selection/SAM2, layers, toolbar, export, fonts), which is what
  selected Tiers 2–4 and the full-suite escalation — not this task's files.
  Running it would test other writers' mid-flight code and saturate the
  machine that was already OOM-killing single browser runs. The targeted
  closure for this task's files is listed above and passed.
- `packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx`
  carries two uncommitted lines from this review (`initialFocus`,
  `yieldTabToAnchor` on the "More" popover). The file is owned by the
  concurrent toolbar session, so this task did not commit it; the change is
  additive and the contract spec asserts the behaviour.
- High-contrast theme, touch/pen input, screen-reader combinations, and
  browser zoom/text-enlargement were not exercised for these surfaces.
- The native light-dismiss nested-portal case has no automated regression
  test; it is documented as a contract rule instead.
- Hover-triggered overlays (`Tooltip`, hover cards) were checked against the
  WCAG 1.4.13 rules in research but not re-verified in this session.
