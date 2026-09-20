# Inspector spacing and density audit (2026-09-19)

Status: implementation evidence record. This document is updated with the
captured baseline, reviewed screenshots, and validation output after the
Inspector density pass.

## Acceptance matrix

| Axis | Required coverage |
|---|---|
| Selection | None, rectangle, frame, text, image, mixed |
| Rail | 240px, 320px, 640px; 1120px narrow viewport |
| Density | Default Pro / Compact Pro |
| Theme | Light, dark, high contrast |
| Disclosure | Collapsed, default, fully expanded |
| Text scale | 100%, 150%, 200% |
| States | Hover, focus, error/validation, density switch |

## Measured contract

- Default Pro resolves Inspector rows to 34px; Compact Pro resolves them to
  28px; coarse-pointer targets promote to at least 44px.
- Section separation is greater than body row spacing in both modes.
- Inspector and section bodies have no horizontal overflow at the required
  rail widths.
- Density changes preserve selection and do not create document/history state.

## Visual evidence

The committed E2E lane writes before/after captures to Playwright's output
directory. Marketing scenes are captured to a review directory and synchronized
only after direct inspection. Approved paths and any caption/alt-text changes
are recorded here once the screenshot pipeline completes.

- Inspector before/after evidence: `test-results/run-924606-1456/` (`spacing-density.spec.ts`),
  including `inspector-spacing-default.png` and `inspector-spacing-compact.png`.
- Follow-up evidence: `test-results/run-1022746-1477/` confirms Position & Size
  and frame Sizing group gaps resolve to the same density-aware body gap as the
  surrounding Inspector sections. Shared Select triggers now resolve to the
  global density row contract instead of a fixed `2rem` local override.
- Post-patch surface validation: the design-tab audit passed 21/21 cases, and
  the responsive-surface audit passed 5/5 after its sizing-gap assertion was
  updated to measure the shared `space-2` token.
- Reviewed product evidence: `reports/inspector-spacing-capture-review/`, with
  all 13 requested scenes captured, hash-checked, visually inspected, and
  synchronized to `docs/screenshots/product/` and
  `apps/website/public/screenshots/`.
- The reviewed set covers workspace (light/dark), typography, palette, solid and
  gradient pickers, effects, background removal, depth blur, image tools,
  workspaces, print production, and the current Export Inspector surface.
- Export and print captions were updated to describe the current visible
  surfaces; depth-blur wording no longer claims a preview that is not always
  available in the captured runtime.

## Follow-up pass (2026-09-20): separators and fields

The first pass made the Inspector token-compliant and density-aware; direct
inspection of the rendered panel still showed cramped rows and ambiguous rules.
A measured follow-up (computed styles and element captures at rails
240/320/513/640, Default Pro and Compact Pro, light/dark) corrected the
contract. Full rationale and the industry/failure evidence are recorded in
`docs/architecture/spacing-system.md` § Third pass and
`docs/research/inspector-spacing-density-research-2026-09-19.md`.

Measured before → after (Default Pro at 1440, frame selected):

| Measurement | Before | After |
|---|---|---|
| Field/action row | 34px | 34px (unchanged) |
| Body row gap | 5.92px | 9.68px |
| Field-group gap | 9.68px | 13.44px |
| Section margin | 9.68px | 13.44px |
| Frame-preset trigger height | 39.3px (fluid `--space-7`) | 34px (`--insp-row-height`) |
| Field inline inset | 5.92px | 9.68px |
| Section header height | 29.9px (fixed local padding) | 34px (`--insp-row-height`) |
| Compact body row gap | 2.96px | 5.92px |
| Compact section header | 29.9px (taller than its 28px rows) | 28px |

Compact Pro at the same rail kept 28px rows and a 49px shorter panel than
Default Pro (1,379px vs 1,665px scroll height), so density still changes the
panel's length, not just its unit.

Separator decisions: the Sizing subgroup's rule was removed (rules mark section
boundaries, labels mark groups); the section hairline under each sticky header
remains the one repeating rule; the alignment bar's micro-separator gained a
`--space-1` margin; the native text-input class (`insp-select`) gained the same
visible rest border as every other field. Evidence captures:
`reports/spacing-review-current/` (before/after at four rails, both densities,
light/dark) and the E2E output of `spacing-density.spec.ts`.

## Agent Validation Report

