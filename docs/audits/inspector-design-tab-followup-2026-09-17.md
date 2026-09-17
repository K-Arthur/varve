# Inspector Design tab — follow-up review and repairs (2026-09-17)

Task: review the Inspector's **Design tab** (the `properties` tab) and its
contained **Variables and tokens** dialog — every section and component a
selection renders there, plus text, spacing, and token discipline — repair the
bounded defect set, and record what remains. This continues, and does not
repeat, the 2026-09-15 review:
`docs/research/inspector-design-tab-review-2026-09-15.md` (type scale, label
wrapping, image section order, proportion-lock target, Pathfinder primitives
were already repaired there; its rendered audit spec
`tests/e2e/inspector/design-tab-audit.spec.ts` guards those).

## 1. Scope and method

Surfaces inspected in the running app (Chromium, 1600x1000, dark theme, dev
server on an isolated port): empty-selection state (document settings stack),
single selection of a rectangle, live text, and a frame, the section manager
("Customize sections") panel, and the Variables and tokens dialog. Code review
covered every section component in the Design tab composition
(`PropertiesPanel.tsx` `SingleSelectionPanel`/`MultiSelectionPanel`), the
shared row primitives (`FieldRow`, `DisclosureSection`), `inspector.css`
(7224 lines), the dialog host (`VariablesPanelDialog`) with both hosted panels
(`VariablePanel`, `TokenSyncPanel`), and `sectionRegistry.ts` category labels.

Evidence sources: rendered DOM accessibility-tree reads, computed-style
checks, screenshots, two parallel source audits, and the prior session's
ledger consulted to avoid re-reporting repaired findings.

## 2. Issue register

Severity: **S1** loses work or blocks a core task; **S2** breaks an
accessibility contract or hides functionality; **S3** polish/consistency.

