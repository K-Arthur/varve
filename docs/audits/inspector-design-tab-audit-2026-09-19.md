# Inspector Design Tab — Audit and Gap Analysis (2026-09-19)

> Continues — and does not repeat — the 2026-09-15/16/17 inspections:
> `docs/research/inspector-design-tab-review-2026-09-15.md`,
> `docs/audits/inspector-design-tab-followup-2026-09-17.md`,
> `docs/audits/inspector-systems-redesign-2026-09-17.md`,
> `docs/audits/inspector-responsive-surface-audit-2026-09-17.md`.
> This audit starts from post-`dec89862b` (2026-09-19) master, uses fresh
> rendered measurements (`reports/inspector-redesign/baseline-matrix/`), and
> records only what is still true. Findings already repaired are listed in
> §9 as verified-closed so the next reader does not re-open them.

## 1. Method and environment

- **Code map**: full Design-tab composition map at
  `docs/plans/inspector-design-tab-redesign.md` (claimed areas) plus the
  component inventory in §2 of this document.
- **Rendered measurement**: `tests/e2e/inspector/inspector-design-matrix.spec.ts`
  (new, this pass) drives the real editor through 9 selection states ×
  3 rail widths × 3 themes × 3 text scales, expands every section, resets the
  panel scroll to the top (the 2026-09-17 harness did not, making its offsets
  scroll-dependent), and records computed typography, geometry, alignment
  offsets, icon sizes, interactive target sizes, and token probes as JSON.
  Artifacts: `reports/inspector-redesign/baseline-matrix/*.json` and
  `.../shots/*.png` (git-ignored evidence).
- **Standards corpus**: `docs/research/inspector-design-tab-research-2026-09-19.md`
  (`RES-###`), current as of 2026-09-19.
- **Environment**: Linux (CachyOS), Chromium 1.62 / Playwright, light theme
  unless stated, 1440×900 viewport, dev server on an isolated port, run under
  `scripts/quality/heavy-lease.mjs`.

## 2. Design-tab architecture (summary)

- Entry: `PropertiesPanel.tsx` → `composeSections` (`PropertiesPanel.tsx:656`)
  over membership lists in `sectionComposition.tsx` (`SINGLE_MEMBERS`
  `L74-132`, `SINGLE_TABLE_MEMBERS` `L135-147`, `MULTI_MEMBERS` `L150-175`,
  `TOOL_MEMBERS` `L182-187`), gated by `sectionRegistry.ts` availability
  predicates and ordered by `resolveSectionOrder` (`sectionRegistry.ts:1123`).
- 50 section definitions exist; 29 can appear for a single selection, up to
  22 simultaneously (image). Primary-band protection keeps Typography /
  Table / Component / active Mask ahead of user-saved order.
- Collapse/hide/order state: `EditorState.sectionVisibility`
  (`context/types.ts:525`), persisted in `varve-editor-settings`, with
  registry-driven defaults and subsection defaults (`sectionState.ts`).
- Shared controls: `DisclosureSection`, `FieldRow`/`InspectorFieldGroup`,
  `NumberField` (APG spinbutton + scrub + expression + mixed + binding),
  `SegmentedControl`, `RangeValueControl`, `InspectorColorPopover`,
  `BindingMenu`, `TokenBindIndicator`, `SectionManagerTrigger`.
- CSS: `inspector.css` 7,355 lines + 20 satellite stylesheets; 3,286 `var(--)`
  consumer lines, 877 literal-`px` lines, 42 literal colour lines, 0
  `!important`.

### Selection-state matrix (measured, light, 320px rail; all sections expanded)

