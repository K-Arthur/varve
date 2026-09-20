# Inspector Design System Specification (2026-09-19)

> Normative contract for the Inspector panel (`packages/editor/src/components/Inspector`).
> Scope: the Design tab and the shared primitives it composes. The specification
> describes the system as it must behave after this pass; where the current code
> does not yet satisfy a clause, the clause names the implementation id
> (`IMPL-###`) that lands it. Evidence ids (`RES-###`, `AUD-###`, `A11Y-###`,
> `PERF-###`) resolve in `docs/research/inspector-design-tab-research-2026-09-19.md` and
> `docs/audits/inspector-design-tab-audit-2026-09-19.md`.

## 1. Principles

1. **One spatial rhythm.** Every margin, padding, and gap in the panel resolves
   to a spacing token. Section separation is carried by a quiet separator plus
   a density-aware vertical gap; whitespace inside a section groups properties.
   (RES-038; AUD-003.)
2. **Stable section order.** Common geometry/appearance sections keep their
   position regardless of contextual sections; contextual content enters at
   defined order slots and never displaces the primary band. (RES-004;
   `sectionRegistry.ts:1099-1150`.)
3. **Dense but legible.** Default Pro uses 34px Inspector rows and a more
   breathable vertical rhythm; Compact Pro uses 28px rows and the narrow-gap
   rhythm. Type never drops below the label floor, and hit areas stay
   at or above the 24×24 CSS-pixel target floor or its measured spacing
   exception. (RES-017, RES-025, RES-033, RES-036.)
4. **One interaction model per value class.** All numeric values scrub, step,
   and type identically; all enums use the same select or segmented control;
   all colours open the same popover. No section invents its own control.
   (RES-006; AUD-007.)
5. **Progressive disclosure, not deletion.** Secondary properties collapse by
   default through the registry; nothing is removed to shorten the panel.
   (Prior decisions, `inspector-design-tab-followup-2026-09-17.md`.)
6. **Labels are visible by default.** Icon-only actions exist only where the
   icon is established and carry an accessible name plus tooltip. No
   user-facing "hide property labels" mode: research shows it as a
   *migration aid*, not a better default (RES-001), and Varve's labels are
   already part of its scan rhythm.
7. **Keyboard parity.** Every pointer gesture has a keyboard equivalent; every
   control is reachable in DOM order with a visible focus indicator that is
   never obscured. (RES-026…RES-032.)
8. **Theme parity.** Every colour and state resolves through semantic tokens in
   all three themes; no literal colour, no undefined token reference.
9. **State truthfulness.** Mixed, unset, bound, calculated, unavailable and
   error states are words and accessible names, never colour alone.
10. **Enforcement over convention.** A machine check prevents re-drift
    (`REQ-014`); conventions that cannot be checked will not survive.

## 2. Token architecture

### 2.1 Source of truth

Application tokens come from `packages/ui/src/tokens` and are emitted to
`packages/ui/src/tokens/tokens.css` by
`packages/ui/scripts/generate-token-css.ts` (never hand-edited). Color has a TS
source (`color.ts`, 120 tokens × 3 themes); spacing, sizing, typography and
icon tokens have TS sources; radius/elevation/motion/z-index/micro-borders are
generator-owned.

### 2.2 Tiers used by the Inspector

| Tier | Examples | Rule |
|---|---|---|
| Primitive | `--space-1` … `--space-32`, `--font-size-2xs`…`--3xl` | No section may hard-code a value the primitive tier already names. |
| Semantic | `--space-panel`, `--space-control`, `--type-interface-label-*`, `--color-text-muted`, `--color-border-subtle`, `--color-interactive-focus-ring` | Preferred for panel chrome and text. |
| Component | `--density-rows-min-height` (34px/28px), `--target-min-compact` (24px), `--touch-target-min` (44px), `--radius-control-compact`, `--tracking-micro`, plus Inspector-local aliases | Component geometry must come from this tier, not invented values. |

