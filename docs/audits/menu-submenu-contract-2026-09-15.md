# Menubar submenu command contract — repair and verification (2026-09-15, session G)

**Scope:** `packages/editor/src/Menubar.tsx`,
`packages/editor/src/menu/menubarKeynav.ts`, their unit suite, and the menu
Playwright specs. Follow-up to
`docs/audits/menubar-flyout-dismissal-2026-09-15.md`, which closed the hover
leave/roving-tabindex defects and recorded the remaining work repaired here.

**Status:** implemented and verified at the affected-check level. Full-suite
escalation deferred to integration (reason in section 4).

## 1. Findings and repairs

Each finding is a real defect reproduced in source and, where possible, in the
app before the fix; each repair has a regression test.

| # | Symptom (before) | Root cause | Severity | Repair |
|---|---|---|---|---|
| M1 | A disabled submenu parent (for example **Arrange > Align** with nothing selected, or one object selected) opened a flyout of commands that could not run. Reachable by hover, click, Enter/Space and ArrowRight. | `Menubar.tsx` deliberately exempted submenu parents from `disabled` (`item.disabled && !hasSubmenu`), the wrapper's `onMouseEnter` opened any parent with `items`, and `menubarKeynav.ts` opened submenus without checking `disabled`. Leaf commands already used DOM `disabled` + skip. | High (dead action surface; contradictory state) | Disabled parents render `disabled`; hover/click/render paths check `disabled`; Enter/Space/ArrowRight cannot open a disabled parent; ArrowRight no longer jumps to the next top-level menu for a disabled parent. |
| M2 | Submenu keyboard had no Home/End and no type-ahead, while the dropdown had both. | The submenu branch of `handleMenubarKey` predates the shared type-ahead utility and only implemented arrows/Enter/Escape/Tab. | Medium (keyboard parity; APG first/last + printable navigation) | Added Home/End (first/last enabled) and printable-prefix type-ahead via the shared `@varve/ui/utils/menuTypeAhead`, including scroll-into-view of the matched row. |
| M3 | The visible shortcut beside a menu command showed the default binding while `aria-keyshortcuts` announced the effective (remapped) binding. | 106 call sites used `formatShortcut(SHORTCUT_DEFS.<id>.binding)`; only `ks()` used `getEffectiveBinding`. | Medium (a displayed shortcut that cannot execute; screen-reader/sighted disagreement) | All 106 call sites now resolve `shortcutText(id)` = `formatShortcut(getEffectiveBinding(id))`; `SHORTCUT_DEFS` is no longer imported by `Menubar.tsx`. |
| M4 | Availability could go stale: the View "Show/Hide Bleed Guides" label, Apply Master entries, and Audit/Scan/Suggest/Detect-Duplicates availability did not recompute when bleed-guide visibility, masters, node count, or the active file path changed without a selection change. | The `rawMenus` memo dependency list omitted those inputs. | Medium (wrong disabled state / wrong label) | Added `state.bleedGuidesVisible`, `state.document.masters`, `documentNodeCount`, and `activeFilePath` to the memo. Node count is a primitive so ordinary property edits do not rebuild all menus. |
| M5 | A flyout whose parent became unavailable (selection cleared, capability changed) stayed on screen with commands that could no longer run. | No invalidation path between `menus` recomputation and the `openSubmenu` state. | Medium (stale command surface) | Effect closes the flyout when its parent is disabled; the render path also refuses to mount it. When the flyout owned focus, the unmount would otherwise drop focus to `<body>`; the effect moves focus to the dropdown's first enabled item. Pointer users whose focus is elsewhere are untouched. |
| M6 | **Resolved by a concurrent session's in-flight fix (reviewed and re-verified here; see section 7).** Two pre-existing Playwright failures: `keyboard-nav.spec.ts` "disabled menu item has attribute and is not a tab stop" (no dropdown item receives focus after opening Object) and `overlay-reliability.spec.ts` "keeps menubar flyouts and context menus attached through real input" (File > Logo flyout still open after Escape). | Earlier hypothesis (predecessor audit): the asynchronous context settle in `useMenubarContextEffects` closes menus after open. The re-verification evidence points to a simpler and sufficient cause: focus handoff into the portaled menu can silently no-op while `FloatingPortal` still has the layer `visibility: hidden` under load. Focus then stays on the trigger/body, so no menu item is focused (first failure) and Escape lands outside the menu, which never receives the key (second failure, "menu still open after Escape"). The context effect remains a deliberate safety close and no longer correlates with the failures. | High for the affected journeys | The concurrent session added a bounded per-open rAF retry in `useMenubarFocusEffects` (`menubarFocus.ts`) that verifies the handoff and retries while focus is still in a state the open owns. With that fix in the worktree both journeys pass (section 7). Remaining coverage gap: the retry has no unit test; the behavior is E2E-verified only. |
| M7 | **Not fixed (documented, now more precisely).** Enabled `reason` strings are computed and then discarded by **every** consumer: `defs.ts` supplies them, `renderer.ts:180` (`resolveEnabled`) evaluates them, and the declarative renderer, `nativeAdapter.ts`, and the HTML menubar all keep only the boolean disabled flag. | Architectural: there is no single source of disabled-state reason; `buildMenus` computes its own `dis(action)` logic in parallel with the declarative model, so grafting reasons onto the HTML menubar per command could display an explanation that contradicts the actual disabled state. | Low–Medium (discoverability of unavailable commands) | Left as remaining work with the fix direction recorded: migrate `buildMenus` onto the declarative model (one disabled/reason source) and render the reason as an accessible description; or keep the two renderers and add none. Not half-implemented. |