| State | Sections | ScrollH / clientH | Ratio | Section order (ids) |
|---|---|---|---|---|
| no selection | 7 | 3848 / 631 | 6.1× | canvas-background, snapping, document-color, document-proof, document-grid, isometric-grid, insights |
| rectangle | 12 | 2237 / 665 | 3.4× | position-size, corner-radius, appearance, mask, fills, paint-library, stroke, smart-filters, adjustment-layer-access, effects, insights, cognitive-load |
| ellipse¹ | (invalid capture) | — | — | — |
| text | 17 disclosures (5 nested typography subsections) | 4599 / 665 | 6.9× | typography ×5, position-size, appearance, mask, fills, paint-library, stroke, smart-filters, adjustment-layer-access, effects, insights, adaptive-contrast, cognitive-load |
| frame | 14 (2 nested layout subsections) | 2754 / 665 | 4.1× | position-size, corner-radius, layout ×2, appearance, … |
| image | 22 (4 nested crop subsections) | 4345 / 665 | 6.5× | position-size, corner-radius, fills, image-placement, image-crop ×4, appearance, … |
| group | 8 | 1932 / 665 | 2.9× | position-size, appearance, mask, paint-library, smart-filters, adjustment-layer-access, insights, cognitive-load |
| multi-same | 11 | 1927 / 665 | 2.9× | position-size, corner-radius, appearance, fills, … |
| multi-mixed | 11 | 1846 / 665 | 2.8× | identical to multi-same |

¹ The first capture pressed `e`, which is the **Eraser** (the Ellipse tool is
`o`, `ShortcutManager.ts:258`); the harness is corrected and re-run. This is
recorded because it also produced a real observation: switching to a tool with
its own options surface replaces the selection panel with `ACTIVE TOOL` +
Insights (`AUD-021`, not a defect — matches the documented tool-scope model).

Ratio values are the **expanded worst case**, not the default state. Default
state (registry defaults) collapses `corner-radius`, `mask`, `paint-library`,
`smart-filters`, `adjustment-layer-access`, `effects`, `selection-colors`,
`image-perspective`, `ai-tools-hint`, `palette`, `layer-states`, `insights`,
`document-proof`, `document-grid`, `isometric-grid` — the visible default
budget is materially smaller. The 2026-09-17 audit recorded the same headings
and is still accurate in structure; what changed is only the measured heights
(a few percent, from the Sept-18 spacing fixes).

### Workspace matrix

Workspace modes do not add or remove Design-tab sections wholesale. They gate
content *inside* context (`PropertiesPanel.tsx:149-176`, registry predicates):

| Mode | Inspector effect |
|---|---|
| Design | Baseline composition. |
| Print | `page-print` section becomes reachable via page scope; print-only document sections remain in the no-selection stack. |
| Draw | `brush-settings` lives in the floating Tool Options popover, not Design; paint tools switch the panel to tool scope while active. |
| Photo | `image-*`, `palette`, `background-removal`, `colorize`, `ai-denoise` etc. are canonical to the Adjustments tab; in Design, the image treatment sections are reordered/led (`ai-tools-hint`, `image-resolution`, `image-perspective`). |
| Motion | Timeline surfaces are outside the panel; `animation` section is available only for animated media nodes in every mode. |
| Logo | No Design-tab membership change; Logo panel is a separate surface. |
| Email | Email panel is a separate tab; Design composition unchanged. |
| Codegen | No membership change. |

**Finding AUD-022:** the workspace→Inspector contract is implicit (predicates
reference `workspaceMode` ad hoc, e.g. `sectionRegistry.ts:622, 656-780`).
There is no test enumerating the contract per mode. A table-driven test would
prevent silent drift; recorded as a recommended follow-up (no behavior change).

## 3. Spatial and typographic consistency

Measured census (all expanded states, light theme, 320px rail):

| Role | Measurement | Verdict |
|---|---|---|
| Property labels | 12px / 600 / lh 16.2px / tracking 0.24px / muted `oklch(0.43 0.032 262)` — 381 occurrences; 45 occurrences at lh 15px | Coherent. The 15px set is the `--wrap` variant (`inspector.css:1375`, lh 1.25) — intentional, **AUD-023 closed as explained**. |
| Numeric/value text | 13px / 400 / lh 19.5px — 210 occurrences; 21 in muted role | Coherent. |
| Section headers | 13px / 700 / lh 19.5px / tracking 0.65px (= `--tracking-wide`) — 307 occurrences | Coherent. Contrasts acceptably against 12px/600 labels. |
| Hint text | 12.48px / 400 (`--font-size-xs`) | Coherent. |