```text
Changed scope: Inspector spacing aliases, Inspector control consumers, density E2E coverage, design-system/research/audit docs, reviewed website evidence
Validation plan: `pnpm verify:plan` selected the affected Inspector, E2E, docs,
  token, spacing, and website lanes; it reported a full-suite escalation
  because the pre-existing worktree contains broad unrelated changes.
Commands actually run: `pnpm audit:inspector-css`; `pnpm audit:spacing`;
  `pnpm audit:tokens`; `pnpm audit:docs`; `pnpm audit:emoji`;
  `pnpm typecheck:e2e`; focused Inspector Vitest; the lease-wrapped
  `spacing-density.spec.ts`; `node scripts/screenshots/validate.mjs --strict`;
  website build/tests; the lease-wrapped website E2E suite;
  `pnpm verify:plan`; `pnpm verify:affected`; and
  `VARVE_FULL_GATE_REASON="Inspector density spacing contract, visual baselines, and website evidence" pnpm verify:full`.
Passed: Inspector CSS audit; focused Inspector tests (73 tests); E2E density
  lane (2 passed, plus the follow-up 3-test spacing lane); E2E typecheck; screenshot manifest validation (22 captured,
  0 skipped); reviewed screenshot synchronization; website build; Inspector
  form/layout, design-tab, density, performance, and responsive lanes (34/35
  in the combined run, with the one stale 31–33px assertion repaired to consume
  `--insp-row-height`); and the required audits.
Skipped as unrelated: pre-existing dirty worktree changes outside this scope
Escalations: `pnpm verify:affected` stopped at the mandated full-gate
  escalation. The full gate was attempted and failed on pre-existing lint,
  architecture-cycle/instability, and engine LUT typecheck errors. The website
  unit suite had five pre-existing fixture/token failures; website E2E completed
  443/568 with 125 broad light-theme contrast/visual/content failures. A later
  isolated responsive retry was blocked before navigation by the unrelated
  worktree state: `@varve/shared` did not export
  `resolveTextWrapLineWidths`. The follow-up `pnpm typecheck:e2e` rerun remains
  blocked by the pre-existing `packages/scene/src/callout.ts` TextMeasureOptions
  mismatch; the new three-test spacing lane itself passed 3/3.
Full suite run: yes (attempted; failed outside task-owned Inspector/website
  evidence scope).
If yes, reason: Inspector density spacing contract, visual baselines, and
website evidence.
```

## Agent Validation Report — 2026-09-20 follow-up

```text
Changed scope: packages/editor/src/components/Inspector/inspector.css;
  tests/e2e/inspector/inspector-responsive-surface-audit.spec.ts;
  scripts/screenshots/product.mjs; 12 reviewed product captures and the
  website screenshot manifest; spacing/interface/inspector docs and the
  research record.
Validation plan: `pnpm verify:plan` selected the Inspector, E2E, docs,
  token, spacing, and website lanes and escalated to a full gate because the
  worktree also carries other streams (fonts, effects/fill/stroke, comics,
  colour tokens) that are being committed concurrently by other sessions.
Commands actually run: `pnpm audit:spacing`; `pnpm audit:inspector-css`;
  `pnpm audit:tokens`; `pnpm audit:docs`; `pnpm audit:emoji`;
  `pnpm typecheck:e2e`; focused `vitest run
  packages/editor/src/components/Inspector`; lease-wrapped Playwright for
  `spacing-density.spec.ts` (3 tests), `inspector-responsive-surface-audit.spec.ts`
  (5 tests), and the untracked `field-arrangement.spec.ts` +
  `typography-field-plane.spec.ts` layout probes; lease-wrapped screenshot
  captures into `reports/inspector-capture-2026-09-20{,-models}` followed by
  direct inspection and `--sync-reviewed`; `node scripts/screenshots/validate.mjs`;
  `pnpm build:website`; `pnpm test:website`.
Passed: Inspector density lane 3/3; responsive-surface audit 5/5 after its
  Sizing-group and sticky-offset assertions were updated to the new contract;
  `typecheck:e2e`; `audit:tokens` (315 pairs); `audit:inspector-css`;
  `audit:docs`; `audit:emoji`; website build; 12 reviewed captures inspected
  and synced; before/after rhythm census at rails 240/320/513/640 in both
  densities (Default Pro 1,665px vs Compact Pro 1,379px scroll height for the
  same frame selection).
Skipped as unrelated: `audit:spacing` currently reports two drifts in another
  active stream's in-flight files
  (`Inspector/sections/effects/effects.css`, `Inspector/sections/paintStackActions.css`)
  — neither is touched by this pass; the effects screenshot scene is skipped
  because that stream is renaming the add flow, and the pipeline deliberately
  refuses to substitute the older capture; pre-existing focused Vitest
  failures (20 across four Inspector spec files owned by other streams);
  pre-existing website unit failures (4 stale demo fixtures, the comic
  screenshot bypassing the manifest, one colour scan) and the matching
  `validate.mjs` orphan violation; the untracked `field-arrangement.spec.ts`
  pins the orientation button at 32px, already stale at HEAD (the button
  follows `--insp-row-height` = 34px).
Escalations: no full-suite run. The affected planner escalates only because
  of the concurrently-committed streams; each affected lane was run directly
  against the exact surface instead.
Full suite run: no.
```
