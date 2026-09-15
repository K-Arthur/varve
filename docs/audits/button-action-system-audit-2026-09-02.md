# Button and action-control audit — 2026-09-02

Status: implementation audit and remediation record.

## Scope and method

The supplied button/action-control brief was checked against the shared UI
primitives, editor and home consumers, Storybook fixtures, tests, website
components, and the current CSS/token layers. Repository search found 266
files containing at least one button or button-like control in the editor,
home, or desktop surfaces: 69 use the shared `<Button>` primitive, 218 contain
native `<button>` markup, and 56 contain `aria-pressed` state. These are
overlapping counts, not a claim that every native button is an error.

## Classification findings

| Surface | Classification | Remediation |
| --- | --- | --- |
| Shared text/icon actions | Button/IconButton | Canonical variants, sizes, labels, type default, busy and destructive behavior |
| Tool palette | Persistent tool mode | `ToggleButton` inside the existing APG toolbar; flyout actions stay one-shot buttons |
| Quick text formatting | Persistent formatting state | Toggles for Bold/Italic/List; radiogroup segmented control for alignment |
| Dialog footers and prompts | Confirm/cancel actions | Shared Button, explicit destructive variant where applicable |
| Copy affordances | Async one-shot action | Guarded `CopyButton` with success/failure live status |
| Tabs, menus, selects, comboboxes, switches, checkboxes | Specialized widgets | Keep their roles and keyboard patterns |
| Canvas handles, drag surfaces, color inputs, custom title-bar controls | Interaction-specific controls | Keep local DOM where the native/browser API is the contract; document rather than flatten |
| Website navigation | Links/disclosures | Keep Astro-native navigation semantics; align action classes and CTA vocabulary |

## Implemented decisions

- Replaced the old shared `primary` and `danger` names with `default` and
  `destructive`; callsites in editor and home were migrated.
- Added `outline`, `link`, and `toolbar` to the shared variant vocabulary,
  explicit icon sizes, canonical compact/control radius mapping, and connected
  `ButtonGroup` geometry.
- Made native button type default to `button`, and kept caller-provided
  `aria-disabled` available when a surface needs both native and explanatory
  disabled semantics.
- Consolidated `IconButton` on `Button` so class names, loading, labels,
  refs, and controlled attributes are not lost through prop spread order.
- Hardened `CopyButton` against duplicate activation, clipboard API absence,
  stale completions, unmounts, and timer leaks.
- Standardized the editor floating toolbar and quick text bar without changing
  their existing focus, tooltip, overlay, or command ownership.
- Added the Button Storybook system gallery and focused primitive/editor tests.
- Migrated marketing `btn-primary` usage to `btn-default`, added canonical
  website variants, and retained pill styles only as explicit marketing
  exceptions.

## Interaction-effects decision

| Effect | Decision | Reason |
| --- | --- | --- |
| Loading spinner and accessible busy state | Keep | Communicates an actual pending operation |
| Copy → Copied feedback | Keep | Confirms a completed user-requested action |
| Press/hover/focus transition | Keep, tokenized | Supports target recognition without distraction |
| Shine/ripple/magnetic/heartbeat/confetti | Reject for regular controls | Adds spectacle, motion, or false urgency to routine editor actions |
| `ShineBorder` | Allow only at its separate production allowlist | It is a bounded state-transition decoration, not button styling |

## Deliberate exceptions and follow-up

Native buttons remain in menus, tabs, switches, custom pickers, canvas
overlays, and browser-native form integrations where replacing the element
would damage the widget contract. They are included in the audit inventory so
future work can classify them by semantics instead of applying a visual
replacement blindly. New editor actions should use the shared primitives and
new raw buttons require a documented specialized role.

The website does not import React UI primitives. Its Astro `Button` component
and `.btn-*` classes mirror the semantic contract while retaining the site’s
separate responsive layout and marketing-only pill treatment.

## Evidence record

Implementation was delivered in four progressive commits:

- `7eead2cd7` — shared UI primitives, state handling, and editor/home callsite
  migration
- `cc01142a0` — editor floating toolbar and quick text action controls
- `cf8d924ae` — Astro marketing Button/CTA contract, callsites, and docs
- `f4443bf1e` — remaining editor variant/type migration cleanup

The focused unit checks passed for the shared UI primitives and editor action
surfaces (68 tests across the committed slices). Website typecheck, production
build, and Pages build passed. Browser checks passed for all four editor
workspace-toolbar visual scenarios and the bundled-font selector workflow.
Marketing screenshots were captured and directly inspected in light, dark,
mobile, and open-Learn-menu states. The token audit passed all 153 pairs across
light, dark, and high-contrast themes; emoji and docs audits are clean.

One cross-surface typography workflow remains explicitly unresolved: after a
real Bold interaction, the existing floating text overlay leaves its font
input geometrically unstable and the 180-second Playwright action timeout
fires. The independent font-selector workflow passes, so this was not hidden
by changing the test to force a click. The issue is recorded for the overlay
positioning/render lifecycle rather than attributed to the Button primitive.

The current worktree also contains unrelated concurrent menu, ingestion,
inference, object-selection, and inspector changes. The affected gate reports
formatter failures in those files on its earlier run; the latest run passed
format/lint and stopped at the unrelated object-selection E2E assertion. The
architecture audit reports a new `context/types.ts → tools/types.ts` cycle from
that concurrent work. The first button checkpoint also inherited the
already-indexed `AssetBrowser` ingestion files; subsequent checkpoints used
path-only commits to keep later concurrent changes out of the button cleanup.