**AUD-001 — label/field alignment drift at the default rail.** A rectangle
selection renders **3 distinct label left edges** (1127.9 / 1279 / 1329.2) and
6 distinct control right edges; an image selection renders **7 label left
edges** (1127.9, 1134.8, 1139.9, 1246.4, 1272.4, 1279, 1329.2) and 11 control
right edges. Some of this is legitimate nesting (paint rows, subsection
bodies), but 1134.8/1139.9/1127.9 are three slightly different "first column"
starts in the same panel — a real grid-contract gap. Requirement `REQ-003`;
implementation `IMPL-006` (measurement re-run after normalizing the outliers).

**AUD-002 — control height inventory is broad but not arbitrary.** Rectangle:
24/32px. Text: 16/24/29.1/32/42.5/64/64.9. Image: 22.1/24/32/36.6/45/66.5/67.
The 32px value is `--component-compact-height`; 24px is
`--target-min-compact`; the larger values are stacked textareas, previews and
slider+field composites. No 28/30/34px strays were found. **Verdict:** the
height system holds; the gap is that composite rows do not document which
token their height derives from (`REQ-004`).

**AUD-003 — spacing scale is coherent.** Token probe at the default rail:
`--space-1` 2.96px, `--space-2` 5.92px, `--space-3` 9.68px, `--font-size-xs`
12.48px, `--radius-sm` 6px. Row heights measured 32px (single row) and 51.1px
(mixed/stacked); section bodies compose from the same steps. No off-scale
literal `margin`/`padding` was found in the panel shell. **Verdict:** the
2026-09-17 spacing pass held.

**AUD-004 — tracking literals bypass the token tier.** `inspector.css` writes
`letter-spacing: 0.02em` at 6 sites, `0.025em` at 1, `0.03em` at 1, plus three
satellite stylesheets at `0.04em` (`effects.css:91`,
`smartFilters.css:253`, `EmailCodeEditor.css:26`) — 11 sites, four values, one
visual idea ("slightly open uppercase micro-type"). `--tracking-wide` is
`0.05em` and is used by section headers; there is **no token for
micro-tracking**. Requirement `REQ-006`; implementation `IMPL-002` (add
`--tracking-micro: 0.02em`, normalize all 11 sites, keep `--tracking-wide` for
headers).

**AUD-005 — raw transition and geometry literals remain.**
`transition: background 0.15s` (`inspector.css:4695`) bypasses
`--duration-quick`/`--ease-standard` and the reduced-motion override;
`width: 280px; max-height: 400px` (`inspector.css:702-703`) and a second
`width: 280px` (`:6867`) define the section-manager popover; the
section-manager badge is `font-size: 0.6rem` (`:696`), below the smallest
type token's floor (`--font-size-2xs` clamps 0.6rem→0.68rem, so at desktop
widths the literal renders *smaller than any token permits*). Requirement
`REQ-007`/`REQ-008`; implementation `IMPL-003`.

**AUD-006 — undefined custom properties silently fall back.** The
`audit:inspector-css` gate (new, this pass) found **66 undefined `var()`
references** across the Inspector stylesheets, not the three previously
recorded. Families: `--color-text-default` ×11 (→ `--color-text-primary`),
`--color-surface-selected` ×15 (→ `--color-interactive-selected-surface`),
`--surface-muted` ×4 / `--text-primary` ×7 / `--text-secondary` ×10 /
`--text-tertiary` ×1 / `--text-on-accent` ×1 (legacy Mockups names),
`--color-interactive-focus` ×4 and `--color-interactive-subtle` ×3
(effects), `--font-family-mono` ×4 (→ `--font-mono`), `--color-text-warning`
×3 (→ `--color-feedback-warning`), `--color-accent-strong` ×2 (dead fallback),
`--font-weight-normal` ×1, `--color-border-default` ×1,
`--duration-standard` ×1, plus the three originally recorded
(`--color-danger-subtle`, `--color-warning-default`, `--color-danger-default`).
Every reference rendered a fallback or nothing, bypassing theming. All 66 are
migrated to canonical tokens (IMPL-001); the gate prevents recurrence
(REQ-014).

## 4. Control and primitive audit

