# Ownership — design-system audit, completion, integration, validation (2026-09-27)

**Started:** 2026-09-27
**Base:** `master` at `757e507e3` (166 commits ahead of `origin/master`)
**Coordinator:** design-system audit task (single writer for its scope)

## Repository state at start (recorded before any edit)

- Branch `master`, no in-progress merge/rebase/cherry-pick, no `index.lock`.
- Working tree already carried substantial concurrent work:
  ~275 dirty paths (144 staged, 109 unstaged, 118 untracked) belonging to
  other sessions — GPU rendering, canvas fluidity, token binding/repaint,
  mockup system, website design-tokens pages, screenshot evidence.
- Stashes `stash@{0}`..`stash@{4}` pre-existed; not touched.
- Worktree `/var/tmp/varve-quality-gate-final` (detached) pre-existed; not touched.
- No `git add`, no `git stash`, no `git reset`, no commit of other
  contributors' staged work will be performed by this session. Deliverable is
  a documented working diff unless explicit commit authorization appears.

## Scope and boundaries

This session owns a design-system audit + targeted completion/integration work:

- Foundations: token sources, theme/density rules, generated CSS provenance.
- Component contract gaps in `packages/ui` primitives.
- Cross-surface consistency + accessibility defects that evidence supports.
- Documentation of the canonical system and guardrails (audits/tests).

## Concurrent sessions — NOT edited by this session

- `packages/editor/src/CanvasArea.tsx`, `canvas/*`, `StatusBar.tsx`,
  `hitTest/*`, `useCollabPresence.ts` (canvas fluidity session).
- `packages/compositor/src/webgpu/*`, `tests/e2e/webgpu/*`, GPU docs
  (gpu-rendering session).
- Mockup system files under `packages/*/src/mockup`, `docs/plans/mockup-*`,
  `apps/website/src/features/mockup*` (mockup session).
- `packages/editor/src/components/Inspector/sections/{Fill,Stroke,PositionSize,
  CornerRadius,Typography,Appearance,TableAppearance}Section.tsx`,
  `packages/scene/src/bindings.ts` (token-binding session).

Any additional file is recorded here before editing.

## Files edited by this session

