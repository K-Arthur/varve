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

### Browser E2E (Chromium, real-world document)

Command:

```
VARVE_E2E_PORT=1469 VARVE_E2E_WORKERS=1 \
  node scripts/quality/heavy-lease.mjs playwright-typography-review-3 -- \
  npx playwright test tests/e2e/inspector/typography-insights-review.spec.ts \
  --project=chromium --reporter=list
```

Result: **7 passed (5.0m)**.

| Test | Result |
|---|---|
| common spine visible, rare controls collapsed, named alignment radios | Pass |
| tracking edit surfaces the "1 set" badge and persists across selection | Pass |
| OpenType uses shared comboboxes; required tags hidden; no native select | Pass |
| font picker opens as a labelled listbox and closes on Escape | Pass |
| Insights human labels; Spacing/Auto layout absent for a single text layer | Pass |
| Spacing reachable in Design via More → Analysis for a multi-layer selection | Pass |
| Review tab has no dead Auto-fix action | Pass |

A later refinement pass (OpenType row density, humanized review category/rule
names, active More-tab underline) re-ran the same spec together with the
whole-panel `design-tab-audit.spec.ts`:

```
VARVE_E2E_PORT=1471 VARVE_E2E_WORKERS=1 \
  node scripts/quality/heavy-lease.mjs playwright-typography-final -- \
  npx playwright test tests/e2e/inspector/typography-insights-review.spec.ts \
  tests/e2e/inspector/design-tab-audit.spec.ts --project=chromium --reporter=list
```

Result: **21 passed (8.3m)** — 14 Design-tab audit tests plus all 7
typography/insights tests. The audit's whole-panel metrics for every node
kind reported `smallTargets: []`, `fieldOverflows: []`,
`truncatedLabels: []`, and a scrollable rail, so the redesign introduced no
truncation, overflow, or sub-24px targets.

### Unit and static gates

| Gate | Result |
|---|---|
| `biome check` (staged files) | Pass |
| `tsc` filtered to changed files (`@varve/editor`) | Pass (pre-existing unrelated errors remain in concurrent work) |
| `pnpm typecheck:e2e` | Pass |
| `vitest` `TypographySection.test.tsx` | 11 pass |
| `vitest` `IntelligencePanel.test.tsx` | 8 pass |
| `vitest` `sectionRegistry.test.ts` | 69 pass (corner-radius multi-select expectation aligned with committed behavior) |
| `audit:docs` (968 docs, 527 links) | Pass |
| `audit:tokens` (201 pairs × 3 themes) | Pass |
| `audit:emoji` / `audit:health` / secret scan / import boundaries (pre-commit) | Pass |

### Validation plan

`pnpm verify:plan` reports 163 changed files because the working tree carries
several concurrent streams (font browser, effects/object filters, generative
editing, toolchain files); the planner therefore escalates the *aggregate*
tree to a full gate. For this review's own paths the affected closure is
`@varve/editor` unit + typecheck, `typecheck:e2e`, and the inspector E2E
spec — all of which were run. The full gate is not invoked here because the
escalation belongs to the other streams' workspace/toolchain changes, not to
this review (`VARVE_FULL_GATE_REASON` would be required and no single
justification covers the unrelated in-flight work).

## 4. Deliberate limits and known cross-stream state

- The working tree carries concurrent streams (font browser, effects/object
  filters, generative editing). During the first E2E attempts their browser
  runs plus this run exceeded system memory and crashed Chromium
  (`Protocol error: Runtime.callFunctionOn: Page crashed`); the run was
  serialized through `scripts/quality/heavy-lease.mjs`, and the final
  combined run above completed cleanly with every test green.
- One real assertion failure found by the first run — point text wrongly
  offered vertical alignment and reported "1 set" for its natural auto-width
  sizing — was fixed at the source before the final run.
- Layout flake found and fixed: the layers panel animates its reveal, so a
  single measured click could land on the adjacent row; the spec now retries
  the click plus the `aria-selected` assertion.
- `design-tab-audit.spec.ts` continues to own whole-panel metrics
  (truncation, overflow, target size); this review did not duplicate it and
  its result is recorded as cross-evidence, not as a replacement.
- Severity chips are unit-covered only indirectly (the Review tab requires
  the audit worker); the E2E asserts the surrounding surface, not chip
  counts, because finding counts are document-dependent.