- No duplicated *interaction model* was found in the shared controls: one
  numeric field, one segmented control, one select, one slider+field, one
  colour popover, one disclosure. **The duplication that remains is
  bypassing**: a local `NumberField` in `MockupsSection.tsx:901`, a bespoke
  `.insp-stepper` in `BackgroundRemovalSection.tsx:1388-1413`, and ~11 raw
  `<input type="number">` in `DocumentPanel.tsx` (`AUD-007`).
- `FontDetectSection.tsx:575` renders a **native `<select>`**, violating the
  repository's hard rule; it also bypasses the shared Select's keyboard and
  popover behaviour (`AUD-008`).
- `.insp-select` CSS is applied to a text input in `LayoutSection.tsx:170/181`,
  and `.insp-interaction-row__field select` targets a control the component
  no longer renders (`AUD-009`, dead CSS).
- `.insp-swatch--sm` used at
  `AdaptiveContrastSection.tsx:333` and `.insp-badge--info` at
  `OcrSection.tsx:303` had **no CSS definitions**; the latter rendered a
  sentence of text inside the 3px dot of the base `.insp-badge` rule — a real
  overflow defect in the OCR section. Both modifiers are now defined
  (IMPL-005). Duplicate blocks exist for
  `.insp-effect-row` (`inspector.css:6491` + `sections/effects/effects.css:6`),
  `.gradient-editor` (`:5022` + `:5148`), `.insp-fill-add__controls` (`:1118` +
  `:2881`), `.debt-badge` (`:5079` + `:5234`), and the conflicting
  `.insp-orientation-btn` pair (`:2003` + `:6835`); the orientation pair was
  removed after confirming the later rule fully supersedes it (IMPL-005).
  The other same-selector blocks are multi-aspect rules, not duplicates.
- Dead components: `controls/ReferenceImagePicker.tsx` and
  `controls/SelectiveColorGrid.tsx` have no production importer
  (`AUD-011`).
- Mixed state is communicated with the literal word "Mixed" plus accessible
  names (verified in the paint-row suite); no colour-only mixed state was
  found.

**AUD-027 (new, user-reported) — colour triggers could announce a value while
painting nothing.** `InspectorColorPopover` applied `swatchStyle` verbatim;
callers that omitted it rendered a face with no background. The new Typography
Colour row shipped in this state (pill printed `#10151F`, face empty), and four
pre-existing consumers had the same omission: `RichTextSpanEditor`,
`AdaptiveContrastSection` (×2), `TableCellsSection`, `TableAppearanceSection`.
Fix (IMPL-013, REQ-016): the component derives a face from `value` when none is
given; a caller may still pass an explicit face for richer paints, and a
"Mixed" stack passes a neutral face so the preview can never contradict the
label. Regression tests: two component unit cases (opaque default face, alpha
in a value pill) and an E2E assertion that each pill's face background equals
the hex it prints.

## 5. Clutter inventory

The 2026-09-16/17 clutter decisions are still in force (suppressed Selection
Colors on single-colour objects, progressive stroke advanced, contextual image
sections, collapsed-by-default secondary sections). Fresh measurements confirm
the remaining vertical budget concentrates in five places:

| Item | Where | Measured cost | Decision for this pass |
|---|---|---|---|
| Text selection, 5 nested Typography disclosures | `typography` subsections | 4,599px expanded total; typography first | Keep. Subsections are registry-collapsed by default; expand-all is a review mode, not the working state. Recorded as `AUD-012` with the default-state budget as the operative number. |
| Image selection, 4 nested Crop subsections | `image-crop` subsections | 4,345px expanded | Keep; same rationale. |
| `insights` audit block on every selection | `PropertiesPanel.tsx:425` | ~340px collapsed-by-default | **Manageability defect, not clutter**: `canHide: true` in the registry, but `SectionManagerTrigger` lists only `surface === 'properties'` sections, so `insights` (`surface: 'audit'`), `image-crop` (`tool-options`), `ai-tools-hint` (`adjustments`) and `mockups` (`prototype`) cannot be hidden or restored from the manager even though the composition honours their hidden state. `AUD-013`. |
| Object Filters triple add-entry | `SmartFiltersSection` | prior audit | Recorded, not repaired here — needs its own consolidation slice (`AUD-014`, see §8). |
| Insights/Audit micro-copy | `IntelligencePanel` | "70%" chip, "+ n more (max display: N)", severity ids | Bounded copy/a11y repair in this pass (`AUD-015`). |
| Text colour reachable only in Fill | `TypographySection` | user report 2026-09-19: styling type required scrolling past Position/Appearance/Mask to Fill | **AUD-026** — Typography gains a Colour row bound to the same fill via `updateSelectedFillAt`; Fill remains the stack editor; non-solid/stacked text fills show their type and route to Fill. `IMPL-011`, `REQ-015`. |