**New tokens (this pass):**

| Token | Value | Rationale |
|---|---|---|
| `--tracking-micro` | `0.02em` | The Inspector expresses one idea — slightly opened uppercase micro-type — with 11 literals across `inspector.css` (0.02/0.025/0.03em ×8) and three satellite stylesheets (0.04em ×3). One token replaces four drifting values (AUD-004; RES-038). |
| `--insp-popover-inline` (Inspector-local) | `17.5rem` | Replaces `280px` literals (`inspector.css:702, 6867`); rem tracks the user's font scale (AUD-005). |
| `--insp-popover-max-block` (Inspector-local) | `25rem` | Replaces `max-height: 400px` (`:703`). |

A further candidate, `--insp-popup-option-height`, was considered and
deliberately **not** added: popover option rows already consume
`--menu-item-min-height` (32px) from the sizing tier, so a second token would
have had no consumer. Dead tokens are prohibited by review, not just by taste.

Existing Inspector-local aliases (`inspector.css:7181-7188`) stay and are
normative for Inspector semantics: `--insp-label-size`, `--insp-value-size`,
`--insp-preview-max-inline-size`, and the density-aware rhythm aliases. They
are adapters, not a second component system: shared Select/Button/Input
primitives continue to own their global chrome, while the Inspector supplies
only its row-height and semantic spacing context. New local aliases must alias
an existing token or a rem value with a named semantic role; raw px is
prohibited (REQ-014 enforces).

**Prohibited:** literals for colour (`#hex`, `rgb()`, `oklch()` outside a token
definition), `font-size` outside the type ramp, `letter-spacing` outside
`--tracking-*`, `transition` durations outside `--duration-*`, fixed px panel
geometry. Allowed exceptions: `1px`/`2px` hairlines and outlines, percentages,
`0`, `100%`, and `color-mix()` composed from semantic tokens.

### 2.3 Density

The Inspector consumes the existing application density preference. The root
`data-density="comfortable"` value (Default Pro) resolves to 34px rows; the
`data-density="compact"` value (Compact Pro) resolves to 28px rows. The
Inspector-local aliases in `inspector.css` map the same preference onto panel
inset, section separation, body gap, field-group gap, and content padding:

| Role | Default Pro | Compact Pro |
|---|---|---|
| Field/action row | `--density-rows-min-height` (34px) | `--density-rows-min-height` (28px) |
| Panel inset | `--space-3` | `--space-2` |
| Section separation | `--space-3` | `--space-2` |
| Section body gap | `--space-2` | `--space-1` |
| Field-group gap | `--space-3` | `--space-2` |
| Body padding | `--space-2` / `--space-3` | `--space-1` / `--space-2` |

The effective section separation remains greater than the intra-section row
gap in both modes. Coarse pointers promote applicable interactive targets to
`--touch-target-min` (44px); text metrics, semantic names, 24px target floors,
section order, selection, document history, and canvas geometry do not change.
The setting is not a third Inspector-specific density and never enters the
document undo stack.

## 3. Grid and spatial model

### 3.1 Row model

- A property row is a two-column grid: **label column** `minmax(14px, 38%)`
  (existing `.insp-field` contract) and a flexible control column.
- A row uses the active Inspector density height (34px Default Pro / 28px
  Compact Pro); stacked multi-line rows may grow, and the label uses the wrap variant
  (`.insp-field__label--wrap`, lh 1.25) instead of overflowing.
- Paired numeric fields (X/Y, W/H, min/max) render as two `.insp-field`
  children inside one `InspectorFieldGroup`; within a group the fields share
  one grid so label/control columns align across the pair.
- Auxiliary actions (lock, swap orientation, flip) occupy stable
  `action-slot`s in the group, so adding or removing an action never reflows
  the fields (implemented for Position & Size; contract for all groups).
