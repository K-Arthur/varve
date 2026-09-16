# Typography + Insights review — verification report (2026-09-16)

Scope and rationale: `docs/research/typography-insights-ux-research-2026-09-16.md`.
Ownership and commit ledger:
`docs/agents/typography-insights-review-2026-09-16-ownership.md`.

## 1. Changed scope

| Area | Paths |
|---|---|
| Typography inspector | `sections/TypographySection.tsx(.css)`, `controls/SegmentedControl.tsx`, `Typography/AdvancedOpenTypeFeaturesSection.tsx` |
| Insights | `panels/IntelligencePanel.tsx`, `panels/AuditPanel.tsx`, `sections/CognitiveLoadIndicator.tsx` |
| Registry/composition | `sectionRegistry.ts`, `featureOwnership.ts`, `PropertiesPanel.tsx` |
| Styles | `inspector.css` (partial patch; effects-stream changes left unstaged) |
| Unit tests | `__tests__/TypographySection.test.tsx`, `__tests__/sectionRegistry.test.ts`, `panels/IntelligencePanel.test.tsx` |
| E2E | `tests/e2e/inspector/typography-insights-review.spec.ts` (new), `tests/e2e/canvas/typography-editing.spec.ts` (updated for shared Select + collapsed glyph subsection) |
| Docs/website | research ledger, ownership record, this report; `apps/website/src/pages/docs/getting-started/interface.astro`, `apps/website/src/pages/docs/tools/typography.astro`, `apps/website/src/pages/features/typography.astro` |

## 2. What was measured (rendered, real-world)

The E2E spec seeds the same real-world document as `design-tab-audit.spec.ts`
(frame, drawn rectangle, live text layer "Quarterly report", imported real
photograph `tests/e2e/fixtures/real-life-still-life.jpg`) and drives the real
Inspector:

1. Typography spine visible without expanding; rare controls absent until
   "Advanced typography" opens; alignment options expose named radios.
2. A real tracking edit (80‰) surfaces the "1 set" badge, persists through a
   selection change, and re-reads from the document.
3. OpenType rows use the shared combobox (zero native selects), required
   shaping tags are absent, and the first feature row is keyboard-focusable.
4. The font picker popover opens as a labelled listbox and closes on Escape.
5. Insights shows human tab labels and hides Spacing/Auto layout for a single
   text layer; with two or more layers selected, Spacing becomes reachable
   through the More menu's Analysis group (the Design workspace treats
   spacing as a secondary category) and its Analyze action is usable.
6. The Review tab never presents the removed dead Auto-fix action.

Screenshots (per run, under `test-results/<run>/…`):

- `typography-default.png` — the everyday spine.
- `typography-advanced.png` — the expanded Advanced typography subsection.
- `typography-badge.png` — the "1 set" count badge after a tracking edit.
- `typography-opentype.png` — OpenType rows with the shared dropdowns.
- `typography-font-picker.png` — the labelled font-family listbox.
- `insights-text-selection.png` — Review/Contrast tabs for a text layer.
- `insights-multi-selection.png` — Spacing appears for a multi-selection.

## 3. Results

_Pending the quiet-machine E2E run; unit, typecheck, and audit results below._

### Unit and static gates

| Gate | Result |
|---|---|
| `biome check` (staged files) | Pass |
| `tsc` filtered to changed files (`@varve/editor`) | Pass (pre-existing unrelated errors remain in concurrent work) |
| `pnpm typecheck:e2e` | Pass |
| `vitest` `TypographySection.test.tsx` | 11 pass |
| `vitest` `IntelligencePanel.test.tsx` | 8 pass |
| `vitest` `sectionRegistry.test.ts` | 69 pass (corner-radius multi-select expectation aligned with committed behavior) |
| `audit:emoji` / `audit:health` / secret scan / import boundaries (pre-commit) | Pass |

## 4. Deliberate limits and known cross-stream state

- The working tree carries concurrent streams (font browser, effects/object
  filters). Their browser runs were active during this review's first E2E
  attempt and crashed Chromium in the second half of the spec
  (`Protocol error: Runtime.callFunctionOn: Page crashed`); the first run's
  real assertion failure (point text wrongly offered vertical alignment) was
  fixed at the source before the re-run.
- `design-tab-audit.spec.ts` continues to own whole-panel metrics
  (truncation, overflow, target size); this review does not duplicate it.
- Severity chips are unit-covered only indirectly (the Review tab requires
  the audit worker); the E2E asserts the surrounding surface, not chip
  counts, because finding counts are document-dependent.
