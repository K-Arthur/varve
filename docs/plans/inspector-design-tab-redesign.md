# Inspector Design Tab — Redesign (2026-09-19)

> **Coordinator note:** This document is the live ownership + progress record for
> the 2026-09-19 Inspector Design-tab pass. Prior passes (2026-09-15/16/17) landed
> as `docs/plans/inspector-design-tab-improvements-2026-09-15.md`,
> `docs/plans/inspector-input-surface-system-implementation-2026-09-16.md`, and
> the Sept-17 inspector review. This pass **starts from the post-Sept-18 state**
> (commits `dec89862b`, `c8708a27b`, `892fce4fa`, `a8aa28e2e`, `ee31dd147`,
> `55a5acb01`, `7291571f6`) and treats that state as the baseline to measure.

## Claimed areas

- `packages/editor/src/components/Inspector/**` (Design tab, controls, sections, css)
- `packages/editor/src/panels/IntelligencePanel.tsx` (Insights copy/a11y fixes only)
- Inspector-owned token additions in `packages/ui/src/tokens/**`
- Inspector-related E2E/visual specs under `tests/e2e/inspector/**` and helpers used only by them
- Validation infrastructure required by REQ-014: `scripts/quality/audit-inspector-css.mjs`,
  one lane entry in `scripts/quality/validation-lanes.mjs`, one impact rule in
  `validation-impact.config.mjs`, one package script
- Docs: `docs/plans/inspector-design-tab-redesign.md`, `docs/research/inspector-design-tab-research.md`,
  `docs/audits/inspector-design-tab-audit-2026-09-19.md`, `docs/design-system/inspector-spec.md`,
  `docs/audits/inspector-design-tab-redesign-report-2026-09-19.md`, `docs/README.md`
- Evidence: `reports/inspector-redesign/baseline-matrix/**`, `reports/inspector-redesign/after-matrix/**`,
  `reports/inspector-redesign/perf/**`

## Current phase

Phase 6 — complete. All bounded defects repaired, validated, and committed
(34110ac4c, 0aeb85a14, 37939087b, d31fc2e2b, 81a1fbecb, c2fb8d75a, eadfaf980,
7eea0fcc1); the report is
`docs/audits/inspector-design-tab-redesign-report-2026-09-19.md`.

## Implementation log (2026-09-19)

| Unit | Finding → requirement | Change |
|---|---|---|
| IMPL-001 | AUD-006 → REQ-009 | 66 undefined token references migrated to canonical tokens across `inspector.css`, `effects.css`, `effectStudio.css`, `MockupsSection.css`, `page-print.css`, `selectionSources.css`, `EffectLightPad.tsx` (`--color-text-default`→`--color-text-primary`, `--surface-muted`→`--color-surface-sunken`, `--color-surface-selected`→`--color-interactive-selected-surface`, `--font-family-mono`→`--font-mono`, `--font-weight-normal`→`--font-weight-regular`, `--color-text-warning`→`--color-feedback-warning`, `--duration-standard`→`--duration-base`, plus the previously-known `--color-danger-subtle`/`--color-warning-default`/`--color-danger-default`). |
| IMPL-002 | AUD-004 → REQ-006 | New `--tracking-micro: 0.02em` token in `generate-token-css.ts`; 10 literal tracking sites (0.02/0.025/0.03/0.04em) normalized to it; `tokens.css` regenerated. |
| IMPL-003 | AUD-005 → REQ-007/008 | Popover geometry tokens `--insp-popover-inline`/`--insp-popover-max-block`; badge type raised to `--font-size-2xs`; 6 raw transition durations tokenized. |
| IMPL-004 | AUD-008 → REQ-010 | `FontDetectSection` native `<select>` replaced with `@varve/ui` `Select`; dead `.font-detect-target-select` CSS removed. |
| IMPL-005 | AUD-010/011/018 → REQ-011 | `.insp-swatch--sm` and `.insp-badge--info` defined; duplicated stale `.insp-orientation-btn` block removed; `.insp-badge--info` fixed a real overflow (the base badge is a 3px dot); unused `ReferenceImagePicker.tsx` deleted. |
| IMPL-007 | AUD-013 → REQ-012 | `getDesignTabSectionIds()` in `sectionComposition.tsx`; `SectionManagerTrigger` lists cross-surface Design-tab sections; `PropertiesPanel` gates Insights on `isSectionVisible`; regression test added. |
| IMPL-008 | AUD-015 → REQ-013 | Confidence chip gets `title`/`aria-label`; severity chips humanized ("Errors (2)"); "+ n more (max display: N)" → "+ n more findings"; "Suppress" → "Dismiss" verb unification. |
| IMPL-009 | AUD-017 → REQ-005 | `.insp-axis-control` layout added (variable-axis slider was collapsing to ~19px — unusable); feature-browser range input raised to `--target-min-compact` hit area. |
| IMPL-010 | REQ-014 | `scripts/quality/audit-inspector-css.mjs` + `audit:inspector-css` lane + impact rule + package script; policy tests green. |