- Label-only-left is the default; a row may stack the label above a full-width
  control (`insp-field--stacked`) only when the control needs the full width
  (e.g. the five-up fit track) — never to save vertical space.
- Row spacing within a section body follows the active density (`--space-2`
  Default Pro / `--space-1` Compact Pro); between first-level groups follows
  `--space-3` / `--space-2`; a subsection body adds no new padding beyond its
  parent.
- Alignment contract: within one section body there is exactly **one label
  column start**; nested contexts (paint rows, subsection bodies) may indent by
  exactly one `--space-3` step. Deviation is a defect (AUD-001, IMPL-006).

### 3.2 Section model

- A section is a quiet separator region with a header and a body; it does not
  add a nested card border or elevation.
- Panel inset, section gap, body gap, and body padding follow the density table
  above. Inter-section separation is intentionally larger than the body row
  gap so long property lists remain scannable without card-heavy chrome.
- Section header: full-width button, chevron + title + right-clustered
  actions; height `--panel-header-height` or content-driven, never below 24px.
- Collapsed sections may show a **summary** as `aria-describedby` text (never
  inside the accessible name).
- Actions (`+ Add fill`, `+ Add stroke`) are persistently visible in the header
  area, never hover-only (RES-003).

## 4. Typography system

| Role | Token(s) | Measured value | Notes |
|---|---|---|---|
| Section title | `--type-interface-title`-adjacent ramp: 13px/700/lh 19.5/tracking `--tracking-wide` (0.65px) | Verified 307 occurrences | Uppercase via CSS; no other size permitted for a section header. |
| Property label | `--insp-label-size` (12px at 1440) / 600 / lh 1.35 (`--type-interface-label-line-height`) / `--tracking-micro` / `--color-text-muted` | Verified 381 occurrences | Wrap variant lh 1.25. |
| Value / numeric | `--insp-value-size` (13px) / 400 / lh 19.5 / tabular numerals for numbers | Verified 210 occurrences | Muted value colour only for disabled/secondary values. |
| Hint / helper | `--font-size-xs` (12.48px) / 400 / `--color-text-muted` | Verified 18 occurrences | |
| Badge / metadata | `--font-size-2xs` floor; `--tracking-micro` | Badge literal 0.6rem is below the token floor → replaced (AUD-005) | |
| Monospace numerics | `--type-data-numeric-family` | Already used for numeric rails | Preserves column stability. |

No new font sizes. Tracking is limited to `--tracking-micro` (micro labels and
badges) and `--tracking-wide` (section headers) after IMPL-002.

## 5. Primitive specifications

### 5.1 Section — `DisclosureSection` (registry mode)

- **Anatomy:** `<section>` → header (`<h3><button>`) → body `<fieldset>`.
- **Semantics:** button with `aria-expanded`; `aria-controls` only when the
  panel exists; context menu "Hide section" when `canHide` (APG Disclosure,
  RES-028).
- **Keyboard:** Enter/Space natively; Escape closes only popovers, never a
  disclosure.
- **Persistence:** `sectionVisibility` by `sectionId`; legacy sessionStorage
  mode is closed to new sections.
- **Manageability:** every section with `canHide: true` that composes in the
  Design tab must be listed by `SectionManagerTrigger`; ownership surface is
  not a proxy for renderability (AUD-013, IMPL-007).
- **Empty state:** a section that would render nothing must not render at all
  (availability predicate), never an empty body (AUD-015 Mask-for-frames is the
  one recorded exception to revisit).

### 5.2 Property row — `FieldRow` / `InspectorFieldGroup`

- **Anatomy:** `<div.insp-field>` → `<label>` + `.insp-field__control`.
- **Variants:** plain row, stacked row (`--stacked`), wrapped label,
  hidden-label (visually hidden label still in the a11y tree).
- **Responsive:** groups collapse their paired columns below the panel's
  container width (container query), never truncate labels to ellipsis
  mid-word, never overflow the rail (`inspector-responsive-surface-audit`).
