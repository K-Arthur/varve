# Presentation workflow implementation ownership — 2026-09-29

## Goal

Implement local presentation authoring over ordinary editable Varve frames, in
reviewable commits on the shared `master` branch. Follow the staged plan in the
implementation prompt. Do not reset, stash, clean, or broad-stage the shared
working tree.

## Baseline

- Branch: `master`.
- Baseline commit when this ownership note was created: `5313237652060fb73eb8f27cb8a24326f21db99b`.
- The index was empty. Hundreds of tracked and untracked paths already belonged
  to concurrent work; the presentation task must stage only its own clean files
  or exact hunks.
- Existing presentation-adjacent shared files are already modified by other
  work. In particular, `packages/editor/src/Shell.tsx`, export controls, website
  workspace feature pages, `docs/README.md`, and several architecture pages
  were not claimed by this task at baseline.
- A tablet E2E session owned by another task was running at baseline. Do not
  stop its Playwright, Vite, or browser processes.

## Presentation-owned paths

The task owns new, uniquely named files under:

- `docs/agents/presentation-workflow-2026-09-29-ownership.md`
- `docs/research/presentation-workflow-2026-09-29.md`
- `docs/audits/presentation-workflow-defects-2026-09-29.md`
- `docs/adr/0240-presentation-decks.md`
- `docs/architecture/presentation-system.md`
- New `packages/scene/src/presentation/**` implementation and tests.
- New presentation-specific editor adapters/components and tests, after checking
  their parent directories and integration files immediately before editing.
- New presentation-specific E2E specs and approved screenshots/manifests only
  after acquiring the relevant ownership window.

Shared integration paths are **not** exclusively owned. Before any such edit,
re-read its current diff and coordinate a narrow hunk/window with the active
owner. This includes schema registries (`document.ts`, `types.ts`, `version.ts`,
`canonical.ts`), operation bootstrap/barrels, editor shell/action/menu/command
registries, export model/service/save adapters, docs and ADR indexes, website
navigation/feature discovery, screenshot manifests, and app creation flows.
Record any newly discovered overlapping edits here before modifying them.

## Commit protocol

1. Recheck `git status`, the exact file diff, and the index before each commit.
2. Do not commit unless the index contains only the presentation milestone.
3. For an already-dirty shared file, stage only the presentation hunk and inspect
   the complete staged patch. Never use `git add <path>` when that would stage
   another task's edits in the same file.
4. Run the affected validation plan and required audits before committing each
   implementation slice. Record exact commands and skipped unrelated work in
   the final Agent Validation Report.
5. Keep this ledger current when shared ownership or validation plans change.

## Milestone log

- Baseline: repo and running-app audit, dated research ledger, and reproduced-
  defect matrix complete. `pnpm verify:plan --staged` selected only format,
  lint, emoji, and docs audits with no full-suite escalation; `pnpm verify:affected
  --staged` passed. The default worktree planner saw 488 shared changes from
  concurrent work and escalated broadly, so validation was scoped to this
  milestone rather than running unrelated suites.
- Foundations: pending.
- Authoring: pending.
- Delivery: pending.
- Hardening and marketing site: pending.
