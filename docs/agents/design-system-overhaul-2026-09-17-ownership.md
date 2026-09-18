# Design-system overhaul — ownership (2026-09-17, precision-first pass)

**Task:** the precision-first design-system overhaul mandate (tokens,
shell surfaces, density, typography, inputs, Inspector, Layers, HUDs,
motion, gated dynamic accents). This pass runs on `master`
(`/home/kevina/CodingProjects/varve`), base HEAD `30cf003dc`.

**Coordination context at start:** 232 dirty files from concurrent passes
(font/native, toolbar-surface D1 wiring, Inspector systems redesign,
export, home, adjustments). The mandate's density, input-surface,
toolbar/HUD, and Inspector-composition slices are owned by the passes
recorded in `docs/agents/interface-density-2026-09-17-ownership.md`,
`docs/agents/inspector-input-surface-system-2026-09-16-ownership.md`,
`docs/agents/inspector-systems-redesign-2026-09-17-ownership.md`, and
`docs/agents/toolbar-*-ownership.md`. This pass does the REMAINING work
and integrates with theirs; it does not re-do owned surfaces.

## Owned paths (this session edits)

| Path | Change |
|---|---|
| `packages/ui/src/tokens/color.ts` | Canvas-overlay semantic tokens (`canvasSelection`, `canvasHandle*`, `canvasGuide`) in SEMANTIC for all three themes + CONTRAST_PAIRS entries |
| `packages/ui/src/tokens/index.ts`, `packages/ui/scripts/generate-token-css.ts` | Emission for the new canvas tokens |
| `packages/ui/src/tokens/tokens.css` | Generated output (`pnpm tokens:generate`) |
| `packages/editor/src/SelectionOverlay.tsx` | Migrate marquee/selection/handle/guide colors from `--color-interactive-default`/`--color-accent-primary`/`--color-surface-overlay` aliases to the dedicated canvas tokens (identical rendered values at fixed mode — zero visual delta by construction) |
| `packages/editor/src/settings.ts` | `appearance.accentSource: 'fixed' \| 'document'` + normalizer (scoped hunk only; file carries an unrelated uncommitted section-state version hunk from the Inspector pass — never staged by this session) |
| `packages/editor/src/appearance/documentAccent.ts` (new) + `.test.ts` | Document-derived accent: bounded extraction, Oklab ramp derivation, AA validation, stale-result rejection, fixed fallback |
| `packages/editor/src/components/Settings/SettingsDialog.tsx` (+ focused test) | AppearanceSection: "Accent source" control + hint (file clean at claim; re-checked immediately before edit) |
| `packages/editor/src/appearance/applyDocumentAccent.ts` glue inside documentAccent.ts | Theme-aware application of accent-family custom properties; never focus ring, canvas selection, semantic feedback, or layer tags |
| Canvas-overlay CSS files listed after a fresh `git status` check | Hardcoded-duration transitions → `--duration-*` tokens so the global reduced-motion reset covers them (only in files with no active owner) |
| `packages/editor/src/components/Inspector/sections/photoSource.css` | Replace undefined `--color-accent`/`--color-warning` fallback tokens with the real tokens (currently the hardcoded hex fallbacks are what renders) |
| `tests/e2e/appearance/document-accent.spec.ts` (new) | Real-browser accent lifecycle: apply, fallback, close-document revert, artwork-pixel invariance |
| `docs/research/design-system-overhaul-2026-09-17.md` (new) | Research-to-decision ledger (R1–R16 refresh status, competitor evidence, repo audit) |
| `docs/architecture/design-token-system.md` (new or companion edits) | Surface/canvas-token contract + document-accent contract |
| `docs/audits/design-system-overhaul-2026-09-17.md` (new) | Evidence, before/after, validation report |
| This record | |

## Not touched (other writers, active at task start)

- `packages/editor/src/components/FloatingTextBar/FloatingTextBar.css`,
  `packages/ui/src/components/components.css` — uncommitted density
  wiring from the toolbar-surface 2026-09-17 pass (verified by diff).
- Inspector composition/registry/DisclosureSection/`inspector.css` —
  active owner (`inspector-systems-redesign-2026-09-17-ownership.md`).
  The §7 Inspector proving case is theirs; this pass verifies
  integration only.
- `inputPipeline.ts`, `ToolManager.ts`, pinch bridge, camera paths —
  canvas-navigation pass (2026-09-17 audit).
- `settings.ts` section-state version hunk, `editor.css` inspector
  hunks — staged never; only this session's scoped hunks are staged.

## Commit discipline

Progressive commits on `master` with explicit path lists; `git diff
--cached` verified before every commit; no push; destructive commands
prohibited; re-read shared files immediately before editing.

## Outcome (final)

| Commit | Slice |
|---|---|
| `fbedb56c5` | M1 canvas overlay token separation + 20-painter migration |
| `148c9c2c5` | M2 opt-in document-derived accent (setting, module, wiring, dialog, tests, E2E, screenshots) |
| `3c5bc907c` | M3 token drift repair (stale names, raw label sizes, raw durations) |

Incident: the concurrent Inspector session's `0c54ede60` staged the shared
`settings.ts` wholesale and swept in this session's already-written
`accentSource` hunks. Recorded in
`docs/audits/design-system-overhaul-2026-09-17.md`; not rewritten.
`editor.css` was shared three more times afterwards; each commit staged
only this session's hunks via index reverse-apply, verified against the
worktree (the other session's `insp-image-fill` block stayed theirs and
landed in their own commit).

Evidence: `docs/audits/design-system-overhaul-2026-09-17.md`,
`docs/research/design-system-overhaul-2026-09-17.md`,
`docs/architecture/design-token-system.md`.
