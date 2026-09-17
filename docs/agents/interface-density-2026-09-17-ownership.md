# Interface density (Default Pro / Compact Pro) — ownership (2026-09-17)

**Task:** design-system workstream §3 ("Separate workflow density from input
accessibility") — make interface density an explicit, user-controllable
dimension instead of a CSS contract with no runtime consumer; wire the
already-dead "UI font size" preference through the same application path;
coordinate the Layers virtualizer with density changes.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
(no branch or worktree created, per task instruction).
**Base HEAD at start:** `cd788635b`.

## Evidence gate (before production edits)

1. `pnpm verify:plan` — run at base HEAD; escalated
   (`FULL-SUITE ESCALATION: YES`, reason: the shared tree carries 144 dirty
   files from other sessions, including toolchain/validation-adjacent paths).
   The escalation belongs to the combined integration checkpoint; this
   session's inner loop is bounded to owned files below.
2. Baseline browser evidence at isolated port 1520
   (`/tmp/opencode/density-baseline/baseline-*.png`, measurements in
   `docs/research/interface-density-2026-09-17.md`):
   - `data-density` is never set by any runtime surface; the `:root`
     comfortable contract silently applies (Layers rows measure 34px
     min-height, rendered 37.8px, gap 2.96px, padding 5.92px).
   - `LayersTree` virtualizer `estimateSize: () => 28` under-estimates the
     real comfortable row height; `measureElement` corrects after mount, so
     the estimate mismatch only costs scroll-math accuracy before remeasure.
   - Settings ▸ Appearance exposes "UI font size" with **no runtime
     consumer** — the stored value changes nothing (dead preference, §5
     "unconnected control" class of defect).

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/editor/src/settings.ts` | `appearance.uiDensity: 'default' \| 'compact'` + normalization for it and the legacy `fontSizeUI` |
| `packages/editor/src/settings/interfaceDensity.ts` (new) | Canonical density/font application module: root attribute mapping, font-size application, subscriber notification |
| `packages/editor/src/settings/interfaceDensity.test.ts` (new) | Unit coverage |
| `packages/editor/src/components/Settings/SettingsContext.tsx` | One application effect (mount + change) wiring both preferences; reset flows through the same path |
| `packages/editor/src/components/Settings/SettingsDialog.tsx` | AppearanceSection: "Interface density" control + hint. **Hunk-level coordination:** the file carries an unrelated uncommitted `GeneralSection` hunk (canvas background reset) from another session; this session edits only the `AppearanceSection` and stages only its own hunk |
| `packages/editor/src/components/Settings/SettingsDialog.test.tsx` | Focused coverage for the new control (file is clean at task start) |
| `packages/editor/src/components/LayersPanel/LayersTree.tsx` | Density-aware `estimateSize` + remeasure on density change (no stale cached heights) |
| `tests/e2e/settings/density.spec.ts` (new) | Real-browser density/font preference lifecycle |
| `apps/desktop/index.html` | Extend the existing pre-paint script: apply persisted density/UI font before first paint (no flash) |
| `docs/architecture/interface-sizing-system.md` | Density contract: runtime attribute, two modes, virtualization rule, touch-accommodation decision |
| `docs/research/interface-density-2026-09-17.md` (new) | Research ledger + baseline measurements + decision record |
| `docs/audits/interface-density-2026-09-17.md` (new) | Implementation evidence + validation report |
| This record | |

## Not touched (other writers, active at task start)

- The 144-file dirty set from concurrent sessions (font pipeline, generative
  editing, effects, Tauri build files, website docs, Cargo lockfiles — see
  `git status` at session start). In particular `SettingsDialog.tsx`'s
  GeneralSection hunk and everything under `packages/engine/src/font/`.
- Inspector surfaces (`NumberField`, `DocumentPanel`, `FillSection`,
  `PropertiesPanel`, `sectionRegistry`, Inspector CSS) — active owners per
  `docs/agents/inspector-*-2026-09-16-ownership.md`.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files with import
  budgets; not needed for this change.
- The `data-density` CSS contract in `packages/ui/src/components/components.css`
  already exists (compact 28 / comfortable 34 / cozy 42) and is consumed by
  the Layers panel; no token change is required, so the file is not edited.

## Commit discipline

Progressive commits on `master`, staged with explicit path lists. The
SettingsDialog commit stages only this session's AppearanceSection hunk
(verified with `git diff --cached` immediately before commit). No push, no
tag, no deploy.

## Validation ownership

Focused unit tests for settings/manager; `tests/e2e/settings/density.spec.ts`
on an isolated `VARVE_E2E_PORT`; `audit:tokens` (appearance-touching change);
`audit:docs`/`audit:emoji` (docs written); LayersPanel unit directory run for
the virtualizer change. Physical touch/pen hardware and screen readers remain
unavailable in this environment — recorded as unverified lanes, not passed.
