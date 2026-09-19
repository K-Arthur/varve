# Inspector Design Tab — Redesign/Repair Report (2026-09-19)

> Deliverable report for the 2026-09-19 Inspector Design-tab pass.
> Traceability ids resolve in:
> - `docs/research/inspector-design-tab-research.md` (`RES-###`)
> - `docs/audits/inspector-design-tab-audit-2026-09-19.md` (`AUD-###`)
> - `docs/design-system/inspector-spec.md` (`REQ-###`, `IMPL-###`)
> Baseline evidence: `reports/inspector-redesign/baseline-matrix/` (git-ignored).
> After evidence: `reports/inspector-redesign/after-matrix/`.

## 1. Executive summary

The Design tab had already been redesigned twice (2026-09-15/16/17). This pass
did not re-skin it. It ran a fresh measured baseline, audited the post-Sept-18
state against current research and WCAG 2.2, and found that the remaining
defects were **systemic token and wiring failures rather than layout ones**:

- 66 `var()` references pointed at custom properties that no theme defines —
  each silently rendering a fallback or nothing (AUD-006).
- The variable-font axis slider was collapsing to ~19px wide because
  `.insp-axis-control` had no layout rule — effectively unusable (AUD-025).
- The `SectionManagerTrigger` listed only `surface === 'properties'` sections,
  so four sections that render in the Design tab (`insights`, `image-crop`,
  `ai-tools-hint`, `mockups`) could not be hidden or restored even though the
  registry marks them hideable and the composition honours their hidden state
  (AUD-013).
- The OCR section's "Rotated N° (conf: N%)" badge rendered inside the 3px-dot
  base `.insp-badge` rule — text overflowing a dot (AUD-010).
- A native `<select>` remained in an Inspector section (hard-rule violation,
  AUD-008).
- Raw tracking values were expressed four different ways (0.02/0.025/0.03/0.04
  em) with no micro-tracking token (AUD-004).

All of the above are repaired, plus bounded copy/verb/a11y fixes in the
Insights block, the previously orphaned typography contrast chip (now visibly
captioned), and — the durable part — a new machine gate
(`pnpm audit:inspector-css`) wired into the impact planner so the class cannot
return silently.

What this pass deliberately did **not** do: restructure the section order,
change any primitive's semantics, remove any capability, or pursue speculative
performance work without measurements.

## 2. Findings-to-fixes traceability

| Finding | Evidence | Requirement | Implementation | Validation |
|---|---|---|---|---|
| AUD-006 undefined tokens (66) | gate output; diff | REQ-009 | IMPL-001 | audit clean; unit 447 pass; E2E (see §7) |
| AUD-004 tracking drift | grep + measured census | REQ-006 | IMPL-002 | tokens:generate clean; 44 token tests pass |
| AUD-005 raw durations/geometry/badge | audit rules | REQ-007/008 | IMPL-003 | audit clean |
| AUD-008 native select | code + unit failure | REQ-010 | IMPL-004 | FontDetectSection 9/9 |
| AUD-010/011/018 dead + undefined CSS | audit + grep | REQ-011 | IMPL-005 | audit clean; typecheck baseline |
| AUD-013 unmanageable sections | rendered manager + registry | REQ-012 | IMPL-007 | new unit test 3/3 |
| AUD-015 Insights copy | screenshot + code | REQ-013 | IMPL-008 | IntelligencePanel 8/8 |
| AUD-019 orphaned contrast chip | design-tab screenshot | REQ-013 | IMPL-008 | design-tab-audit + typography-layout rerun |
| AUD-017/AUD-025 axis slider + range targets | measured 18.6×27.4 | REQ-005 | IMPL-009 | after-matrix metrics |
| (drift prevention) | — | REQ-014 | IMPL-010 | policy tests 46/46 |

## 3. Research-informed decisions

**Adopted**

- Relative-delta pointer capture for scrubbing (RES-006/RES-008): already
  implemented in `NumberField`; the spec now pins it.
- Persistent, labelled add-affordances (RES-003): already the norm; no
  hover-only actions were introduced.
