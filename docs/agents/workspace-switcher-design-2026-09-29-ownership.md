# Workspace switcher design review — ownership (2026-09-29)

**Task (user directive):** *"comprehensively review fix and improve the
frontend design of the workspace switcher of the Varve app as currently it has
a few issues and problems such as redundant design in certain view-ports
especially and bad contrast. Please undertake the ff task, progressively
committing your changes and also updating the relevant docs. Please also
account for the needed marketing website changes needed. Please do not neglect
to perform the visual validation work as well. Don't just research on what
works but also what other apps and offerings have failed at with these and
users have complained about online that we can realistically resolve. Ensure
you work on master and not a new branch."*

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `d28fee6a5`.

## Interpretation of the directive (recorded, not hidden)

"The workspace switcher" is read as the menubar workspace-mode switcher: the
dock (`packages/editor/src/components/WorkspaceTabs.tsx`), its `.workspace-dock*`
recipes in `packages/editor/src/editor.css`, the per-mode identity tokens it
consumes, its overflow menu, and the copy about it in `docs/` and
`apps/website`. This is the surface `docs/audits/workspace-switcher-review-2026-09-15.md`
and `docs/audits/design-system-audit-2026-09-27.md` §8 also call "the workspace
switcher".

"Redundant design in certain view-ports" and "bad contrast" are treated as
symptoms to be located in the running app, not as a specification. Both were
reproduced and measured before anything was changed. The two leading causes are
F2 (the switcher renders as a second floating surface below 900px) and F3 (the
inactive mode glyph measured 3.23:1 in light theme, the weakest point in the
whole switcher). Findings F1, F4, F5 and F6 came out of the same pass; F6 is the
most literal reading of the directive — at 641–750px the switcher painted over
the Help menu and stole its clicks (see the audit for the hit-test table).

The Home sidebar "workspace" switcher (`packages/home/src/WorkspaceSwitcher.tsx`)
is a **different** surface: it switches personal/team workspaces, not task
modes. It was measured (rendered contrast 7.3–18.9:1 in light and dark, pointed
lists unchanged) and is not edited here.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/editor/src/components/WorkspaceTabs.tsx` (+ `.test.tsx`) | Remove the per-tab number chip; carry the ordered 1–6 mapping as `data-shortcut-key` on the radio |
| `packages/editor/src/components/WorkspaceTabs.css` | Deleted — it held only the chip recipe |
| `packages/editor/src/editor.css` | Compact tier (`max-width: 899px`) flattens the switcher container and constrains the menu rail so it cannot paint over or steal the switcher's targets; phone-width label clamp removed; the two contradictory portrait blocks consolidated into one; dead tablet chip rule removed |
| `packages/ui/src/tokens/color.ts`, `packages/ui/src/tokens/tokens.css` (generated) | Light `workspace-icon-*` = the mode's accent step; the six icon contrast pairs raised from `UI` to `AA` |
| `tests/e2e/workspace/switcher-design-review.spec.ts` (new) | Real-app design-review contract: chip, container tier, rendered contrast per mode × theme, name-at-phone-width, menu-rail overlap and hit-testing |
| `tests/e2e/workspace/dock-layout-geometry.spec.ts` | Ordered-mapping lookup moved from the chip to `data-shortcut-key`; badge-count assertions replaced |
| `docs/audits/workspace-switcher-design-review-2026-09-29.md` (new), `docs/architecture/workspace-system.md`, `docs/architecture/responsive-workspace.md`, `docs/screenshots/2026-09-29-workspace-switcher-design-review/**` | Review record, updated contracts, rendered evidence |
| `apps/website/src/pages/features/workspaces.astro`, `apps/website/src/pages/docs/workspaces.astro`, `apps/website/src/pages/docs/getting-started/interface.astro` | Drop the "each tab marked by its matching number" claim and describe the actual shortcut paths; describe the compact treatment |

## Not touched (other writers, active or recently active)

- `packages/editor/src/Menubar.tsx`, `packages/editor/src/menu/**` — the
  tablet-mode session's in-flight menubar work.
- `packages/editor/src/components/Shell/WorkspaceBottomPanels.*` — the dock
  layout/panel system (its `workspace-dock-*` class prefix is a different
  feature from the `.workspace-dock__*` switcher; only the switcher is edited).
- `tests/e2e/interaction/chromeos-device-matrix.spec.ts` — the tablet-mode
  session's uncommitted portrait assertions. Its
  "keyboard-only badges should not crowd the touch switcher" expectation is
  satisfied by this session's change; the file is not edited here.
- `packages/editor/src/components/FloatingToolbar/**`,
  `ContextControlBar/**` — toolbar-review scope.
- `packages/home/src/WorkspaceSwitcher.*` — measured, out of scope (above).
- `CHANGELOG.md` — holds another session's uncommitted entries; the entry for
  this change is recorded in the audit's "Remaining work" instead.

## Pre-existing uncommitted state carried into these commits

`master` is a shared, in-flight snapshot: several sessions have uncommitted
work in the same files this review edits. Nothing was reverted, reformatted or
staged selectively outside the paths in the table above; where a shared file
carries another session's hunks, they are carried with the commit and listed
here.

| File | Carried hunks (not this session's) |
|---|---|
| `packages/ui/src/tokens/color.ts`, `tokens.css` | The six-workspace consolidation removing the retired `workspace-accent-codegen` / `-logo` tokens and the now-unused `R` ramp helper (another workspaces session). Without it the token source does not match the committed six-mode editor code. |
| `packages/editor/src/editor.css` | The tablet-mode session's in-flight narrow-width chrome: the two-tier portrait menubar grid + `--menubar-total-height` arithmetic, the `@media (pointer: coarse)` top-chrome touch scale, and the `html[data-layout-mode="tablet"]` sizing block. This review's compact-tier and portrait rules build on that tier; its "Portrait tablets have enough vertical room…" block was already in the working tree. |
| `tests/e2e/workspace/dock-layout-geometry.spec.ts` | Unrelated geometry/panel assertions from the workspaces session, untouched by this review's edit to the dock-sequence lookup. |

## Integration checkpoint

The switcher review is being integrated into the tablet top-bar work on
`master` as separate implementation, documentation, and website-asset commits.
The repository history is the source of truth for their identifiers; the
tablet audit records the final commands, artifacts, and remaining hardware
gates.

Verified so far: the switcher review's leased browser run is recorded in the
audit, and the tablet top-bar boundary, portrait, and editing-control cases
passed. One separate 600×960 matrix attempt stopped in shared navigation
setup before its tablet assertions and is awaiting a focused retry.

## Status: implementation reviewed (2026-09-29)

Delivered in the current worktree: measured findings, the repair, the real-app
contract spec, the review record, updated switcher and responsive contracts,
and rendered evidence in
`docs/screenshots/2026-09-29-workspace-switcher-design-review/`. Website copy
and screenshot promotion are being finalized with the tablet presentation.

Deferred: the CHANGELOG entry (above), inactive-tab labels (documented
trade-off), and the browser text-size / assistive-technology matrices.
