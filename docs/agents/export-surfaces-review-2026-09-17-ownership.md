# Export surfaces review (Inspector Export tab + Export dialog) — ownership (2026-09-17)

**Task:** user-directed review of every section/component/text/spacing of the
Inspector's Export tab (`PropertiesPanel` host, `AssetExportControls`,
`CodeGenView`, `SpecPanel.css`) and the Export dialog (`ExportDialog` and all
children), followed by evidence-based repair of the defects found.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
(no branch or worktree created, per the standing instruction).
**Base HEAD at start:** `4bcaecf6d`.

## Relationship to prior work (read before editing)

- `docs/agents/export-inspector-2026-09-15-ownership.md` — completed review of
  the Inspector tab (commit `63f6eac28` + follow-ups); not re-opened.
- `docs/plans/export-ux-redesign-2026-09-16.md` — landed as `c3e2a03a9`
  (tab) and `3e0b2e0a0` (dialog). This session reviews the **current** state of
  both surfaces and repairs what the redesign left broken.

## Evidence gate (before production edits)

1. `pnpm verify:plan` at base HEAD: `FULL-SUITE ESCALATION: YES` — the shared
   tree carries 141 dirty files from other sessions including
   toolchain/validation-adjacent paths. Escalation belongs to the combined
   integration checkpoint; this session's inner loop is bounded to the owned
   files below.
2. Baseline browser evidence, isolated port 14473, real editor:
   `/tmp/opencode/export-review/*.png` (tab and dialog in light/dark, 240px
   inspector, 200% text, 760px stacked dialog, code sub-tab, live export run).
   Measured: preset badge palettes diverge between surfaces, dialog badges
   lowercase, dims cell truncates `240x150 · 9…`, count badge background
   resolves transparent, preflight raises a false blocking collision.

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/scene/src/export/adapter.ts` | `legacyBatchToRequest` propagates the job suffix into canonical configurations (root cause of the false path-collision preflight) |
| `packages/scene/src/export/adapter.test.ts` | regression: suffix propagation |
| `packages/scene/src/export/preflight.test.ts` | regression: legacy batch with distinct suffixes is collision-free; identical suffixes still collide |
| `packages/editor/src/components/Export/FormatBadge.tsx` (new) + `FormatBadge.css` (new) | one shared, token-based, color-independent format badge for both surfaces |
| `packages/editor/src/components/Export/BatchJobList.tsx` / `.css` | shared badge; Dimensions/Size headers; non-truncating dimension + PPI display; search label/placeholder alignment; pressed state on format filters; token cleanup |
| `packages/editor/src/components/Export/ExportDialog.tsx` / `.css` | confirm message names the actual blocking findings; section-title casing; ellipsis typography; no inline style overrides; empty states |
| `packages/editor/src/components/Export/DestinationPicker.tsx` / `.css` | label/typography consistency; token cleanup; remove dangling `--color-interactive-subtle` reference |
| `packages/editor/src/components/Export/OutputResolutionPanel.tsx`, `PrintSettingsPanel.tsx` | accessible names contain the visible labels (WCAG 2.5.3); heading level consistency; PPI/DPI wording |
| `packages/editor/src/components/SpecPanel/AssetExportControls.tsx` / `SpecPanel.css` | shared badge; aria-label alignment; count-badge token fix; dense-metadata type tokens |
| Tests: `packages/editor/src/components/Export/*.test.tsx`, `packages/editor/src/components/SpecPanel/AssetExportControls.test.tsx`, `tests/e2e/spec/export-workspace.spec.ts` | update pinned strings/labels; new assertions |
| `docs/audits/export-surfaces-review-2026-09-17.md` (new), `docs/screenshots/2026-09-17-export-surfaces/**` (new) | review report + before/after evidence |
| This record | |

## Explicitly not touched (other writers' work)

- The dirty set from concurrent sessions (font pipeline, generative editing,
  Tauri build files, website docs, `packageExport.ts` font-timeout change,
  `Cargo.lock`s, `.health-baseline.json`, etc.).
- `packages/ui/src/tokens/tokens.css` — no new tokens; existing semantic
  surfaces/interactive tokens cover the badge and count-badge repairs.
- Dangling `--color-interactive-subtle` references outside this surface
  (`Inspector/sections/effects/effects.css`, `UpscaleDialog.css`): reported in
  the audit, not edited (different owners).
- Inspector tab-overflow policy (`InspectorTabBar`) — the recorded D3
  reachability item; reported with fresh narrow-width evidence, not changed.

## Commit discipline

Progressive commits on `master`, staged with explicit path lists, verified
with `git diff --cached` immediately before each commit. No push, no tag, no
deploy.

## Validation ownership

- Unit: targeted vitest runs for `packages/scene/src/export/{adapter,preflight}`
  and `packages/editor/src/components/{Export,SpecPanel}` suites.
- Typecheck: affected packages (`@varve/scene`, `@varve/editor`).
- `pnpm audit:tokens` (colour/token-adjacent CSS changes), `audit:docs`,
  `audit:emoji` (docs written).
- Browser: isolated-port Playwright re-run of the export tab/dialog flows and
  before/after screenshots; physical touch/pen hardware and screen readers
  remain unavailable in this environment — recorded as unverified lanes, not
  passed.