| # | Sev | Surface | Finding | Resolution |
|---|---|---|---|---|
| 1 | S2 | Variables and tokens dialog | **Unreachable.** The `openVariablesPanel` action was registered ("Open Variables and Tokens", `registerAll.ts:156`) with a handler, but no menu item, shortcut, button, or palette invoked it — and the editor has no command palette. The dialog's own comment claimed it opened "from the command palette". The surface named in this review's scope could not be opened by a user at all. | Menu item added in **both** menu sources per the repo's two-menu rule: `menu/defs.ts` View → Panels group (`menu.view.variablesPanel`, no shortcut) and `Menubar.tsx` Panels submenu (`Variables and Tokens…`, `openVariablesPanel`). Stale comment corrected. Snapshot updated after diff review (24 menubar trees, +7 lines each, item only). New E2E `tests/e2e/inspector/variables-dialog.spec.ts` pins entry point, Escape-close, heading hierarchy, and empty state. |
| 2 | S2 | Variables and tokens dialog | Hosted a four-column variable table plus the token sync center in the narrow `sm` Dialog (32rem/512px), the only data-browser dialog not using `lg` (seven sibling precedents). | `size="lg"` on the Dialog. Verified rendered at ~830px. |
| 3 | S2 | Dialog heading hierarchy | Dialog title is `h2`; Token Sync rendered a second, nested `h2`, and the Variables title was a `span` — three strategies, no h2-to-h3 chain. | Both panel titles are now `h3`; asserted by E2E. |
| 4 | S2 | Dialog collapse affordances | Two different disclosure controls in one dialog: the shared `SectionCollapseToggle` (persisted) vs a hand-rolled Expand/Collapse text button (local state, lost on close). | Token Sync uses the shared toggle with `usePersistedDisclosure('token-sync')`; dead `__collapse` CSS removed; header no longer `space-between`. |
| 5 | S2 | VariablePanel | Zero-variables state rendered nothing between header and footer of the section (dead `.variable-panel__empty-hint` CSS proved an empty state was designed but never wired); add-form inputs relied on placeholder-only labels (WCAG 3.3.2). | Empty-state paragraph rendered (reusing the dead class); `aria-label` on the add name/value inputs. Deeper primitive rework (Input/Button, duplicate-name validation) recorded as remaining work. |
| 6 | S2 | Layer States header (Design tab, every selection) | Header visually broken: `space-between` centered the title between the chevron and the capture button (two-child case pushed it to the far edge), off-pattern with every `.insp-disclosure` header; title was a `span`, not a heading; category badges used cryptic `vis`/`xf`/`app` abbreviations with no expansion anywhere. | Header left-clusters chevron + `h3` title, capture button pushed right via `margin-left: auto`; type treatment matched to the canonical trigger (bold, primary text, `--tracking-wide`); badges spell out Visibility/Transforms/Appearance. Verified in the running app. |
| 7 | S2 | smartFilters.css / effects.css / MockupsSection.css | **Undefined design tokens** rendered as nothing: `--color-accent` (4 uses — curated-notice accent bar, curated icon, Object Finishing action icon, editor kind icon; the token only exists inside the `.effect-studio` scope), `--motion-fast, 120ms` (7 uses — hardcoded 120ms `ease` also bypassing the reduced-motion `--duration-quick: 0ms` override), `--color-border-default` (5 uses), `--border-subtle` (2 uses). | Replaced with canonical `--color-accent-primary`, `--duration-quick` + `--ease-standard`, `--color-border-subtle`. Verified at the CSS level; the curated notice only renders with a curated recipe applied, so its accent bar was confirmed by token resolution, not a screenshot. |
| 8 | S2 | Insights (IntelligencePanel) | Literal escape sequence rendered to users: `Scanning\u2026` as JSX text in the Linter tab loading state. | Now `Scanning…`. |
| 9 | S3 | Add-affordance casing | Sentence-case rule drifted: "Add Stroke" (Stroke; the context bar's identical affordance was already "Add stroke"), "Apply Tidy Up", "Variable Font Axes" subsection vs sentence-case siblings, segmented "Sq" cap label (its own `CAP_LABELS` map says "Square"), "Detach & Delete". | All normalized; unit tests and three E2E specs updated with the strings. The design-tab audit's stroke locator is now scoped to the Inspector because both labels are identical after the fix (they describe two deliberate entry points). |
| 10 | S3 | Align bar "Gap" button | Visible text "Gap" was not part of the accessible name (`aria-label="Distribution options"`) — WCAG 2.5.3 label-in-name. | `aria-label="Gap: distribution options"` (popover dialog keeps its visible-label name). |
| 11 | S3 | Node header | Accessible name glued the kind chip onto the name: "Rectangle 1shape", "Text: Headlinetext". | Explicit collapsed space between name and chip; visuals unchanged. |
| 12 | S3 | Variables panel header | Same `space-between` defect as finding 6 — title floated centered between toggle and controls. | Left-clustered; controls pushed right. Verified rendered. |
| 13 | S3 | Ellipses | ASCII "..." in user-facing strings while the codebase canonically uses "…": "Filter paints...", "Running audit...", "Initializing...", "Scanning..." (2). | Normalized to "…". |

### Recorded, not repaired (remaining work, owned follow-ups)

- **Object Filters information architecture**: three competing add-filter
  entry points (quick-pick cards, a "Choose a filter…" combobox, plus a
  "The full filter menu is below" paragraph pointing at the combobox), and a
  dashed "NON-DESTRUCTIVE" panel restating a property every filter already
  has. Needs a consolidation slice against the mission's quick-actions rule,
  not a text patch.
- **Insights/Audit**: confidence chips render a bare "70%" with no accessible
  explanation; the dismiss glyph carries three different verbs across surfaces
  ("Suppress this finding", "Dismiss this issue", "Dismiss conflict notice");
  nested Review/Contrast/More tabs use a vague "More" and a label
  ("Contrast") that does not name the tab's content; "+ n more (max display:
  N)" leaks internal config wording; severity chips show raw ids ("error (2)")
  while category chips are humanized.
- **Typography**: the Weight combobox shows the raw axis value ("400") rather
  than the style name; the AAA contrast badge is orphaned under the Style
  segmented control with no relationship to it; the Mask section body is empty
  for frames while text selections get mask actions.
- **VariablePanel**: raw inputs/buttons instead of the shared `Input`/`Button`
  primitives; `Number(newValue) || 0` silently coerces invalid input to 0 with
  no error surface; delete has no confirmation; the panel still uses the
  legacy `editor-inspector__group` shell inside a modal where the sidebar
  rationale no longer applies.
- **TokenSyncPanel**: parse errors and warnings render identically (both
  styled with the warning token; `--color-feedback-danger` is used only for
  conflicts); diagnostics are hard-truncated to five with no "N more" cue; the
  import button overrides `Button` primitives with bespoke CSS.
- **inspector.css raw values** (token discipline, enumerated for a follow-up
  slice): letter-spacing 0.02–0.03em where `--tracking-wide` exists (7 sites);
  the `.intelligence-field-label`/`.intelligence-text-input` block entirely
  off-scale (`inspector.css:3860-3878`); raw 0.1s/0.15s transitions in the
  section-manager and audit chrome; fixed `280px`/`400px` section-manager
  geometry; `.insp-section-manager__badge` at 0.6rem (below the smallest type
  token).
- **sectionRegistry naming**: "Layout child" (registry title, used by recovery
  buttons) vs "Child layout" (manager override) for the same section;
  "Position & size" override vs "Position & Size" registry casing; two
  distinct "Adjustment Layer" registry entries in different categories;
  "Resize to Preset" categorized `geometry` while sibling "Frame Presets" is
  `tool`.
