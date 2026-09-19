# Inspector Design-System Specification — Pass 2 (2026-09-19)

> Specification for the second Inspector Design-tab pass. Derived from
> `docs/audits/inspector-design-tab-audit-2026-09-19-pass2.md` (`IA-###`)
> and `docs/research/inspector-design-tab-research.md` (pass 2). It pins
> what is already right, changes what the audit measured as defective, and
> names what it deliberately defers. This spec supersedes nothing that
> ships; it is the contract the Design tab is built and gated against from
> this pass forward.

## 0. Principles

1. **Fix the system, not the symptom** — every change lands in a token, a
   shared primitive, or an enforcement gate; section-local patches are not
   accepted.
2. **No visual churn without a measured defect behind it** — the baseline
   matrix is the arbiter; changes that move pixels must trace to an IA-###
   finding.
3. **No capability removal** — nothing user-facing becomes unreachable.
4. **One density** — the Inspector has a single working density (research
   C: Figma's density toggle and Penpot's clutter both argue that options
   multiply surface without fixing the core); accessibility is served by
   the 2.5.8 spacing-exception contract and root-font-size scaling, not a
   density mode.

## 1. Tokens

### 1.1 New primitive-tier tokens (`@varve/ui` sizing source, generator-owned)

| Token | Value | Purpose |
|---|---|---|
| `--focus-ring-width` | `2px` | Focus ring stroke everywhere in the app UI (color already exists) |
| `--focus-ring-offset-inset` | `-1px` | Inside-the-border offset for inset controls (inputs, selects) |

Rationale (IA-018): focus color is tokenized but geometry is raw in every
control; a ring change today means editing N rules.

### 1.2 New component-tier tokens (`.editor-inspector` block, inspector.css)

| Token | Value | Purpose |
|---|---|---|
| `--insp-icon-size` | `12px` | Standard inline icon step (rows, triggers, meta) |
| `--insp-icon-size-lg` | `14px` | Large/primary icon step (align row, section actions) |
| `--insp-row-height` | `var(--target-min-compact)` (= 24px) | Flat row height; deliberately equal to the 2.5.8 target floor |

Allowed icon steps in Inspector markup and CSS: **12 / 14 / 16** (16 =
`--icon-size-sm`, kit step). Distribution evidence: measured icon census is
9–15px with mass at 11–14; 16px barely used (3/1292) — the 12/14 steps match
panel reality, and every 9–11 and 13,15 use maps up/down to the nearest
step. Icon size must be a **fixed step**, never `em`-relative: the measured
drift (11/13/15px) is produced by `size="0.95em"` compounding with variable
font sizes (root cause found at `controls/SegmentedControl.tsx:124` and
equivalents).

### 1.3 Changed component-tier tokens (typography)

| Token | Before | After | Why |
|---|---|---|---|
| `--insp-label-size` | `clamp(0.6875rem, calc(0.663rem + 0.1087vw), 0.75rem)` | `0.75rem` (12px fixed) | IA-021: label size must not shrink when the *window* narrows; the panel rail is independent of viewport width. At ≥1387px viewports the computed value was already 12px — zero visual delta on standard desktops |
| `--insp-value-size` | `clamp(0.75rem, calc(0.7255rem + 0.1087vw), 0.8125rem)` | `0.8125rem` (13px fixed) | Same rationale |

