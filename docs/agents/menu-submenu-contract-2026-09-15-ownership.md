# Menubar submenu contract repair — ownership (2026-09-15, session G)

**Task:** continue the 2026-09-15 menu work by repairing the remaining defects the
flyout-dismissal audit explicitly deferred: disabled submenu parents opening,
missing submenu type-ahead/Home-End, shortcut text ignoring keymap overrides,
stale menu availability, and open flyouts surviving their parent becoming
unavailable.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `e7ef4146b`.

**Research ledger:** `docs/research/menu-submenu-contract-2026-09-15.md`.
**Audit + verification:** `docs/audits/menu-submenu-contract-2026-09-15.md`.
**Predecessor (still current for its scope):**
`docs/audits/menubar-flyout-dismissal-2026-09-15.md`.

## Why this record exists

The working tree contains many other writers' uncommitted changes. This record
names the paths this session owns so a later integration pass can tell them
apart. `packages/editor/src/menu/**` was flagged by two other records as
containing an in-flight clipboard menu snapshot; this session edits only the
submenu/keyboard sources and never stages or rewrites the snapshot.

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/editor/src/Menubar.tsx` | Disabled submenu parents inert (hover/click/render), close-on-disable effect, `rawMenus` availability deps, visible shortcut text from `getEffectiveBinding` (106 call sites) |
| `packages/editor/src/menu/menubarKeynav.ts` | Disabled-parent guards for Enter/Space/ArrowRight; submenu Home/End; submenu type-ahead; shared type-ahead reset |
| `packages/editor/src/Menubar.test.tsx` | Keymap-aware shortcut mock; five regression tests |
| `packages/editor/src/menu/__tests__/menubarFocusRetry.test.tsx` (new) | Unit coverage for the concurrent session's focus-retry fix in `menubarFocus.ts` |
| `tests/e2e/menus/flyout-dismissal.spec.ts` | Disabled-parent E2E |
| `tests/e2e/menus/typeahead.spec.ts` | Submenu type-ahead + Home/End E2E |
| `docs/architecture/menu-system.md` | Interaction contract paragraph (menubar/submenu specifics only) |
| This record + the research ledger + the audit | Evidence |

## Files explicitly NOT touched

- `packages/editor/src/menu/defs.ts`, `renderer.ts`,
  `menu/__tests__/__snapshots__/nativeAdapter.test.ts.snap` — the clipboard
  menu session's in-flight work (`MM` snapshot in the shared tree).
- `packages/editor/src/components/LayersPanel/**`, `Inspector/**`,
  `FloatingToolbar/**`, `FloatingTextBar/**`, `StatusBar.tsx`,
  `ContextControlBar/**` — other sessions per their ownership records.
- `editor.css`, `components.css` — the separator-review session owns shared CSS
  recipe edits this session.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files with import budgets;
  consumed, not modified. `Menubar.tsx` gained no imports and stays inside its
  `.health-baseline.json` line/import ceilings (2,858 / 2,891 lines, 19 / 22
  imports).

## Consumed contracts (read-only here)

- `docs/architecture/menu-system.md` — surface taxonomy and visual contract.
- `@varve/ui/utils/menuTypeAhead` — shared type-ahead matcher (used by both
  dropdown and submenu; no parallel implementation added).
- `@varve/ui/utils/focusMovement` — `nextEnabledIndex`, `firstEnabledIndex`.
- `packages/editor/src/shortcuts/ShortcutManager.ts` —
  `getEffectiveBinding(id)` (override-or-default; one resolver).

## Concurrency observed during the session

A second writer was active in these files while this session worked: at
19:22–19:25 (local) they added `packages/editor/src/menu/menubarItemState.ts`
(untracked), moved the local `itemRole`/`itemAriaChecked` definitions out of
`Menubar.tsx` and `menubarSubmenu.tsx` into it, and added one test to
`Menubar.test.tsx`. Their hunks do not overlap this session's (disabled-parent
guards, `shortcutText`, availability deps, close-on-disable effect, keynav).
This session did not stage, revert, or reformat their work. Verification below
was re-run on the combined working tree; the integration owner must reconcile
both sets and, if they commit this file, keep both changes.

## Status: implemented, verified locally (evening re-check)

Unit: `Menubar.test.tsx` 28/28; new `menu/__tests__/menubarFocusRetry.test.tsx`
2/2 (coverage for the concurrent session's focus-retry fix). E2E on the
worktree that includes that fix: `flyout-dismissal.spec.ts` 3/3,
`typeahead.spec.ts` 9/9 (including the submenu type-ahead/Home-End journey),
`keyboard-nav.spec.ts` green across runs (13 consecutive, then 14/14 tail, plus
the previously-red disabled-item journey in isolation), `overlay-reliability`
1/1 (previously red). The only failures observed were a Chromium renderer crash
and `navigateToEditor` startup timeouts under heavy machine load — environment,
not product. The previously documented M6 settle-race hypothesis was corrected:
the failures are explained by the hidden-portal focus handoff and are fixed by
the concurrent session's retry (audit section 6). Typechecks: `@varve/editor`
reports no error in any touched file (25 pre-existing errors, including the
unchanged `useMenubarContextEffects` dispatch mismatch); `pnpm typecheck:e2e`
fully clean. Deferred to integration per the validation economy:
`pnpm verify:full` (the planner escalates because other writers' uncommitted
workspace/toolchain files are dirty, not because of this slice).

## Integration warnings

1. **HEAD was incomplete between `bb3782ecf` and `c0f2ebbd6`.** The earlier
   commit folded this session's `Menubar.tsx`, `Menubar.test.tsx`, and
   `keyboard-nav.spec.ts` changes into the shared-helper refactor but left
   `menu/menubarKeynav.ts` uncommitted, so HEAD passed `submenuRef` into a
   context type that lacked it. `c0f2ebbd6` closes that gap; HEAD now contains
   `submenuRef` in `MenubarKeyContext`.
2. **Stale index snapshot (observed, now reconciled by another session).** At
   review time the index held a pre-`bb3782ecf` snapshot (21 entries,
   including a staged deletion of `menu/menubarItemState.ts` and older copies
   of the menubar files); committing it would have reverted part of the
   refactor. A later check shows the menu paths are no longer staged (6
   unrelated generative-edit entries remain). This session did not modify the
   index at any point; no action is needed for the menu paths.
3. **Shared-file hunks.** `Menubar.tsx` and `Menubar.test.tsx` also contain the
   concurrent writer's `menu/menubarItemState` refactor and its test. Both sets
   coexist in the worktree and were verified together (28/28 unit, typecheck
   clean for these files apart from the documented pre-existing error).

## Verified artifact hashes (final state of this session)

Unit 28/28 and `pnpm --filter @varve/editor typecheck` (25 pre-existing errors,
only the unchanged `useMenubarContextEffects` dispatch mismatch in
`Menubar.tsx`) were re-run against these exact contents:

```text
7883adac391ab685847c8c5f4ed15e778670ac2783747e167a46a860ce153373  packages/editor/src/Menubar.tsx
473aa553f3c4ecf4c806085d5166edee6f5ccf711af92ba80919b793334e0b84  packages/editor/src/menu/menubarKeynav.ts
fec7f737c652dab49d2022c2a055c9668cc84e55011e7533b48e5abdb61e0f3e  packages/editor/src/Menubar.test.tsx
273301a9c355bda5e7a79449536e4deff59ae32cd9737049e91a03cd507d2cbe  tests/e2e/menus/typeahead.spec.ts
481a3af9fec4244d39687509761b9cc662c42c2e989e006cb72c0e067d5e28c5  tests/e2e/menus/flyout-dismissal.spec.ts
c00a7c27354f7e88fa7c27f17ab85f23339840961e51b5066214aa55de96af24  tests/e2e/menus/keyboard-nav.spec.ts
```

## Completion (2026-09-15, final)

| Commit | Subject |
|---|---|
| `bb3782ecf` | fix(menubar): share one item role/checked helper (other session; includes this session's `Menubar.tsx`, `Menubar.test.tsx`, `keyboard-nav.spec.ts`) |
| `c8c4b1f2b` | fix(menubar): retry the menu focus handoff until the portal layer is focusable (other session; reviewed here) |
| `ac804fdcb` | test(toolbar): scroll the focused menu row into view (other session; reviewed here) |
| `c0f2ebbd6` | fix(menubar): complete the submenu keyboard and availability contract (this session: keynav, e2e specs, retry coverage, docs) |
| snapshot refresh commit | test(menus): refresh the declarative menu snapshot baseline |

With `c0f2ebbd6`, HEAD contains `submenuRef` in `MenubarKeyContext` and the
intermediate type inconsistency is resolved. The `menuSnapshot.test.ts`
baseline was regenerated from the committed model (50/50); its only
"deletions" were moved entries, verified by confirming the affected labels
(`Group Selection`, `Select All`, `Intelligence`, arrangement sections) are
still present in the new baseline.

## Remaining menu work (not in this session)

- Enabled `reason` strings computed by the declarative model are still not
  rendered by the HTML menubar (the two renderers remain separate; see the
  audit for why this is a deliberate boundary rather than a quick patch).
- `nativeAdapter.test.ts.snap` remains another session's uncommitted work.
