# Validation Repair Progress

Date: 2026-08-07. Branch: master (18 commits ahead of origin/master; large
uncommitted concurrent work present — WebGPU effects kernels, workspace-window
popups, adjustment/masking work — owned by other agents and intentionally
preserved).

## Canonical commands (confirmed)

| Area | Command | CI? |
|------|---------|-----|
| Formatting | `biome ci --formatter-enabled=true --linter-enabled=false .`; `cargo fmt --all -- --check` | cargo fmt: ci.yml:57 |
| TypeScript | `pnpm typecheck` (20 packages `tsc --noEmit` + `pnpm typecheck:e2e`) | ci.yml:157, build.yml |
| Lint | `pnpm lint` (`biome check .`) | ci.yml:159 |
| Rust lint | `cargo clippy --workspace --all-targets -- -D warnings` | ci.yml:59 |
| Tests | `pnpm test` (ci-tools + vitest run); `cargo test --workspace` | ci.yml |
| Audits | `pnpm audit:tokens`, `pnpm audit:emoji`, `pnpm audit:docs` | ci.yml |
| A11y | biome a11y rules; axe-core in Playwright E2E (`tests/e2e/a11y/`) | E2E job |

## Baseline (2026-08-07, this pass)

| Area | Command | Initial Result | Root Cause | Status | Verification |
|------|---------|---------------:|------------|--------|--------------|
| JS format | `biome ci` format-only | PASS | — | Done | exit 0 |
| Rust format | `cargo fmt --check` | 55 diffs | `crates/varve-effects/` committed in fbf35e09 without formatting | Fixed | exit 0 |
| TypeScript | `pnpm typecheck` | 1 error | `contract.test.ts` kind union stale: `describeWindowContract(..., 'browser-popup')` not in `'native' \| 'single-window'` | Fixed | exit 0, 20 pkgs + E2E |
| E2E types | `pnpm typecheck:e2e` | PASS (after fix) | — | Done | exit 0 |
| Lint | `pnpm lint` | 4 errors, 36 W, 16 I | see fix batches | Fixed | exit 0, 0 diagnostics |
| Rust lint | `cargo clippy -p varve-effects` | 18 errors | manual_clamp ×11, needless_range_loop ×6, unnecessary_cast ×2, dead_code ×1 | Fixed | exit 0 |
| Rust lint | `cargo clippy --workspace` | running | — | In progress | — |
| Tokens | `pnpm audit:tokens` | PASS | — | Done | exit 0 |
| Emoji | `pnpm audit:emoji` | PASS | — | Done | exit 0 |
| Docs | `pnpm audit:docs` | PASS (452 docs, 150 ADRs) | — | Done | exit 0 |

## Fix batches

### Batch 1 — TypeScript (blocking)
`packages/platform/src/windows/__tests__/contract.test.ts`: widened
`describeWindowContract` kind param to include `'browser-popup'`, matching the
working tree's ADR-0034 capability model (`browser.ts` now reports
`browser-popup`). `pnpm typecheck` exit 0.

### Batch 2 — Lint errors (blocking)
- `packages/compositor/scripts/gen-wgsl-mirrors.mjs`: organizeImports +
  formatter + stale `biome-ignore` removed after the regex fix
  (`\n  buildPasses` → `\n {2}buildPasses` — same match, clearer intent).
- `packages/editor/src/export/flattenForExport.ts`: organizeImports (safe).
- `packages/engine/src/liveEffects/__tests__/dispatch.test.ts`: organizeImports
  (safe, untracked concurrent file).

### Batch 3 — Mechanical lint warnings (biome unsafe fixes, all reviewed, semantics identical)
- useLiteralKeys ×12: `nodes['n1_aaaa']` → `nodes.n1_aaaa` (history merge tests,
  editorHistorySession, halftonePersistence).
- useTemplate ×5: `'PAGE: ' + x` → template literals (table-dom-probe spec,
  capture-detach/capture-multi).
- useOptionalChain ×9: `!node || node.kind !== 'text'` → `node?.kind !== 'text'`
  (storyOps ×6, storyCompose, version-migrations-v218).