Root-font-size scaling (the matrix's 100/150/200% text-scale axis) still
works because the values are `rem`. The stale code comment describing a
"12→13px" ramp that the clamp never produced is corrected.

### 1.4 Typography consumption rules (pin)

- Section titles: 13px (`--insp-value-size`) / 700 / uppercase /
  `--tracking-wide` — unchanged, pinned.
- Labels: 12px (`--insp-label-size`) / 600 / uppercase / `--tracking-micro` /
  line-height `var(--type-interface-label-line-height)` (1.35) — the wrap
  modifier must consume the same token; raw `line-height: 1.25` is removed
  (IA-002).
- Values: 13px (`--insp-value-size`) / 400 / tabular numerics — unchanged,
  pinned.
- The two-step ramp (12 label / 13 value+title) is deliberate density,
  below the kit's `--type-interface-*` steps; it stays inspector-local.

## 2. Field grammar — the label-column contract (R1)

Three grammars are sanctioned, and only three. Every row in the Design tab
composes from them:

| Grammar | Primitive | Layout | Used for |
|---|---|---|---|
| **L (label-left)** | `FieldRow` → `.insp-field` | `grid-template-columns: minmax(0, 38%) minmax(0, 1fr)` | full-width single-control rows (Selects, checkboxes, one field) |
| **P (pair cells)** | `InspectorFieldGroup columns={2}` + `NumberField` | 2 equal cells; inline scrub-label at cell start | X/Y, W/H, Size/Line-height, Padding pairs |
| **A (label-above)** | paint/effect row primitives (`.insp-paint-row` family) | stacked label over composite control row | composite card rows only (fills, strokes, effects) |

Rules:

- New section CSS may not declare bespoke `grid-template-columns` for
  label/field arrangement; it must compose L/P/A. The existing ~28 local
  grids are inventoried by the gate (warn-level count) and shrink over
  time; wholesale migration is explicitly deferred (blast radius vs. this
  pass's budget).
- Within grammar L, the label column is proportional (38%) so the control
  column survives all three rails without truncation — measured behavior at
  240/320/640 is wrap-free for current labels.
- Grammar P cells share one right edge; trailing per-cell actions reserve a
  fixed slot so pair inputs stay width-equal (see §3.4).
- Right-edge contract: full-row controls (grammar L) end at the panel
  content edge; compact numeric fields right-align to it; no row may stop
  short unless it reserves the same trailing slot every comparable row
  reserves (IA-008).

## 3. Control anatomy

### 3.1 Heights (R4)

- Field height: `--component-compact-height` (32px) — inputs, selects,
  number fields. Already the de-facto standard; now the only sanctioned
  flat height for interactive fields.
- Flat row height: `--insp-row-height` (24px) — toggle rows, chip rows,
  meta rows.
- Composites (paint rows, curve editors, swatch stacks) derive from these;
  ad-hoc raw heights are inventory the gate counts (warn).

### 3.2 Focus (R7)

Every focusable Inspector control: `outline: var(--focus-ring-width) solid
var(--color-interactive-focus-ring); outline-offset:
var(--focus-ring-offset-inset);` (inset controls) — one geometry, theme
owned by the color token. High-contrast already overrides color; geometry
stays identical.

### 3.3 States (R6)

- Segmented controls (APG radiogroup, editor `SegmentedControl.tsx` stays
  the sanctioned implementation — it carries inspector-only affordances:
  disabled-reason, hideLabel, tooltip): **one selected treatment** — filled
  selected chip on `aria-checked="true"` — in every context. The second
  (outline) treatment found in Position & Size is removed (IA-012).
- Hover: one treatment per control class — inputs/selects raise border to
  `--color-border-strong`; buttons/chips raise surface to
  `--color-surface-raised`; no control relies on cursor-only feedback
  (research F7).
- Mixed values: italic muted "Mixed" placeholder + relative math on commit
  (`Mixed+100` parity) — already implemented in NumberField; pinned.

### 3.4 Pair-row trailing slot (IA-008)

W/H and X/Y pairs reserve an identical per-cell layout; the
constrain-proportions control sits in a fixed center/trailing slot so both
inputs keep equal widths and the row's right edge matches X/Y's. (Center
placement follows the already-shipped swap-button precedent.)

### 3.5 Icons (R3)

Fixed steps 12/14/16 via `--insp-icon-size(-lg)` in CSS and numeric
literals {12, 14, 16} in TSX. No `em`-relative icon sizes in the Inspector.

## 4. Section order and layout

- Current registry order and the contextual primary bands (typography →
  table → component/mockups → active mask) are **pinned**: stable order with
  a protected primary band is what the research endorses (A2/A3), and the
  2026-09-19 measured matrix shows no order-based complaints to act on.
- Per-selection composition stays membership-driven (`sectionComposition`);
  workspace variation stays predicate-gated (Photo sections) — no change.
- Section separation: card containment (`--space-2` gutters) rather than
  inflated whitespace; scroll budget guarded by collapse defaults (IA-006
  accepted).

## 5. Clutter decisions

| Decision | Status | Where the function lives |
|---|---|---|
| No element hidden or removed this pass | — | — |
| DocumentPanel raw `type="number"` inputs (8) migrate to `NumberField` | **do** | same file; adds scrub/math/mixed/spinbutton semantics — a capability gain (IA-024) |
| Image section internal grouping (IA-016) | defer | recorded in audit; needs its own interaction slice |
| `prototype-flow` reachability (IA-023) | defer | wiring a prototype-mode toggle is a product decision; section stays registered but unreachable (as today), documented |
| Corner Radius folding into Position & Size | defer | IA change, not styling; not this pass |
| "Show property labels" preference | rejected | labels are always on; the UI3 lesson (A2) is that removing them was the failure — an on/off option multiplies theme/test surface for no demonstrated need |

## 6. Enforcement (R10)

Extended rules in `scripts/quality/audit-inspector-css.mjs` (existing E1
undefined-var / E2 tracking / E3 duration errors unchanged):

| Rule | Level | Check |
|---|---|---|
| E4 | error | raw `font-size:` literal (px/rem) in Inspector stylesheets (the 4 present are fixed in this pass, then gated) |
| W2 | warn | raw numeric `line-height` in Inspector stylesheets (inventory; shrink over time) |
| W3 | warn | TSX `size=` / CSS width on `Icon` outside {12, 14, 16} in Inspector tree (inventory) |
| W4 | warn | count of `grid-template-columns` declarations outside the grammar files (trend metric) |

Policy tests for the gate are extended alongside; `pnpm audit:inspector-css`
stays in the affected-validation lanes.

## 7. Storybook position (documented deviation)

The task's primitive-story requirement is met by the existing unit-test
suites plus the E2E design-tab matrix (computed-metric assertions), not by
new Storybook stories: Storybook is configured only for `@varve/ui`, and
adding an editor-package Storybook instance is a toolchain escalation with
CI cost — recorded as a deviation with this rationale. If an editor
Storybook lands later, the primitives to story first are `NumberField`,
`FieldRow`/`InspectorFieldGroup`, `DisclosureSection`, `ContrastIndicator`.

## 8. Validation plan (per unit and final)

- Every unit: `pnpm verify:plan` → `pnpm verify:affected`; targeted suites
  for touched files (`NumberField.test.tsx`, `controls.test.tsx`,
  `DocumentPanel` tests, gate policy tests).
- After all units: re-run the design matrix (`VARVE_MATRIX_PHASE=after`)
  under the heavy lease; compare type census (label line-height unified to
  one key; icon census collapses to {12,14,16}), label offsets, control
  heights, and scroll budgets against the baseline; inspect the after
  screenshots directly.
- Regression: `design-tab-audit.spec.ts`, `typography-layout.spec.ts`,
  `number-field-interaction.spec.ts`, `control-layout.spec.ts`,
  `responsive-surface` audit; `pnpm audit:tokens`, `pnpm audit:docs`,
  `pnpm audit:emoji`, `pnpm audit:inspector-css`.

## 9. Requirement → implementation map

| Req | Findings | Implementation unit |
|---|---|---|
| R1 grammar contract | IA-001, IA-007 | spec §2 (pinned) + W4 inventory |
| R2 label typography source | IA-002 | IMPL-1 (token + wrap-modifier fix) |
| R3 icon steps | IA-003, IA-020 | IMPL-1 (tokens) + IMPL-2 (offender normalization + W3) |
| R4 height tokens | IA-004, IA-019 | IMPL-1 (`--insp-row-height`) + existing 32px pin |
| R5 right-edge contract | IA-008 | IMPL-3 (pair trailing slot) |
| R6 one segmented selected-state; cell content rules | IA-010, IA-011, IA-012 | IMPL-2 |
| R7 focus geometry tokens | IA-018 | IMPL-1 |
| R8 type decoupled from viewport | IA-021 | IMPL-1 |
| R9 bounded layout repairs | IA-009, IA-013, IA-014, IA-015 | IMPL-4 |
| R10 enforcement | IA-022 | IMPL-1 (gate extensions, after literals fixed) |
| R11 wiring/stories | IA-024, IA-025, IA-023 | IMPL-5 (DocumentPanel), §7 deviation, §5 defer |
