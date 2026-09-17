# Home interface (Home/Start surface) — ownership (2026-09-17)

**Task:** homepage-scoped slice of the precision-first design-system
workstream: audit the Home/Start surface (`@varve/home`), fix demonstrated
input-reliability, keyboard, target-size, and discoverability defects, and
repair the surface's own bit-rotted browser test lane. No editor/canvas/
Inspector scope.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
(no branch or worktree created, per task instruction).
**Base HEAD at start:** `cd788635b` (same as the interface-density session).

## Evidence gate (before production edits)

1. `pnpm verify:plan` — run at base HEAD. Escalated
   (`FULL-SUITE ESCALATION: YES`, reason: shared tree carries 144+ dirty
   files from other sessions). That escalation belongs to the combined
   integration checkpoint, not this slice; the inner loop stays bounded to
   `packages/home/**` (Tier 0 + `typecheck:@varve/home` +
   `js-unit:@varve/home` + the package's own Playwright lane).
2. Baseline browser capture at `http://localhost:1420/e2e.html` (the
   desktop dev server's seeded memory-platform harness; fresh Playwright
   contexts, no shared storage mutation) —
   `/tmp/opencode/home-baseline/*.png`, 10 states across light/dark/
   high-contrast/640px/320px/multi-select/palette/dialog/context-menu.
   Findings recorded in `docs/audits/home-interface-audit-2026-09-17.md`.

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/home/src/home.css` | `user-select` on cards/rows; 24px favorite target; sidebar count flex context; palette `align-items: flex-start` |
| `packages/home/src/HomeShell.tsx` | Escape hierarchy: clear selection only when no overlay is open and no inline rename is active |
| `packages/home/src/HomeSearchPalette.tsx` | Default (empty-query) recent-files suggestions; honest empty copy |
| `packages/home/src/SidebarNav.tsx` | Focus the first focusable descendant (project rows stalled arrow keys); stop re-syncing `focusIdx` to the active item on every render |
| `packages/home/src/FileCard.tsx` | Remove duplicated `useEffect` |
| `packages/home/e2e/*.spec.ts` | Repair stale selectors to the current DOM (8 files) + new `selection-behavior.spec.ts` regression coverage |
| `tests/e2e/home/asset-search.spec.ts`, `tests/e2e/home/new-design-baseline.spec.ts` | Repair in-lane test bugs found by the maintained run (strict-mode duplicate locators; removed `aria-label` + "Presets" tab) |
| `docs/research/home-interface-2026-09-17.md` (new) | Research ledger |
| `docs/audits/home-interface-audit-2026-09-17.md` (new) | Baseline audit + implementation + validation evidence |
| This record | |

## Not touched (other writers, active at task start)

- Everything dirty in the shared tree: font pipeline
  (`packages/engine/src/font/**`, `FontBrowser/**`, `apps/desktop/src-tauri/src/font*.rs`),
  generative edit / diffusion, effects, Tauri build files, website docs,
  Cargo lockfiles.
- `packages/editor/src/settings*`, `SettingsDialog.tsx`, `LayersTree.tsx`,
  `apps/desktop/index.html`, and the density docs/research files owned by
  `docs/agents/interface-density-2026-09-17-ownership.md`.
- Editor hub files (`context.tsx`, `CanvasArea.tsx`, `Shell.tsx`) — never
  opened.

## Coordination notes

- `packages/home/**` was clean at task start; all edits are `packages/home`
  + the two new docs. Staging is path-scoped; the shared index is never
  touched broadly.
- The shared desktop dev server (`:1420`) is reused for the home lane
  (`reuseExistingServer`); no second dev server or port was occupied after
  the failed standalone-`vite` attempt (the harness config cannot resolve
  its dev deps from the package cwd under pnpm's isolated layout).
- `@varve/desktop` typecheck currently fails with 21 unrelated TS errors in
  `packages/editor/src/workspace/**` (in-progress work by other sessions);
  zero errors reference `packages/home`.
