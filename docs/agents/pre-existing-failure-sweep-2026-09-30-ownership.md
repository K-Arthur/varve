# Ownership — pre-existing failure sweep (2026-09-30)

**Agent scope:** triage and repair of the checks that already fail on `master`
before this session starts — the quality audit gates, Biome, the JavaScript and
Rust suites, TypeScript, and the browser/visual lanes — with the matching
documentation and website corrections. Companion ledger:
`docs/audits/pre-existing-failures-2026-09-30.md`.

**Status:** in progress on `master`, shared checkout. Dirty work that this task
does not own is preserved; no reset, stash, rebase, force-push, or unprotected
process termination.

## Concurrency disclosure

This checkout is shared with at least one other live session. While this task was
triaging, `HEAD` moved from `5c4ca00b6` to `cf20557c6` and then to `b407362b5`
without this task committing anything. Consequences recorded here so a later
reader can interpret the evidence:

- Every failure in this ledger is attributed against the revision recorded with
  it, never against "current master".
- Commits from this task are path-scoped (`git add <path>` then `git commit`),
  and the index is checked to be empty of foreign paths before committing, so
  another session's staged work is never swept in.
- A read-only attribution worktree at `/tmp/opencode/head-attr` holds the
  committed revision, so "was this failing before the uncommitted work?" can be
  answered by re-running the exact spec there.

## Files owned by this task

| Area | Files |
|------|-------|
| Presentation fill chrome | `packages/editor/src/components/Presentation/presentationNavigator.css` |
| Minimap chrome | `packages/editor/src/components/Minimap/minimap.css` |
| Codegen setup copy | `packages/codegen/src/tailwind.ts` |
| Menu enablement | `packages/editor/src/menu/defs.ts` |
| Dock node identity | `packages/editor/src/workspace/dock/dockOps.ts` |
| Engine filter routing spec | `packages/engine/src/replay-filter.test.ts` |
| Validation planner spec | `tests/unit/validationPolicy.test.ts` |
| Website screenshot registration | `scripts/screenshots/product.mjs`, `apps/website/src/data/screenshot-manifest.json`, `apps/website/src/pages/features/strokes.astro`, `apps/website/src/pages/features/effect-studio.astro`, `docs/screenshots/product/` (6 captures) |
| Stale expectations repaired | `packages/editor/src/workspace/__tests__/panelRegistry.test.ts`, `packages/editor/src/workspace/layersPanelConfig.test.ts`, `packages/editor/src/context/__tests__/workspaceToolLifecycle.test.tsx`, `packages/editor/src/components/QuickActionsBar/QuickActionsBar.test.tsx`, `packages/editor/src/shortcuts/ShortcutPalette.test.tsx`, `packages/editor/src/tools/__tests__/ToolManager.middlePan.test.ts` |
| Documents | this file, `docs/audits/pre-existing-failures-2026-09-30.md` |

Files that belong to another session's uncommitted work are **diagnosed and
recorded, not edited** — `packages/scene/src/version.ts` (schema 2.31 → 2.32),
`packages/editor/src/workspace/dock/dockOps.ts`, `packages/engine/src/replay.ts`,
`scripts/quality/affected-plan.mjs`, the pattern-fill files, and the `zz-`
diagnostic probes. Formatting or landing half-finished work under this task's
message would misattribute it, and the implicated dock, replay and planner paths
are being edited as this sweep runs.

## Non-overlap statement

No other ownership file in `docs/agents/` claims a repository-wide failure sweep.
`docs/agents/workspace-switcher-design-2026-09-29-ownership.md` explicitly
declined the `audit:tokens` false positive in `packages/codegen/src/tailwind.ts`
as "the maintainer's call"; this task resolves it.

Hub files (`CanvasArea.tsx`, `Shell.tsx`, `context.tsx`, `Menubar.tsx`) are not
touched.

## Findings recorded

1. `pnpm audit:radius` — `presentationNavigator.css` consumed the legacy
   `--radius-sm` alias in a file whose other nine radii already use
   `--radius-control-compact`. Migrated; the alias resolves to the same value,
   so the painted radius is unchanged.
2. `pnpm audit:spacing` — `minimap.css` introduced `margin: 0 auto`, which the
   audit's ratchet treats as new raw spacing debt (the same shorthand is
   grandfathered in `.spacing-baseline.json` for four website components).
   Expressed as the audited `margin-block`/`margin-inline` longhands instead of
   inflating the baseline.
3. `pnpm audit:tokens` — the scanner read a documentation placeholder
   (`bg-[var(--name)]` inside the Tailwind setup copy) as a custom-property
   reference. Resolved by describing the emitted reference accurately rather
   than teaching the gate an exemption; see the ledger for why.