- **Tests:** `controls.test.tsx`, plus rendered geometry assertions in
  `inspector-responsive-surface-audit.spec.ts`.

### 5.3 Numeric field — `NumberField`

Normative behaviour (already implemented; the spec pins it against regressions):

| Concern | Contract |
|---|---|
| Pointer scrub | Drag on the label; pointer capture; relative movement, so screen edges cannot clamp the gesture (RES-008). A press under the travel threshold is a click (focus/select), not a scrub. |
| Undo | One transaction per gesture: begin on first movement, commit on pointer up; pointer-cancel/blur/Escape abort with no history entry. Wheel gestures coalesce with an idle gap. |
| Keyboard | Up/Down ±1; Shift modifies the step; Page Up/Down larger step; Home/End min/max where bounds exist (APG spinbutton, RES-027). |
| Direct entry | Focus selects contents (RES-006); committed strings evaluate arithmetic expressions and `{alias}` variable references (`evaluate` from `@varve/scene`). |
| Invalid input | Does not commit; sets `aria-invalid` and an `aria-describedby` error; value reverts on blur/Escape. |
| Mixed | Shows the literal word "Mixed" (not a dash), keeps the field editable for batch set. |
| Bound / calculated | Read-only presentation with the variable or sizing-mode description; never silently overwrites. |
| Units | Rendered as a suffix inside the field; conversion never changes stored precision. |
| Double-click | Resets to the value's natural value only where the field declares one (Sketch convention, RES-006) — currently not implemented; recorded as `AUD-024`, not claimed. |

### 5.4 Segmented control — `SegmentedControl`

- Semantics: `role="radiogroup"` with roving tabindex (APG radio group).
- Keyboard: arrows move and select; Home/End first/last; type-ahead optional.
- Sizing: each segment ≥24px in both axes, or the group satisfies the spacing
  exception; compact labels may abbreviate only via a declared display label,
  never silently.
- Overflow: wraps to a second line before it clips; never scrolls horizontally
  inside a rail.

### 5.5 Paint / colour row

- One row per paint layer: enable toggle, type trigger, value pill, actions.
- The value pill prints the solid hex, gradient type, image name, or "Mixed",
  with the full value in the accessible name (WCAG 2.5.3 label-in-name).
- Colour opens `InspectorColorPopover` (portal, Escape closes, focus returns);
  blend mode is reachable both as a chip and inside the popover.
- Add/remove actions are persistently visible; removing the last paint is
  disabled with a stated reason, not a silent no-op.
- **Text colour is one model, two views (REQ-015).** For text selections the
  Typography section renders a Colour row bound to the first visible fill
  through `updateSelectedFillAt` — the same mutation the Fill section uses.
  The Fill section remains the stack editor (multiple fills, gradients, image
  fills, blend modes). When the text fill is non-solid or stacked, the
  Typography row stays visible, prints the type ("Gradient") or "Mixed", and
  its disabled reason routes the user to Fill. No second piece of state, no
  duplicate add/remove affordances.
- **Faces default to the value (REQ-016).** `InspectorColorPopover` derives its
  swatch face from `value` when the caller passes no `swatchStyle`, so an
  omitted face can never render empty while the pill prints a colour. Callers
  whose paint is richer than a single colour (gradient, image, a "Mixed"
  stack) pass an explicit face; a stack face is neutral so it cannot
  contradict the label. Found 2026-09-19 after the text-colour row shipped
  with a hex value and no painted face (AUD-027); four pre-existing consumers
  that omitted `swatchStyle` are fixed by the same default.

### 5.6 Icon action / toggle

- Every icon-only control has an `aria-label`, a tooltip with the same string,
  a ≥24×24 pointer target (or measured spacing exception), visible focus ring,
  and `aria-pressed`/`aria-checked` when it is a toggle.
