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