- Stable section order with a protected primary band (RES-004).
- Section separation via card containment rather than inflated whitespace,
  with intra-body spacing from one scale (RES-034/RES-038).
- 24×24 target floor with a *measured* spacing exception (RES-025).

**Rejected**

- A user-facing "property labels on/off" preference (RES-001): Figma shipped
  it as a migration aid; Varve's labels are the scan rhythm, and an option
  would multiply test/theme surface for no demonstrated failure.
- A global density mode (RES-033/036): a professional editor has one working
  density; component-tier compact geometry plus coarse-pointer target
  enlargement already covers the accessibility need.
- Icon-only defaults (RES-002 complaints): rejected; icons remain labelled or
  accessible-named.
- Numeric expression entry was already implemented (RES-015) — verified in
  `NumberField` rather than re-specified.

## 4. Before/after evidence

- Baseline screenshots + metrics:
  `reports/inspector-redesign/baseline-matrix/` (9 selection states × 3 rails;
  themes; text scales).
- After screenshots + metrics:
  `reports/inspector-redesign/after-matrix/` (same harness; `VARVE_MATRIX_PHASE=after`).
- Measured deltas (light, expanded worst case):
  - frame / group / image / multi / no-selection / rectangle: **scroll height
    and section count identical** (±0px) — no layout regression, no
    redistribution.
  - text: −24px scroll height (4575 vs 4599 at the 320 rail) from the
    variable-axis row consolidating the Reset button onto the slider line.
  - Undersized targets: the clipped-input false positives are gone by
    construction; `Alternate preview size` (16px tall), `Weight (wght)`
    (18.6px wide) and `Enable adaptive contrast` disappear from the flagged
    list; paint swatch pills remain 20×20 with **measured `spacingOk: true`**
    (SC 2.5.8 spacing exception evidenced, not assumed).
  - Rectangle/frame control-height inventory unchanged ([24, 32]); text loses
    one 64px composite (axis row) and keeps everything else.
- Representative comparisons: `shots/light-rectangle-320.png`,
  `shots/light-text-320.png`, `shots/dark-image-320.png`,
  `shots/textscale-200-text-320.png` in both directories.
- The baseline harness itself was corrected during this pass: the 2026-09-17
  version recorded scroll-dependent section offsets; the new harness resets
  the scroller before measuring, fixes the ellipse fixture (was pressing `e` =
  Eraser), and records effective-target and spacing-exception data.

## 5. Design-system changes

**New tokens**

- `--tracking-micro: 0.02em` (typography primitive, generator-owned).
- `--insp-popover-inline: 17.5rem`, `--insp-popover-max-block: 25rem`
  (Inspector-local component aliases).

**Changed usage (no value changes intended)**

- 66 undefined token references → canonical tokens (list in AUD-006).
- 10 tracking literals → `--tracking-micro`.
- 6 raw transition durations → `--duration-quick`/`--duration-fast`.
- `.insp-section-manager__badge` 0.6rem → `--font-size-2xs`.

**New primitives / rules**

- `.insp-axis-control` layout contract (new rule).
- `.insp-swatch--sm`, `.insp-badge--info` modifiers (previously undefined).
- `getDesignTabSectionIds()` in `sectionComposition.tsx` (manageability set).
- `scripts/quality/audit-inspector-css.mjs` + `audit:inspector-css` lane +
  impact rule.

**Deleted**

- `controls/ReferenceImagePicker.tsx` (no importers).
- Stale duplicate `.insp-orientation-btn` block (superseded by the later rule).
- Dead `.font-detect-target-select` CSS and the native select it styled.

## 6. Clutter reduction accounting

No function was hidden or removed in this pass. The only reachability change is
an **increase**: `insights`, `image-crop`, `ai-tools-hint`, `mockups` are now
listed and toggleable in the section manager (AUD-013), and Insights honours
its hidden state because `PropertiesPanel` now checks `isSectionVisible`
(previously the hidden state was unreachable and unapplied for that section).
Object Filters consolidation (AUD-014) and DocumentPanel numeric migration
(AUD-007) remain recorded, unrouted, and unchanged.

## 7. Accessibility results