- noUnusedFunctionParameters ×3: `(x, y)` → `(x, _y)` (kernels.test).
- noUnusedImports ×1: dropped unused `adjustmentDefaults` (wiring.test).

### Batch 4 — Accessibility (manual, real defects)
- `HistoryPanel.tsx`: 21 buttons gained `type="button"` (default is `submit`;
  the panel's formless buttons could submit a wrapping form; also the tab
  buttons and action rows). `noArrayIndexKey` at entity-change list: now keyed
  on the model's deterministic `SemanticChange.changeId` (real stable-key fix).
- `WorkspaceTabs.tsx`: `aria-label="customized"` on a decorative `<span>` was
  ignored by AT (aria-label unsupported on generic elements) — replaced with
  `aria-hidden` dot + `.sr-only` "customized" text inside the tab button, so
  screen readers announce the customized state.
- `PageToolOverlay.tsx`: corner handles keyed by `i` → keyed by unique corner
  coordinates (`${c.x},${c.y}`).
- `textThreadActions.ts`: `doc.stories?.[storyId]!` (non-null assertion on
  optional chain) → explicit invariant check with throw, type-safe.

### Batch 5 — CSS ordering (noDescendingSpecificity)
- `IconBrowser.css`: base `.icon-card__name` moved before the
  `.icon-card--compact .icon-card__name` modifier (order-independent cascade,
  removes ambiguity).
- `Inspector/inspector.css`: base `.insp-num` block moved above the
  `.insp-field-row__split > .insp-num` override.

### Batch 6 — Rust (varve-effects, committed code failing CI gates)
- manual_clamp ×11 → `.clamp()`: also a port-parity correction — Rust
  `f64::max().min()` coerces NaN to a bound, TS `Math.max/min` and `.clamp()`
  propagate NaN; the crate is a TS port, so clamp matches the source semantics.
- needless_range_loop ×6 → `iter_mut().enumerate()` (lin_lut, blur kernel,
  caustics lap, bloom combine loops). `lap` is sized exactly `field_n`, so the
  rewrite is bound-equivalent.
- unnecessary_cast ×2: `k as i32`, `(level_count - 1) as i32` (already i32).
- dead_code ×1: removed unused `load_named` test helper.
- Verified: `cargo test -p varve-effects` PASS (agreement + unit), clippy
  `-D warnings` PASS, fmt PASS.

## Verification

| Command | Result |
|---------|--------|
| `pnpm typecheck` | PASS (exit 0, 20/20 pkgs + E2E) |
| `pnpm lint` | PASS (exit 0, 0 errors 0 warnings 0 infos) |
| `biome ci` format-only | PASS |
| `pnpm audit:tokens` / `audit:emoji` / `audit:docs` | PASS |
| `pnpm --filter @varve/history test` | PASS |
| `pnpm --filter @varve/platform test` | PASS |
| `pnpm --filter @varve/scene test` | PASS |
| `pnpm --filter @varve/engine test` | PASS |
| `pnpm --filter @varve/compositor test` | PASS |
| editor targeted (editorHistorySession, storyCompose, textThreadActions, WorkspaceTabs) | PASS (25/25) |
| `cargo test -p varve-effects` | PASS |
| `cargo clippy -p varve-effects --all-targets -- -D warnings` | PASS |
| `cargo fmt --all -- --check` | PASS |
| editor full suite | in progress (background) |
| `cargo clippy --workspace` | in progress (background) |
| `pnpm test` full | pending — run after editor suite |

## Concurrent work preserved (untouched)

Uncommitted WebGPU-effects/adjustment/workspace-window WIP across
packages/compositor, packages/editor, packages/engine, packages/cli,
crates/varve-bridge, tests/e2e, docs — as found. Only additions:
`type="button"`/keys in HistoryPanel, sr-only in WorkspaceTabs, optional-chain
fixes in committed files, literal-key/template rewrites, and varve-effects
clippy/fmt fixes (crate fully committed, no in-flight edits).
