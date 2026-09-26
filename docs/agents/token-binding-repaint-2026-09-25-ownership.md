# Ownership — token binding, canvas repaint, and Inspector bound-state (2026-09-25)

- **Session scope:** make document bindings actually reach canvas pixels and
  keep the Inspector honest about bound/unbound state.
- **Branch:** `master` (no worktrees created; no stashes/resets/rebases run).
- **Started from HEAD:** `193e2ee20`.

## Files this session owns (edit + stage exclusively)

| File | Change |
| --- | --- |
| `packages/scene/src/bindings.ts` | `fill` drives the primary solid paint; `cornerRadius`; text metrics; `strokeWeight:<rowId>`; `fillBindingApplicability()` |
| `packages/scene/src/selectedPaints.ts` | bound-colour read parity with the renderer |
| `packages/scene/src/__tests__/bindings.test.ts` | +10 tests (8 initially failing = reproduction) |
| `packages/scene/src/selectedPaints.test.ts` | +2 tests (bound slot, no gradient flattening) |
| `packages/editor/src/CanvasArea.tsx` | `docVersion` bump when a bound node's IR is invalidated |
| `packages/editor/src/components/Inspector/sections/FillSection.tsx` | menu gating + reason, detach-on-colour-edit, badge state, announce |
| `packages/editor/src/components/Inspector/sections/StrokeSection.tsx` | `BindingMenu` for stroke weight, bound/read-only display, announce |
| `packages/editor/src/components/Inspector/sections/PositionSizeSection.tsx` | bound display + unbind for W/H/rotation, announce |
| `packages/editor/src/components/Inspector/sections/CornerRadiusSection.tsx` | bound display + unbind, announce |
| `packages/editor/src/components/Inspector/sections/TypographySection.tsx` | bound display + unbind for 5 metrics, announce |
| `packages/editor/src/components/Inspector/sections/AppearanceSection.tsx` | bind/unbind announce |
| `packages/editor/src/components/Inspector/sections/TableAppearanceSection.tsx` | shared badge skin (inline literals removed) |
| `packages/editor/src/components/Inspector/inspector.css` | `.varve-binding-badge` skin (+ `--warning`) |
| `packages/editor/src/components/Inspector/sections/__tests__/FillSection.test.tsx` | +5 tests (menu honesty, badge state, detach) |
| `tests/e2e/canvas/variable-binding-repaint.spec.ts` | new browser proof (pixel counts) |
| `docs/tokens/dtcg-interop-evidence-2026-09-25.md` | §6 binding/repaint pass |
| `docs/screenshots/token-binding-repaint/*` | inspected evidence |

## Files a concurrent session owns — NOT edited here

Observed mutating in the same working tree during this session (left
untouched; their in-flight typecheck/test failures are recorded as foreign):

- `packages/editor/src/components/TokenSync/*`, `packages/editor/src/tokenSync/*`
- `packages/editor/src/VariablePanel.tsx`, `.../Inspector/controls/BindingMenu.tsx`
- `packages/tokens/src/{resolver,index}.ts`, `packages/tokens/src/formatTokenResolver.ts`
- `packages/scene/src/tokens/{colorBridge,syncApply}.ts`, `runtimeProjection.test.ts`
- `packages/compositor/src/**`, `apps/website/src/pages/features/design-tokens.astro`
- `packages/editor/src/tools/{CloneStamp,HealingBrush,Patch,SpotHeal}Tool.ts`, retouch UI
- `crates/varve-bridge/tests/wgsl_validation.rs`
- docs/screenshots from the canvas-fluidity and workspace-switcher reviews

## Standing rules applied

- Staged only the files listed above, by explicit pathspec.
- No `git stash`/`reset`/`clean`/`rebase`/`--force`; no pushes.
- Heavy E2E runs wrapped in `scripts/quality/heavy-lease.mjs`, `--workers=1`.
- The temporary defect-reproduction harness reverted and restored two files
  inside a single shell invocation with a restore trap
  (`/tmp/opencode/varve-repro.sh`); restore was verified by re-running the
  spec green afterwards.