## 6. Accessibility audit

Measured target inventory (light theme, all states, `measurePanel`):

- Genuine undersized targets after excluding clipped native inputs:
  `Enable adaptive contrast` 16×16; paint swatch pills 20×20 (spacing
  exception candidate); `Alternate preview size` 103.5×16 and 509.4×16 (text
  buttons 16px tall); `Weight (wght)` 18.6×27.4 (segmented/combobox item).
- **AUD-016 — the 1×1 `Constrain proportions` flags are a false positive**:
  the input is deliberately clipped (`inspector.css:2052-2062`,
  `clip-path: inset(50%)`), the 24px label is the pointer target, and the
  focus ring is painted on the label (`:2064`). The audit harness must exclude
  clipped inputs (fixed in the after-run).
- The remaining undersized list is small and is the concrete SC 2.5.8 work
  item (`AUD-017`): each must either reach 24×24 or satisfy the spacing
  exception (24px circle test, `RES-025`). The "Alternate preview size"
  buttons are sentence-like controls in a row; the spacing exception is
  plausible but must be *measured*, not assumed. Implementation: the
  feature-browser range input's hit area is raised to `--target-min-compact`
  (IMPL-009), and the after-run records `spacingOk` per undersized target so
  the exception is evidenced rather than asserted.
- **AUD-025 (new, severe) — the variable-font axis slider collapsed to
  ~19px.** `.insp-axis-control` had no layout rule; as a flex child it took
  content width while `.range-value-control`'s `minmax(0, 1fr)` track
  collapsed, leaving the "Weight (wght)" range at 18.6×27.4px — effectively
  un-draggable. Fixed with a flex rule (`inspector.css`, IMPL-009); the
  2026-09-17 responsive audit did not cover this control because the frame
  fixture has no variable axes.
- Focus visibility uses `--color-interactive-focus-ring` with 2px outline at
  measured contrast (audit:tokens: 213/213 pairs pass in 3 themes). Sticky
  section headers own the scroller inset and do not intersect focused labels
  (2026-09-17 contract test still passing).
- `aria-disabled` (not `disabled`) keeps unavailable align references in the
  accessibility tree with a reason; collapsed summaries are
  `aria-describedby`, never part of the trigger name.
- Screen-reader and real-device lanes remain **not directly validated** in
  this environment; recorded as a limitation, not a claim.

## 7. Performance

No Inspector-specific render instrumentation exists in the repo. A
measured probe is added in this pass (frame-time sampling during canvas drag
with a large document and during selection switching); baseline numbers and
the before/after comparison live in the final report. No speculative
optimization is performed without those numbers. (`PERF-001` pending.)

## 8. Missing frontend / dead wiring

- `prototype-flow` is gated on `ctx.prototypeMode`, which has no UI toggle →
  unreachable (`sectionRegistry.ts:896`). Recorded, not repaired.
- `ConstraintSection` export is test-only; live path is `ConstraintControls`
  (`PositionSizeSection.tsx:35`). Dead export (`AUD-018`).