- Established icons only; novel concepts get a label.

### 5.7 Select

- Always `@varve/ui` `Select`/`Combobox`. Native `<select>` is prohibited
  (hard rule; AUD-008). Rows below 24px inside a listbox must satisfy the
  spacing exception.

## 6. Section architecture

Ordering is registry-owned (`resolveSectionOrder`). For each selection family
the intended reading order is:

| Family | Order |
|---|---|
| Generic shape | Align & Distribute → Pathfinder (boolean) → Position & Size → Corner Radius → Stack/Grid → Layout child → Appearance → Mask → Fill → Paint Library → Stroke → Object Filters → Adjustment access → Layer Effects → Selection Colors → Warp → Layer States → Insights |
| Text | Typography (+ subsections) → Text on Path → Align & Distribute → Position & Size → … |
| Image | Align & Distribute → Position & Size → Fill → Image Placement → Crop & Bounds → Appearance → Mask → …, then Image Resolution → Perspective → AI hint → Palette/Adjustments routing |
| Frame with layout | Position & Size → Corner Radius → Stack/Grid (+ guides) → Appearance → … |
| Component/Mockup | Component / Mockup → Typography (if text) → Position & Size → … |
| Multi-select | Align & Distribute → Position & Size → Corner Radius → Layout child → Appearance → Fill → Stroke → Image Placement → Effects → Selection Colors → Typography (all text) → Layer States |
| No selection (document) | Canvas → Snapping → Document Color → Soft Proof → Document Grid → Isometric Grid → Layer States → Insights |