- **Cross-surface observations** (outside this slice's ownership): the
  menubar renders "Compare Before/After" with a stray "\" accelerator;
  the status bar reads "Rectangle 1 Rectangle —" for name+kind; BooleanSection
  remains the one legacy (non-registry) disclosure in the composition, so the
  section manager cannot hide or restore it.

## 3. Verification

Environment: Linux (CachyOS), Chromium via Playwright (heavy-lease wrapped,
`--workers=1`, isolated `VARVE_E2E_PORT`, TMPDIR on disk), vitest jsdom.
The working tree is shared with parallel agents (188 changed files at
validation time); every command below was run against that tree, and the
full-suite escalation the planner printed is attributable to shared
workspace/toolchain files outside this slice.

### Commands actually run

| Command | Result |
|---|---|
| `pnpm exec vitest run` menu snapshot + localization + command integrity | 65 passed after `-u` (snapshot diff inspected: item-only, 24x7 lines) |
| `pnpm exec vitest run` nativeAdapter menu tests | 45 passed |
| `pnpm exec vitest run` TokenSyncPanel, LayerStatesSection, MaskSection, AlignDistributeBar, paintRows, registryDisclosure, PropertiesPanel, sections, Menubar | all green (46 + 44 + 28 across runs; one AlignDistributeBar failure during the change was its own stale aria-name assertion, fixed with the string) |
| `npx playwright test tests/e2e/inspector/variables-dialog.spec.ts` (new) | 3/3 passed (entry point, heading hierarchy, empty state) |
| `npx playwright test tests/e2e/inspector/design-tab-audit.spec.ts` | 21/21 passed after the stroke-locator scoping fix (20 passed before it, 1 failed on the renamed string) |
| `pnpm typecheck:e2e` | clean |
| `pnpm exec biome check --write` on the 28 touched files, then `biome check` | exit 0 |
| `pnpm audit:emoji` | clean |
| `pnpm --filter @varve/editor typecheck` | **57 pre-existing errors**, none on lines or files this slice changed (verified by diff cross-reference; files include in-flight shared-tree work: MockupsSection `labelWrap`, layoutVariants, inputPipeline, tool tests). Not introduced here; not fixed here. |
| `pnpm verify:plan` | selected the affected closure and printed `FULL-SUITE ESCALATION: YES` — triggered by shared-tree `package.json`/`Cargo.lock`-class files owned by parallel agents, not by this slice's paths |
| `pnpm verify:affected` | refused to run standalone because of the above escalation (exit 2 with escalation notice); slice-relevant lanes therefore run explicitly, listed above |

### Rendered evidence

- Variables and tokens dialog opened through View → Panels → "Variables and
  Tokens…" in the running app: `lg` width, left-clustered headers for both
  panels, empty-state copy visible, Escape closes.
- Layer States header now matches the sibling disclosure pattern
  (chevron + left-aligned uppercase title + trailing capture button).
- Object Filters/Insights/Adjustment Layer stacks re-inspected after the token
  and string changes; no layout regressions observed.

Skipped as unrelated: Rust crates, website, other packages' unit/typecheck
lanes (no owned file inside them), full Playwright matrix, benchmarks.
Full suite run: no — planner escalation originates in shared-tree files this
session does not own; the coordinating integrator should run the justified
`pnpm verify:full` checkpoint over the combined tree.

## Agent Validation Report

```text
Changed scope: packages/editor (menu defs + localization + Menubar panels
  item; VariablesPanelDialog + VariablePanel + TokenSyncPanel heading/
  collapse/empty-state/aria; LayerStatesSection header + badge labels;
  PropertiesPanel node-header a11y; text/token fixes in AlignDistributeBar,
  StrokeSection, TypographySection, MaskSection, PaintLibrarySection,
  SmartFilters CSS, effects CSS, MockupsSection CSS, IntelligencePanel;
  menu snapshot), tests/e2e (new variables-dialog spec; string/locator
  updates in design-tab-audit, variable-font-axes, alignment-arrangement)
Validation plan: pnpm verify:plan selected Tier 0-4 affected closure for
  @varve/editor + e2e; printed FULL-SUITE ESCALATION (shared-tree
  workspace/toolchain files, not this slice)
Commands actually run: see section 3 table
Passed: menu suites, component/unit suites listed, both inspector E2E specs
  (3/3 new, 21/21 audit), typecheck:e2e, biome on touched files, audit:emoji
Skipped as unrelated: Rust lanes, website lanes, other packages' units, full
  Playwright matrix, bench (no owned files inside)
Escalations: planner full-suite escalation — attributable to parallel agents'
  workspace/toolchain edits in the shared tree; deferred to the integrator
  checkpoint with a stated reason requirement
Full suite run: no
If yes, reason: n/a
```
