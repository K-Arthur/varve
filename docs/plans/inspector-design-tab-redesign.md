# Inspector Design Tab — Redesign (2026-09-19)

> **Coordinator note — pass 2 (current).** This is the live ownership and
> progress record for the Inspector Design-tab work. Pass 1 (earlier on
> 2026-09-19) closed with commit `01a043806`; its record is preserved below
> the pass-2 log. Pass 2 is an **independent re-run**: fresh baseline
> matrix, fresh web research, fresh audit, fresh spec — it does not inherit
> pass-1 findings as authority.

## Claimed areas (pass 2)

- `packages/editor/src/components/Inspector/**` (Design tab, controls,
  sections, css) — `SectionManagerTrigger.tsx` + `PropertiesPanel.tsx` were
  dirty at session start (uncommitted pass-1 tail: prop-threading refactor);
  they are left as found, re-read before any edit, and validated before
  being committed.
- Inspector-owned token additions in `packages/ui/src/tokens/**` +
  regenerated `tokens.css` (via `tokens:generate` only).
- `scripts/quality/audit-inspector-css.mjs` + its policy tests.
- Inspector E2E specs under `tests/e2e/inspector/**` used for evidence.
- Docs: this file, `docs/research/inspector-design-tab-research.md`,
  `docs/audits/inspector-design-tab-audit-2026-09-19-pass2.md`,
  `docs/design-system/inspector-spec-pass2.md`, `docs/README.md`.
- Evidence: `reports/inspector-redesign/baseline-matrix/**`,
  `reports/inspector-redesign/after-matrix/**` (git-ignored).

## Current phase

Phase 4 — implementation of `inspector-spec-pass2.md` units IMPL-1..IMPL-5.

## Pass-2 implementation log

| Unit | Findings | Change | Status |
|---|---|---|---|
| IMPL-1 | IA-002/003/018/019/021/022 | Tokens: focus-ring geometry (primitive tier), `--insp-icon-size(-lg)`, `--insp-row-height`; label/value sizes fixed rem; wrap-modifier line-height tokenized; 4 raw font-size literals fixed; gate E4/W2/W3/W4 | pending |
| IMPL-2 | IA-010/011/012 | One segmented selected-state; Weight/Style row alignment; ContrastIndicator placement; icon-step normalization in visible offenders | pending |
| IMPL-3 | IA-008 | Pair-row trailing-slot contract (W/H vs X/Y right edges) | pending |
| IMPL-4 | IA-009/013/014/015 | Bounded layout repairs (mask pills, gutter drift, input-width systems) | pending |
| IMPL-5 | IA-024 | DocumentPanel `type="number"` → NumberField migration (8 inputs) | pending |

Deferred (recorded in spec §5): Image-section grouping (IA-016),
`prototype-flow` wiring (IA-023), Corner-Radius folding, Storybook for
editor primitives (documented deviation, spec §7).

## Pass-2 validation progress

- Baseline matrix re-captured fresh (3/3 passed, 05:11–05:25): 9 scenarios ×
  3 rails light; 3 themes; 3 text scales; shots + computed metrics.
- `pnpm verify:plan` at start: full-suite escalation YES — caused by the
  shared dirty tree (other agents' toolchain files), not inspector paths;
  affected lanes remain the inner loop.
- `pnpm audit:tokens`: 213/213 pairs pass across 3 themes (start state).

## Expected shared files (handle with care)

- `packages/editor/src/components/Inspector/inspector.css` (single large
  stylesheet)
- `packages/ui` token sources + generated `tokens.css` (generator-owned)
- `packages/editor/src/components/Shell/**` — DO NOT TOUCH (hub)
- `packages/editor/src/context.tsx` — DO NOT TOUCH (hub at import ceiling)

## Risky shared surfaces (other agents)

Uncommitted changes from other agents at pass-2 start:
`apps/desktop/src-tauri/**`, FontBrowser, StatusBar, backgroundRemoval,
canvas/clipboard, scene/shared/engine font modules, various docs and E2E
specs. Not claimed here; never reverted/overwritten.

---

# Pass 1 record (closed 2026-09-19, commit 01a043806)

Phase 6 — complete. All bounded defects repaired, validated, and committed
(34110ac4c, 0aeb85a14, 37939087b, d31fc2e2b, 81a1fbecb, c2fb8d75a,
eadfaf980, 7eea0fcc1); the report is
`docs/audits/inspector-design-tab-redesign-report-2026-09-19.md`.

## Pass-1 implementation log

| Unit | Finding → requirement | Change |
|---|---|---|
| IMPL-001 | AUD-006 → REQ-009 | 66 undefined token references migrated to canonical tokens across inspector stylesheets. |
| IMPL-002 | AUD-004 → REQ-006 | `--tracking-micro` token; 10 literal tracking sites normalized. |
| IMPL-003 | AUD-005 → REQ-007/008 | Popover geometry tokens; badge type raised; 6 raw durations tokenized. |
| IMPL-004 | AUD-008 → REQ-010 | FontDetectSection native select → shared Select. |
| IMPL-005 | AUD-010/011/018 → REQ-011 | Dead CSS/pickers removed; `.insp-swatch--sm`, `.insp-badge--info` defined. |
| IMPL-007 | AUD-013 → REQ-012 | `getDesignTabSectionIds()`; section-manager lists cross-surface sections. |
| IMPL-008 | AUD-015 → REQ-013 | Insights copy/a11y fixes. |
| IMPL-009 | AUD-017 → REQ-005 | Axis-slider layout; range hit areas. |
| IMPL-010 | REQ-014 | `audit-inspector-css` gate + lane + impact rule. |

Pass-1 open items at close: Object Filters IA (superseded by pass-2
IA-026: single add entry verified), DocumentPanel numerics (→ pass-2
IMPL-5), alignment attribution (→ pass-2 IA-001), workspace-contract test,
screen-reader lane.