| File | Change |
| --- | --- |
| `docs/agents/design-system-audit-2026-09-27-ownership.md` | this record |
| `docs/audits/design-system-audit-2026-09-27.md` | audit + plan + final report |
| `packages/ui/src/components/Dialog.tsx` | shared primitive: layout-effect unmount `close()` so conditionally-mounted dialogs keep platform focus restoration (recorded here because `Dialog.tsx` is a shared integration point) |
| `packages/ui/src/components/Dialog.test.tsx` | regression test for unmount-close |
| `vitest.setup.ts` | shared test harness: `showModal` polyfill now mirrors the UA initial-focus step (shared integration point; full `packages/ui` suite + dialog-heavy editor suites re-run green after the change) |
| `packages/editor/src/components/ImportResults.tsx` | div modal → shared `Dialog` + `Button` |
| `packages/editor/src/components/ImportResults.css` | shell chrome removed (owned by Dialog); content styles kept |
| `packages/editor/src/components/ImportResults.test.tsx` | role-based close queries + focus/Escape contract tests |
| `packages/editor/src/panels/IntelligencePanel.tsx` | Promote dialog div → shared `Dialog` + `Button` |
| `packages/editor/src/panels/IntelligencePanel.test.tsx` | native-dialog contract test (fixture-driven) |
| `packages/help/src/HelpBrowser.tsx` | Tab containment guard, initial focus, focus restoration on close |
| `packages/help/src/HelpBrowser.test.tsx` | containment + restoration regression tests |
| `packages/home/src/HomeSearchPalette.tsx` | window-level Tab containment (single owner), focus restoration on close |
| `packages/home/src/HomeSearchPalette.test.tsx` | containment + restoration regression tests |
| `packages/ui/src/tokens/themeRuntime.ts` | System resolves to High Contrast under `prefers-contrast: more`; lifecycle listens to the contrast media query |
| `packages/ui/src/tokens/themeRuntime.test.ts` | resolution + lifecycle contrast cases |
| `apps/desktop/index.html` | pre-paint script mirrors the contrast rule (no flash of the wrong palette) |
| `packages/ui/src/components/ShineBorder.css` | dead `:root:not([data-theme])` guard removed (documented behaviour was unreachable) |
| `tests/e2e/settings/theme-lifecycle.spec.ts` | prefers-contrast e2e (pre-paint + live OS change + explicit precedence) |
| `scripts/quality/audit-token-usage.mjs` | comment/definition parity + constant-assigned token names |
| `scripts/quality/audit-token-usage.test.mjs` | new regression test (wired into `test:ci:tools`) |
| `packages/ui/src/components/radius-system.css` | duplicate `.varve-input__field` selector removed |
| `packages/ui/src/components/components.css` | 4 duplicate selectors merged; `.varve-close[aria-disabled]` stays pointer-active |
| `stylelint.config.mjs` | `no-duplicate-selectors` re-enabled |
| `scripts/quality/validation-lanes.mjs` | `lint:css` lane defined |
| `validation-impact.config.mjs` | `ui-css-discipline` impact rule (shared integration point) |
| `scripts/quality/affected-plan.mjs` | Tier-0 routing for `lint:css` (riskFlags lanes never execute) |
| `packages/ui/src/components/ButtonVariantParity.test.ts` | aria-disabled pointer-event parity assertions |
| `docs/design/component-status.md` | corrected Combobox/Spinner/AlertDialog status |
| `docs/architecture/theme-system.md`, `AGENTS.md`, `DESIGN.md` | contrast rule + 315-pair counts |
| `docs/architecture/design-token-system.md` | guardrails section made true (lint:css wiring, comment parity) |
| `tests/e2e/home/workspace-switcher.spec.ts` | new real-app spec for the Home workspace switcher (was uncovered) |
| `packages/help/src/HelpBrowser.test.tsx` | jest-dom type import for `toHaveFocus` |
| `packages/editor/src/plugins/PluginManager.css`, `PluginHostSection.css` | `999px` → `--radius-pill`; legacy `--radius-sm` → `--radius-control-compact` (computed value unchanged; makes `audit:radius` green) |
| `scripts/quality/validation-lanes.mjs`, `validation-impact.config.mjs` | `audit:radius` lane + `radius-discipline` impact rule |
| `packages/platform/src/web.ts`, `memory.ts` | workspace bootstrap uses the stable `'personal'` id (idempotent under concurrent first boots; matches HomeShell's existing `'personal'` fallback) — found by the new Home switcher e2e |
| `packages/platform/src/workspace-bootstrap.test.ts` | repro-first test: concurrent web boots converge on one row (fails with the old uuid id) |
| `apps/website/src/pages/features/{code,email,logo}.astro` | the 9 raw `font-size` declarations commit `cf77fbc32` added (breaching `RAW_FONT_SIZE_CEILING` 344 → 353) migrated to `--type-interface-caption-size` / `--type-content-lead-size` / `--type-interface-heading-size` — the same roles `plugins.astro` already uses for these three elements; ratchet back to 344/344 |
| `packages/home/src/WorkspaceSwitcher.tsx` | APG listbox content model: title/empty-message children marked `role="presentation"` (WS3) |
| `packages/home/src/WorkspaceSwitcher.test.tsx` | +2 content-model tests (DOM-direct; jsdom never runs the Floating-UI positioning pass, so role queries cannot see the panel — visibility owned by the new e2e) |
| `packages/editor/src/components/WorkspaceCustomizeDialog.tsx` | **user-directed move-panel flow review**: 4 hand-rolled `<label>/<select>` pairs → canonical `NativeSelect` (hard rule; select-system.md), 6 raw Move up/down `<button>`s → `IconButton` (ArrowUp/ArrowDown), raw checkbox rows → `Checkbox` primitive (Panels/Chrome/Tools/Inspector/Status + pins), `DOCK_PANEL_LABELS`/`panels` duplication deduped into `PANEL_ROWS`. NOTE: file was concurrently dirty from the workspaces session — their uncommitted state preserved, only the flow's blocks replaced; contract strings ('Panel to move', 'Show X in', 'Move X later', pin names) kept byte-identical for the unit + e2e suites |
| `packages/editor/src/editor.css` | dead local chrome removed (`.arrangement-select` wrapper, raw-button skin/disabled/focus rings, two `accent-color` checkbox rules, dead `.workspace-customize__search`); added `.workspace-customize__row-select` (span-2 placement + visually-hidden label recipe). NOTE: same file concurrently edited by the workspaces session (their10px badge at1808-1818 makes spacing/sizing/radius audits red — attributed, not touched) |
| `tests/e2e/workspace/customization.spec.ts` | `.check()` → `.check({ force: true })` on the History toggle — required by the `Checkbox` primitive's visual-box-over-input structure; matches the established `gradient-map` convention |
| `tests/e2e/home/workspace-switcher.spec.ts` | arrow-key test derives the expected label from the focused option; dark-theme test restructured to a pre-boot init script (2 loads, clearing the crash-loop counter interaction documented in §7.4 of the audit); per-test seeding so the init script can register before first navigation |
| `tests/e2e/home/zz-crash-loop-probe.spec.ts`, `zz-stacking-probe.spec.ts` | throwaway diagnostics — both deleted after classification (evidence kept in `reports/ds-audit-2026-09-27/probe*.log`) |
| `packages/editor/src/lifecycle/lifecycleMarker.ts` | §7.4 fix: `readUncleanShutdownMarker()` — only an armed `'false'` marker counts as an interrupted run (absent = fresh/Home session, read errors = no evidence) |
| `packages/editor/src/lifecycle/index.ts`, `packages/editor/src/index.ts` | barrel exports for the classifier |
| `apps/desktop/src/App.tsx` | `readUncleanShutdown` wired to the marker authority (removes the inline `!== 'true'` check and hardcoded key) — **concurrently-active file risk assessed: App.tsx carried no other uncommitted edits** |
| `packages/editor/src/lifecycle/__tests__/lifecycleMarker.test.ts` | +6 unit cases for the classifier |
| `tests/e2e/crash/safe-mode-counter.spec.ts` | permanent gate for §7.4: three plain Home loads never enter safe mode (repro-failed pre-fix, `repro-safemode.log`) |