## 2. Implementation notes

- `menubarKeynav.ts` owns the submenu keyboard machine and now mirrors the
  dropdown for Home/End and type-ahead. The type-ahead buffer is shared and is
  reset when a menu level opens, switches, or closes (effect in `Menubar.tsx`
  keyed on `openMenu`/`openSubmenu`), so a prefix cannot leak between levels.
- `submenuRef` was added to the keynav context so type-ahead can scroll its
  match into view; this required no new import in `Menubar.tsx`.
- No CSS, token, or visual values changed. Disabled parents inherit the
  existing `.editor-menubar__menu-item:disabled` treatment.
- `Menubar.tsx`: 2,858 lines / 19 imports against the 2,891 / 22
  `.health-baseline.json` ceilings.

## 3. Verification

| Check | Command | Result |
|---|---|---|
| Unit (menubar) | `npx vitest run packages/editor/src/Menubar.test.tsx` | 28/28 passed on the combined working tree (a concurrent writer added one test while this session ran), including 5 new tests: disabled parent does not open on hover; submenu type-ahead + Home/End; remapped shortcut text and `aria-keyshortcuts`; a flyout that loses availability closes and hands focus to the first enabled dropdown item; existing hover/close journeys re-seeded to keep Align enabled. |
| Unit (menu neighbors) | `npx vitest run packages/editor/src/menu/__tests__/menuSnapshot.test.ts packages/ui/src/utils/menuTypeAhead.test.ts packages/editor/src/editor.test.tsx` | `menuTypeAhead` + `editor` passed. `menuSnapshot` fails on a committed stale baseline (received adds the clipboard `copyText`/`copyAsSvg` entries from another session's committed `defs.ts`); that snapshot is not imported by, and cannot be affected by, this slice. |
| E2E (repaired behavior) | `VARVE_E2E_PORT=4629 npx playwright test tests/e2e/menus/flyout-dismissal.spec.ts tests/e2e/menus/typeahead.spec.ts --project=chromium --workers=1` | 12/12 passed, including the new "disabled submenu parent does not open a flyout" and "submenu supports type-ahead and Home/End". |
| Types (package) | `pnpm --filter @varve/editor typecheck` | No error in any touched file. The 42 pre-existing errors remain, including the unchanged `useMenubarContextEffects` dispatch-variance error at `Menubar.tsx`; that call is byte-identical to HEAD. |
| Types (E2E) | `pnpm typecheck:e2e` | Clean (0 errors). |
| Format/lint (touched) | `npx biome check --write <5 touched files>` | Clean. |
| Docs/emoji | `pnpm audit:docs`, `pnpm audit:emoji` | Run as part of this change; zero violations required. |

Not run: `pnpm verify:full` (see section 4), Rust, native desktop, packaging,
cross-runtime visual baselines (no styling change).

## 4. Validation-economy note (why the full gate is deferred)

`pnpm verify:plan` reports `FULL-SUITE ESCALATION: YES` with the reason
"workspace/toolchain/validation-infrastructure change". That selection comes
from the 209-file working tree, which contains other sessions' uncommitted
toolchain, E2E-infrastructure, and package changes. This slice changed five
files, none of them workspace/toolchain/test-runner configuration. Per
`docs/quality/validation-strategy.md` and the precedent recorded by the Layers,
Inspector, and Toolbar sessions, the affected closure was run directly and the
full gate is a release/integration checkpoint for whoever merges the shared
tree.

### 3a. Tests that had encoded the defect

`keyboard-nav.spec.ts` journeys "ArrowRight opens submenu, ArrowLeft closes it"
and "Enter on submenu item opens submenu" opened the **Align** flyout with an
empty selection, where Align is unavailable. They passed only because a
disabled parent wrongly opened; with M1 fixed they were red until their
preconditions were corrected to the same seeded multi-selection the neighboring
`submenu ArrowDown/ArrowUp cycles submenu items` test already used. This is
recorded because it is direct evidence that the old behavior was relied upon by
tests, not just a latent inconsistency.

## 5. Menu spec results after this change

Final re-run on the worktree that includes the concurrent session's focus-retry
fix in `menubarFocus.ts` (isolated ports; other sessions' Playwright and Tauri
processes active):

- `flyout-dismissal.spec.ts`: **3/3 passed**, including the new disabled-parent
  journey and the hover journey that had flaked under load.
- `typeahead.spec.ts`: **9/9 passed**, including the new submenu type-ahead and
  Home/End journey.
- `keyboard-nav.spec.ts`: 13 consecutive journeys passed (menubar navigation
  through submenu traversal and the first type-ahead test); the batch then hit
  a Chromium **renderer crash** (`Target crashed`) inside `navigateToEditor`, an
  environment failure, not a product failure. The remaining tail was re-run
  separately: **14/14 passed** (all type-ahead cases, accelerators, focus
  never on body, Escape focus return, ARIA roles, axe scan). The previously-red
  "disabled menu item has disabled attribute and is not a tab stop" journey
  passes in isolation. The whole file is therefore green across runs.
- `overlay-reliability.spec.ts:91` (the File > Logo escape journey) now
  **passes** in isolation.
- New unit coverage added here for the focus-retry fix:
  `packages/editor/src/menu/__tests__/menubarFocusRetry.test.tsx` (2 tests) —
  retries a refused handoff until focus lands and stops once focus moved
  deliberately elsewhere. 2/2 pass; no type errors.
- Commit anchors: this session's contract work is `c0f2ebbd6`; the reviewed
  focus fix is `c8c4b1f2b` plus `ac804fdcb` (tall-menu row scroll).

Attribution rule: a failure is attributed to this slice only when its journey
exercises the repaired behavior. The only observed failures in this batch were
a renderer process crash and `navigateToEditor` startup timeouts, both
reproduced on unrelated journeys and recorded by other sessions as machine-load
flakes.

## 6. Review of concurrent work (evening re-check)

1. **`bb3782ecf` "share one item role/checked helper across dropdown and
   submenus"** — reviewed. It extracts `itemRole`/`itemAriaChecked` from both
   menubar surfaces into `menu/menubarItemState.ts` and re-exports the helpers
   through `menubarSubmenu.tsx` so `Menubar.tsx` does not add an import (hub
   budget). Pure extraction; behavior-neutral for the journeys above.
   **Integration gap:** the commit included this session's `Menubar.tsx`,
   `Menubar.test.tsx`, and `keyboard-nav.spec.ts` changes but **not**
   `menu/menubarKeynav.ts`. HEAD now passes `submenuRef` into
   `handleMenubarKey` (Menubar.tsx) while HEAD's `MenubarKeyContext` has no
   such field, so HEAD does not typecheck for that file until the remaining
   slice is committed. The worktree is consistent and green.
2. **Focus-retry fix in `menubarFocus.ts` (uncommitted at review time)** —
   reviewed. Both `useMenubarFocusEffects` loops now verify the focus handoff
   and retry on `requestAnimationFrame` (bounded at 30 attempts) while focus
   is still in a state the open owns (body / menubar / dropdown). Cancellation
   is the existing effect cleanup (`cancelAnimationFrame`), and a deliberate
   focus move elsewhere stops the retry. It is a sufficient explanation for
   both M6 symptoms and both journeys pass with it. This session added the
   missing unit coverage (`menubarFocusRetry.test.tsx`, 2/2) and reviewed the
   logic; the fix itself remains uncommitted and belongs to that session.
3. **Stale index (observed; since reconciled).** At review time the index held
   a pre-`bb3782ecf` snapshot (21 entries), including a staged deletion of
   `menu/menubarItemState.ts` and a `Menubar.tsx` without the new helper
   import; committing it as-is would have reverted part of `bb3782ecf`. This
   session did not touch the index. A later check found the menu paths no
   longer staged (6 unrelated generative-edit entries remain), so the hazard
   is resolved.
4. **`menu/__tests__/menuSnapshot.test.ts` baseline refreshed.** It was
   36 failed / 14 passed on HEAD, independent of this session (the suite
   renders the committed `defs.ts` through `renderer.ts`). The delta was
   reviewed before accepting it: purely additive entries for committed
   commands (clipboard, workspace-management, isometric-plane) plus moved
   arrangement sections, with no lost labels. After regeneration the suite is
   50/50. The refresh is its own commit so the baseline change is reviewable
   in isolation from the contract fix.

## 7. Rollback

Revert the five source/test files listed in
`docs/agents/menu-submenu-contract-2026-09-15-ownership.md`. There is no schema,
persistence, or migration surface: the change is presentation state and command
dispatch only. Menu availability returns to its previous (stale-input) behavior
and disabled parents return to opening flyouts.