Rationale: task frequency first (geometry, then paint, then effects), Varve
capability second (Pathfinder only for live booleans), research third
(Figma UI3's failure was *displacement*, not the order itself — RES-004).

## 7. Clutter-reduction ledger

| Existing item | Problem | Decision | New location/state | Discoverability | Evidence |
|---|---|---|---|---|---|
| Mixed/uncommon sections (`effects`, `smart-filters`, `adjustment access`, `paint-library`, `selection-colors`, `layer-states`) | vertical length | Keep collapsed by default (already) | same position, collapsed | header + summary | measured ratio; prior audits |
| `insights`, `image-crop`, `ai-tools-hint`, `mockups` | hidden state unmanageable | Fix manager listing | same position; now hideable/restorable | section manager row | AUD-013 |
| Object Filters triple add-entry | competing affordances | Deferred consolidation slice | unchanged this pass | unchanged | AUD-014 |
| DocumentPanel raw number inputs | bypass shared primitive | Deferred migration | unchanged this pass | unchanged | AUD-007 |
| Dead components/CSS | maintenance surface | Delete (IMPL-005) | n/a | n/a | AUD-010/011 |

## 8. Responsive behaviour

| Condition | Contract |
|---|---|
| Rail 240px (minimum) | Paired fields stay on one line only if both controls keep ≥6ch usable width; otherwise stack. No horizontal overflow (clientWidth ≥ scrollWidth−1). |
| Rail 320px (default) | Two-column pairs as designed; five-up fit track fits without wrapping. |
| Rail ≥400px | Fields may show expanded action slots; no content moves position. |
| 150% text scale | Row heights grow with the control, labels do not clip, paired columns may stack. |
| 200% text scale | No information loss, no two-dimensional scrolling inside the panel; targets remain ≥24px effective (RES-031). |
| Long labels/values | Labels wrap via `--wrap`; numeric rails keep a fixed character budget (`--insp-numeric-rail` 8ch/9ch) and scroll the value internally rather than widening the row. |
| Long font/style names | Truncate with the full value in `title`/accessible name; never push the control out of the rail. |

## 9. Enforcement (REQ-014)

`scripts/quality/audit-inspector-css.mjs` (new) fails on:

1. `var(--x)` reference where `--x` is not defined by any token source, any
   `:root`-level definition in a scanned stylesheet, or a local definition in
   the same file (catches AUD-006 class).
2. Literal `letter-spacing`, `font-size`, `transition`/`animation` duration,
   `border-radius`, or colour values in Inspector CSS outside the token or the
   documented exception list.
3. Raw px geometry for the section-manager popover or other panel chrome.

Exceptions are granted inline with a trailing comment
`/* audit-inspector-css: allow <reason> */` on the declaration, so legitimate
one-off geometry (icon SVGs, pixel hairlines) remains possible and auditable.

The script is wired into `package.json` (`audit:inspector-css`) and into
`validation-impact.config.mjs` so any change under
`packages/editor/src/components/Inspector/**` selects it automatically.
`pnpm audit:radius` and `lint:css` remain developer-invoked; the new script is
the Inspector's own gate.

## 10. Storybook position

`packages/ui` Storybook covers the shared primitives the Inspector consumes
(`Select`'s narrow-inspector story, `Field`, `NumberInput`, `Disclosure`,
`Tooltip`, `Popover`, interaction-state gallery). The Inspector's own
primitives (`FieldRow`, `NumberField`, `SegmentedControl`,
`DisclosureSection`, `RangeValueControl`) live in `@varve/editor`, which has no
Storybook configuration. Adding one is a build-infrastructure change outside
this pass's scope; those primitives are instead pinned by
`controls.test.tsx`, `NumberField.test.tsx`, `registryDisclosure.test.tsx` and
the rendered `design-tab-audit.spec.ts` (21 scenarios). This is a documented
deviation, not an oversight: for a dense DOM-geometry surface, rendered
assertions in the real editor catch failures a component story cannot.

## 11. Requirement index

| Requirement | Statement | Where normative |
|---|---|---|
| REQ-001 | Common sections keep a stable reading order; contextual sections never displace the primary band. | §1.2, §6 |
| REQ-002 | The panel's vertical budget is measured, not assumed; collapsed defaults carry secondary volume. | §1.3, §7 |
| REQ-003 | One label column per section body; nested contexts indent by one spacing step. | §3.1 |
| REQ-004 | Every composite row height derives from a named sizing token. | §3.1, §2.2 |
| REQ-005 | Interactive targets ≥24×24 CSS px or a measured spacing exception; legibility floors hold. | §1.3, §5.6 |
| REQ-006 | All tracking resolves to `--tracking-micro` or `--tracking-wide`; no literals. | §4 |
| REQ-007 | Motion durations resolve to `--duration-*` tokens (reduced-motion honoured). | §2.2 |
| REQ-008 | Panel chrome geometry resolves to tokens or named rem aliases; no raw px. | §2.2 |
| REQ-009 | No `var()` reference may point at an undefined custom property. | §2.2, §9 |
| REQ-010 | Selects are `@varve/ui` controls; native `<select>` is prohibited. | §5.7 |
| REQ-011 | No dead components, dead classes, or duplicate stale rule blocks ship. | §9, §11 |
| REQ-012 | Every `canHide` section that composes in the Design tab is listed and restorable in the section manager. | §5.1 |
| REQ-013 | States and copy are truthful and human-readable; no raw ids, bare percentages, or internal config wording in user-facing text. | §4, §5.5 |
| REQ-014 | Machine enforcement prevents re-drift; exemptions are explicit and reasoned. | §9 |
| REQ-015 | Text colour is reachable from Typography as a view of the single fill model; stacks and non-solid fills route to the Fill section instead of duplicating state. | §5.5 |
| REQ-016 | A colour trigger's face always previews the value it announces; omitting an explicit face cannot render an empty or misleading swatch. | §5.5 |

## 12. Acceptance
A change to the Inspector is complete only when: the new script passes,
`pnpm verify:affected` selects and passes the affected closure, the design-tab
audit and the responsive/baseline matrix specs are green, the rendered
before/after metrics confirm the intended spatial result, and the change is
committed atomically with its evidence path.