- Effective-target audit now excludes clipped inputs whose `<label>` is the
  target (false positive class found in the baseline) and computes the
  SC 2.5.8 spacing exception per remaining undersized target. After-state:
  no failing targets; paint swatch pills 20×20 pass via measured spacing
  (`spacingOk: true`).
- Fixed: axis slider unusable width (18.6px → flex-filled), feature-browser
  range hit area raised to 24px, OCR badge overflow, confidence chip gains an
  accessible name, severity chips no longer use raw ids, contrast chip gains a
  visible caption plus wrap safety at narrow rails.
- `pnpm audit:tokens` 213/213 pairs across 3 themes; no contrast regression
  introduced by the token migrations (all replacements are existing
  AA-audited pairs).
- Rendered revalidation: design-tab-audit 21/21 (includes the 24px target
  assertion for align references), typography-layout 1/1 (three themes × two
  rails), responsive-surface 5/5 (240–640 rails, 200% text scale, sticky
  header inset, no overflow).
- Remaining limitation: screen-reader and real-device validation were not
  performed in this environment (honest gap, carried from prior passes).

## 8. Performance results

`tests/e2e/inspector/inspector-perf-probe.spec.ts` records absolute numbers
under concurrent-agent machine load (no optimization was performed, so these
are a baseline, not a claim):

| Probe | Median | p95 | Notes |
|---|---|---|---|
| Selection switch (row click → two rAFs) | 88.4ms | 191.4ms | 10 samples; first (warm) sample 23ms, steady-state ~80–90ms for full panel re-render between two selections |
| Canvas drag frame cadence (2.4s drag, 289 frames) | 16.7ms | 74.2ms | 43/289 frames over 40ms (15%) under shared-machine load; no frame-rate claim |

The only render-path change in this pass is a CSS layout rule for the axis
slider (removes a wrapped Reset row); it is not a performance optimization and
is not presented as one.

## 9. Real-world scenario validation

The matrix runs use realistic content (imported still-life JPEG, live text,
frames, groups, multi-selection). The 1,000+ node document, deep nesting,
RTL/long-name scenarios remain covered by the pre-existing
`design-tab-audit.spec.ts` corpus and the export/masking corpora; this pass did
not add new real-world fixtures.

## 9b. Non-Inspector regression check

The only shared-system change is the additive `--tracking-micro` token in
`tokens.css` (one new line; no existing value touched). No `@varve/ui`
component semantics changed. Every class modified (`.insp-*`,
`.contrast-indicator`, `.range-value-control` consumers) is Inspector-scoped;
the OCR badge and swatch modifiers are used only inside Inspector sections. The
shared `Select` was newly *consumed* by FontDetectSection but not modified, so
other Select consumers (dialogs, export, settings) are unaffected; this was
confirmed by the full token test suite and the unaffected `@varve/ui` unit
lane. No representative non-Inspector visual re-capture was therefore required;
had a shared component changed, the plan named dialog/export/settings surfaces
for targeted re-inspection.

## 10. Cross-platform status
- Linux/Chromium: validated (all evidence).
- WebKitGTK (Linux desktop shell): not directly validated this pass.
- macOS/WKWebView, Windows/WebView2: not directly validated.
- The CSS changes are logical-property/token-level and carry no
  platform-specific APIs; no cross-platform claim beyond that.

## 11. Concurrent-agent coordination

- No Inspector files were dirty at claim time; other agents' dirty files
  (font system, background removal, scene/shared types) were left untouched.
- The two unit suites that fail (`VariableAxes`, `bgRemovalFeatures`) import
  only those in-flight modules; neither imports anything this pass changed.
  They are recorded as pre-existing workspace failures.
- The full-suite escalation the planner prints originates in shared
  workspace/toolchain files (including this pass's own `package.json` and
  `scripts/quality/**` additions), not in inspector product code.

## 12. Remaining gaps

See `docs/audits/inspector-design-tab-audit-2026-09-19.md` §11: Object Filters
IA, DocumentPanel numeric controls, `prototype-flow` reachability, alignment
offset attribution (AUD-001), workspace-contract test, Storybook position,
performance probe numbers, screen-reader/real-device lanes.
