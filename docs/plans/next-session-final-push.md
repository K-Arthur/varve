# Next Session — Final Push Plan

> Written 2026-06-29. All remaining deferred items must be completed with no further deferments.

## Context

The Home Surface deferred items (13 items) are all [OK] complete. What remains are:
1. **Productionizing** the existing editor features (snapping, codegen tokens, spec panel polish)
2. **Codegen gap items** from the other branch's working tree
3. **Stabilization** — lint, typecheck, test across ALL packages

---

## [HIGH] Must-Complete Items

### 1. Merge pending codegen/editor changes

The working tree has uncommitted changes from a parallel branch: codegen (tokens, tailwind improvements, flutter/swiftui tweaks), editor (snapping system, spec panel updates). These need to be merged cleanly.

**Files:**
- `packages/codegen/src/tokens.ts` — new file: token name resolution for Tailwind export
- `packages/codegen/src/tailwind.ts` — imports `resolveTokenName`, adds `variableStore` option
- `packages/codegen/src/flutter.ts` — minor tweaks
- `packages/codegen/src/swiftui.ts` — minor tweaks
- `packages/codegen/src/codegen.test.ts` — expanded tests
- `packages/editor/src/tools/snapping.ts` — new file: snap-to-grid/alignment
- `packages/editor/src/components/SnapGuidesOverlay.tsx` — new file: visual snap indicators
- `packages/editor/src/tools/types.ts` — updated for snap state
- `packages/editor/src/tools/SelectTool.ts` — integrate snapping
- `packages/editor/src/CanvasArea.tsx` — add snap overlay
- `packages/editor/src/components/SpecPanel/*.tsx` — polish fixes

**Test targets:**
```
pnpm -r --filter "@varve/codegen" --filter "@varve/editor" typecheck
pnpm -r --filter "@varve/codegen" test
pnpm -r --filter "@varve/editor" test
cargo test --workspace
```

### 2. Snapping system — integration tests

The snapping module (`packages/editor/src/tools/snapping.ts`) needs tests:
- Snap to grid (configurable grid size)
- Snap to alignment (edges of sibling nodes)
- Snap distance threshold
- Snap guide rendering

### 3. Codegen token-aware export — E2E

- Test `exportNodeToTailwind` with `variableStore` + `tokens` options
- Verify token names resolve correctly against the token map
- Test fallback to arbitrary values when token not found

### 4. Editor typecheck — zero errors

All 13 packages must pass `tsc --noEmit`:
```bash
pnpm typecheck
```

---

## [WIP] Polish Items (if time permits)

### 5. CSS layout thrash audit

- Verify no layout recalculations on scroll in FileGrid/FileList
- Verify `@tanstack/react-virtual` overscan is optimal (currently 2 for grid, 5 for list)
- Profile with React DevTools

### 6. Accessibility pass

- Run `axe-core` on all sections of Home surface
- Run `axe-core` on editor (SpecPanel, LayersPanel, InspectorPanel, Toolbar)
- Verify keyboard navigation in all interactive regions

### 7. Cross-OS build matrix

- GitHub Actions: `ubuntu-latest`, `macos-latest`, `windows-latest`
- Build + smoke test (Playwright on ubuntu, typecheck on all)
- Verify `.AppImage` / `.dmg` / `.msi` packaging

### 8. Documentation sweep

- Verify AGENTS.md test counts match reality
- Verify all `docs/plans/*.md` are marked complete or have a clear status
- Remove stale plan docs

---

## Execution Order

```
Phase 1: Merge codegen changes
  → pnpm -r --filter "@varve/codegen" typecheck
  → pnpm -r --filter "@varve/codegen" test (33 tests)
  → cargo test --workspace (82 tests)

Phase 2: Merge editor changes  
  → pnpm -r --filter "@varve/editor" typecheck
  → pnpm -r --filter "@varve/editor" test (130+ tests)
  → Write snapping tests (item 2)

Phase 3: Full gate
  → pnpm typecheck (ALL 13 packages)
  → pnpm lint
  → pnpm audit:tokens
  → pnpm audit:emoji
  → pnpm test:e2e --filter @varve/home (21 tests)

Phase 4: Polish (time permitting)
  → axe-core pass
  → build matrix
  → doc sweep
```

## Verification Gate

```bash
just gate  # format-check + lint + test + audits
pnpm typecheck
pnpm test:e2e --filter @varve/home
cargo test --workspace
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