- `ReferenceImagePicker` / `SelectiveColorGrid` (`AUD-011`).
- `AUD-014` Object Filters triple entry point (quick-pick cards + "Choose a
  filter…" combobox + "The full filter menu is below" prose) —
  `SmartFiltersSection`; consolidation deferred to its own slice because it
  changes interaction structure, not styling.
- Raw numeric controls in `DocumentPanel` (`AUD-007`) — deferred migration;
  DocumentPanel is the document-scope surface and the migration is
  mechanical but wide.

## 9. Verified closed (do not re-open)

- Section manager title/order overrides ("Child layout", "Position & size")
  no longer exist in the tree (grep of `packages/editor/src`).
- "Adjustment Layer" duplicate registry entries: one retired section id
  (`adjustment`) remains in the migration list, not in composition.
- Insights escape sequences (`Scanning\u2026`), add-affordance casing, Gap
  label-in-name, node-header glued names, Variables dialog reachability and
  heading hierarchy: all closed by `7291571f6` + prior passes; verified by
  the still-green suites (`design-tab-audit.spec.ts` 21/21 in the 2026-09-19
  workspace, `variables-dialog.spec.ts`).
- Raw inline styles in Isometric/Component/VariableModifier sections: no
  matches remain in the current tree.

## 10. Finding → requirement → implementation map

| Finding | Requirement | Implementation |
|---|---|---|
| AUD-006 undefined tokens (66) | REQ-009 | IMPL-001 |
| AUD-004 tracking literals | REQ-006 | IMPL-002 |
| AUD-005 raw transition/geometry/badge | REQ-007, REQ-008 | IMPL-003 |
| AUD-008 native select | REQ-010 | IMPL-004 |
| AUD-010 duplicate/dead CSS classes, AUD-011 dead picker, AUD-018 dead export | REQ-011 | IMPL-005 |
| AUD-003/023 alignment outliers | REQ-003 | IMPL-006 (attribution pending; see §11) |
| AUD-013 unmanageable sections | REQ-012 | IMPL-007 |
| AUD-015 audit micro-copy | REQ-013 | IMPL-008 |
| AUD-019 orphaned contrast chip | REQ-013 | IMPL-008 |
| AUD-017 undersized targets | REQ-005 | IMPL-009 |
| AUD-025 axis-slider collapse | REQ-005 | IMPL-009 |
| AUD-026 text colour entry point | REQ-015 | IMPL-011 |
| AUD-027 missing swatch face default (user-reported) | REQ-016 | IMPL-013 |
| (drift prevention) | REQ-014 | IMPL-010 enforcement script |
| AUD-001/002/012 evidence | REQ-001, REQ-002, REQ-004 | spec + re-measure |

## 11. Remaining work (recorded, not claimed)

- Object Filters IA consolidation (`AUD-014`): three competing add-filter
  entry points. Deferred — it changes interaction structure and needs its own
  slice.
- DocumentPanel numeric-control migration (`AUD-007`): ~11 raw number inputs;
  mechanical but wide. Deferred.
- Alignment-outlier attribution (`AUD-003`): the measured 1127.9/1134.8/1139.9
  label-left spread needs per-row attribution before any layout change; the
  spec's grid contract is the target. Not repaired blindly.
- Typography contrast chip (`AUD-019`): the orphaned "AAA" chip under the
  Style row now carries a visible "Contrast" caption (and keeps its
  `aria-label` + tooltip), so it reads as contrast metadata rather than a
  stray dot. The Weight select continues to show the numeric axis value
  (`400`): for a variable font that is the honest value, with the Style
  segmented control providing named presets — recorded as an intentional
  model, not drift.
- `prototype-flow` reachability (`AUD-020`): no UI toggle exists.
- Workspace→Inspector contract test (`AUD-022`): recommended.
- Storybook coverage decision (spec §10): documented deviation.
- Performance probe (`PERF-001`): `tests/e2e/inspector/inspector-perf-probe.spec.ts`
  records absolute selection-settle and drag-cadence numbers; results in the
  report addendum. No optimization claimed.
- Slider target review (16px native range inputs) carried from
  `inspector-design-tab-review-2026-09-15.md` §5: the feature-browser range
  and the variable-axis slider are fixed; remaining raw ranges in satellite
  sections are inventoried by the new spacing-exception data.
- Raw colour literals in four satellite stylesheets (39 occurrences): the new
  gate reports them as warnings; each needs a semantic-token mapping that
  preserves the intended effect-preview art (`photoSource.css`,
  `imageTuning.css`, `effects.css`, `smartFilters.css`).