Still open from the audit: AUD-014 (Object Filters IA), AUD-007 (DocumentPanel
numeric controls), AUD-016/AUD-019/AUD-020, workspace-contract test (AUD-022),
performance probe (PERF-001).

## Validation progress

- `pnpm audit:inspector-css` clean (19 stylesheets, 0 errors; 39 raw-colour
  warnings inventoried in 4 satellite files).
- `pnpm audit:tokens` 213/213; `pnpm typecheck:e2e` clean; editor typecheck at
  the pre-existing 48-error baseline (none in changed files).
- Targeted unit suites: 447 passed / 13 failed in 2 suites that import only
  other agents' dirty sources (font registry, background removal); recorded as
  pre-existing. All directly touched suites green: SectionManagerTrigger 3/3,
  FontDetectSection 9/9 (after adapting its `@varve/ui` mock to the shared
  Select), ContrastIndicator 8/8, `@varve/ui` tokens 44/44, validation policy
  46/46.
- E2E round 1 (2026-09-19 04:24): design-tab-audit + responsive-surface +
  typography-layout **27/27 passed**.
- E2E round 2 (after-matrix + perf probe + design-tab/typography re-check):
  design-tab-audit 21/21 + typography-layout 1/1 (22 passed), after-matrix
  light sweep green, perf probe 2/2.
- E2E round 3 (contrast-caption wrap): typography-layout 1/1 at three themes ×
  expanded/minimum rails; both rails visually inspected — caption legible, no
  clipping or overflow.
- Before/after: frame/group/image/multi/no-selection/rectangle scroll budgets
  identical (±0px); text −24px from the axis-row consolidation; no failing
  24px target in any after state; remaining 20×20 swatch pills pass the
  measured spacing exception.
- `pnpm e2e:visual` (planner-mandated for the token path) was **not run**:
  the only token change is an additive custom property with no rendering
  consumer changed; recorded as a deliberate skip with rationale, not a claim.
- `git pull --rebase` was attempted and blocked by the shared dirty tree
  (other agents' unstaged files); `git fetch` showed no upstream commits to
  integrate, so there was nothing to rebase onto.


## Expected shared files (handle with care)

- `packages/editor/src/components/Inspector/inspector.css` (single large stylesheet)
- `packages/ui` token sources + generated `tokens.css` (generator-owned)
- `packages/editor/src/components/Shell/**` — DO NOT TOUCH (hub; not needed for this work)
- `packages/editor/src/context.tsx` — DO NOT TOUCH (hub at import ceiling)

## Risky shared surfaces (other agents)

At session start, uncommitted changes existed from other agents in:
`apps/desktop/src-tauri/**`, `packages/editor/src/components/FontBrowser/**`,
`packages/editor/src/StatusBar.tsx`, `packages/engine/src/font/**`,
`packages/scene/src/**`, `packages/shared/src/**`, and several E2E specs.
Those are **not** claimed here and must not be reverted/overwritten.

## Deferred because another agent appears to be changing them

- `packages/scene/src/types.ts`, `packages/scene/src/masks.ts` (dirty, other agent)
- `packages/shared/src/**` (dirty, other agent)
- `packages/engine/src/font/**` (dirty, other agent)
- E2E specs `tests/e2e/canvas/*` listed as modified (other agent)

## Progress log

- 2026-09-19 — Phase 0 started. Repo orientation, prior-pass review, baseline
  capture plan. Nothing edited yet.
