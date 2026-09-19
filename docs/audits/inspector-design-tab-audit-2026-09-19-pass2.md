# Inspector Design Tab — Audit and Gap Analysis (2026-09-19, pass 2)

> Independent audit for the second Inspector Design-tab pass. Produced from
> a fresh measured baseline, a fresh code census, and direct visual
> inspection of the fresh screenshots; it does not derive from earlier audit
> documents. Finding ids are `IA-###` (this pass) to avoid collision with
> prior passes' ids.
>
> Evidence base:
> - `reports/inspector-redesign/baseline-matrix/` — fresh capture
>   2026-09-19 05:11–05:25 (3 Playwright tests, 3/3 passed, heavy lease,
>   isolated port): `metrics-light.json` (9 scenarios × 3 rails),
>   `metrics-themes.json` (3 themes × default rail),
>   `metrics-textscale.json` (100/150/200% × default rail), `shots/*.png`.
> - Code census: see §2.
> - Visual inspection: `light-rectangle-320.png`, `light-text-320.png`,
>   `light-image-320.png` examined directly (§4).

## 1. Architecture (measured, current)

- Entry `PropertiesPanel.tsx` → `composeSections` over membership lists in
  `sectionComposition.tsx` (single / single-table / multi / tool), gated by
  `sectionRegistry.ts` (59 section definitions, availability predicates,
  contextual primary-band ordering) and user prefs in `EditorState
  .sectionVisibility` (persisted).
- Workspace mode changes the Design tab in exactly two ways: Photo-only
  image sections (13 sections gated `workspaceMode === 'image'` +
  `ai-tools-hint` inverted) and the per-mode tab bar
  (`WORKSPACE_CONFIGS[mode].inspectorTabs`). Section membership itself is
  mode-invariant.
- Shared controls: `DisclosureSection`, `FieldRow`/`InspectorFieldGroup`,
  `NumberField` (APG spinbutton: scrub, arrows+modifiers, PageUp/Down,
  wheel, math expressions incl. `{alias}`, mixed values, bound/readonly
  property state), `SegmentedControl`, `RangeValueControl`,
  `InspectorColorPopover`, `BindingMenu`, `TokenBindIndicator`,
  `SectionManagerTrigger`.
- CSS: `inspector.css` 7,385 lines + 18 satellite stylesheets (12,362 total).
- Sections per state (expanded worst case, light, 320 rail): no-selection 7
  (ratio 6.1×), rectangle 12 (3.4×), ellipse 11 (3.3×), text 17 (6.9×),
  frame 14, image 22, group 8, multi-same 11, multi-mixed 11. Defaults
  collapse most sections; these are audit bounds, not default views.

## 2. Code census (fresh)

| Metric | Value | Source |
|---|---|---|
| Raw `px` literals | 951 (top: 1px×325, 2px×210, 8px×47, 24px×47) | 19 inspector stylesheets |
| Raw hex colors | 31 (photoSource 21, imageTuning 9, inspector 1 in comment) | same |
| Raw `rgb()/rgba()` | 9 | same |
| Raw `font-family` | 5 | same |
| Raw `rem` on non-var lines | 151 | same |
| `!important` | 0 | same |
| Section-local `grid-template-columns` | ~28 distinct | inspector.css |
| Control-height declarations | ~15 distinct raw values vs `--component-compact-height` (32px, used 22×) | inspector.css + satellites |
| Undefined `var()` targets | 0 (gate `audit:inspector-css` clean) | gate output |

## 3. Measured-metric findings

### IA-001 — Three label-column x-positions in every selection state (P1)

`labelOffsets` per state (light; unique rounded values):

| State | 240 rail | 320 rail | 640 rail |
|---|---|---|---|
| rectangle | 1211, 1319, 1326 | 1128, 1279, 1329 | 808, 1119, 1329 |
| ellipse | 1211, 1319, 1326 | 1128, 1279, 1329 | 808, 1119, 1329 |
| text | 1211, 1319, 1326 | 1128, 1279, 1329 | 808, 1119, 1329 |

Three distinct label start columns — spread 115px at 240, 201px at 320,
521px at 640 — in *every* object state. Root cause (code): the panel has
**three competing field grammars**:

1. `.insp-field` — grid `minmax(0, 38%) minmax(0, 1fr)` (inspector.css:6203)
   for FieldRow (left-column label).
2. `.insp-num` — inline flex, label *inside* the control area
   (inspector.css:1454), used by every NumberField (X/Y/W/H pairs put their
   inline labels at the pair-cell start).
3. ~28 section-local `grid-template-columns` (e.g. `minmax(0,1fr) 92px` at
   :2223, `minmax(0,38%) minmax(0,1fr)` at :6210, `max-content minmax(0,1fr)`
   at :6419, `14px minmax(0,1fr)` at :6426…).

Visual confirmation (rectangle@320): Position & Size and Appearance use
left-column labels; Corner Radius and Fill use label-above; X/Y and W/H are
two-cell pairs with inline labels. This is the "item arrangement" defect the
task names. **The three grammars are not aligned to one shared column
system.**

### IA-002 — Label line-height split (P1)

Census key `label|12px|600` appears with line-height **16.2px** and **15px**
in every state (e.g. no-selection: 32× at 16.2px + 8× at 15px). Source:
`.insp-field__label` uses `var(--type-interface-label-line-height)` (1.35 →
16.2px @12px) but the wrap modifier sets raw `line-height: 1.25`
(inspector.css:1378) → 15px. Same label, two rhythm lines.

### IA-003 — Icon-size drift: 7 distinct sizes in one panel state (P1)

Measured `iconSizes` (rectangle/ellipse/text): 9, 10, 11, 12, 13, 14, 15px.
Icon tokens exist (`--icon-size-sm: 16px` etc.) but are not consumed by
these controls. Visual: the three icon buttons under the radius row render
visibly smaller than the align-row icons; image state mixes icons whose
optical sizes differ 1–2px.

### IA-004 — Control-height drift (P1)

Measured control heights across states: 24, 30, 31, 32, 44, 51, 52, 54, 55,
63, 65, 66, 88, 113 (composites included; the flat-field set is
24/30/31/32/44). `--component-compact-height` (32px) is the de-facto field
standard (22 uses) but ~15 raw heights compete in CSS, and
`.insp-field-row__split` rows let contents define their own heights.

### IA-005 — Undersized targets: none failing (verified good)

Fresh `undersizedTargets` audit (2.5.8 spacing-exception aware): **0 failing
targets** in all 27 light-rail captures and theme/text-scale captures.
Maintain; not a defect.

### IA-006 — Expanded-scroll ratios are large but collapse-defaulted (P3)

Worst case (all sections expanded): no-selection 7.3×, text 7.5× at the 240
rail. Registry defaults collapse 16+ sections; the default view is
materially smaller. Recorded as accepted density, protected by the
section-manager hide/reorder system.

## 4. Visual findings (direct screenshot inspection)

From `light-rectangle-320.png`:

- **IA-007 — Mixed label grammar per section** (P1, with IA-001):
  Position & Size + Appearance = label-left; Corner Radius + Fill =
  label-above-control. Both patterns are legitimate, but today *which*
  pattern a section uses is historical accident, not a rule.
- **IA-008 — Ragged right edge** (P2): W/H rows stop short at the
  constraint-link icon while Opacity's input touches the right margin; the
  panel's right edge has no shared contract (some rows reserve a trailing
  24px slot, others don't).
- **IA-009 — Mask add pills wrap** (P2): at the 320 rail the "Add mask"
  pills wrap to two lines (`inspector.css:2381` block).

From `light-text-320.png`:

- **IA-010 — Weight/Style row misalignment** (P1): the Style
  `SegmentedControl` sits lower than the Weight `Select` in the same
  `InspectorFieldGroup columns={2}` — the two controls have different
  intrinsic heights (`TypographySection.tsx:641-687`).
- **IA-011 — Contrast badge placement** (P2): `ContrastIndicator` renders
  *inside* the Style cell below the segmented control, looking like a stray
  dot; no caption/alignment with the row (`TypographySection.tsx:670-686`).
- **IA-012 — Two selected-state styles for segmented controls** (P2): the
  panel simultaneously shows a filled selected segment (Style row) and an
  outline/border selected segment (Orientation row) — two different
  selected treatments in one surface.
- **IA-013 — Long labels wrap mid-rhythm** (P2): "LETTER SPACING (PX)"
  wraps to two lines while sibling labels stay one line.

From `light-image-320.png`:

- **IA-014 — Section-title gutter drift** (P2): visible 1–2px differences
  in section-title x positions between sections (sticky header padding vs
  body padding mismatches).
- **IA-015 — Three input-width systems in one section** (P2): Image
  Placement shows X/Y pair inputs (half-width), Corner-Radius-style short
  inputs, and full-bleed selects in successive rows.
- **IA-016 — Image section mixes concerns without grouping** (P3):
  action chips (Replace/Edit), metadata (size/DPI), transform (Rotation) and
  destructive Remove sit in one flat card; Rotation strands at the bottom;
  Remove Image — the most destructive action — renders first among chips.
- **IA-017 — Fill row action crowding** (P3): swatch + value + 2–3 action
  buttons in one row is the densest single row in the panel.

## 5. Token-system gaps (fresh)

- **IA-018 — No focus-ring geometry tokens** (P1): focus is styled per
  control with raw `outline: 2px solid var(--color-interactive-focus-ring);
  outline-offset: -1px` (e.g. inspector.css:1513-1515, and equivalents
  elsewhere). Color is tokenized; **width and offset are not** (no
  `--focus-ring-*` in tokens.css).
- **IA-019 — No row-height tokens** (P1): flat rows at 24px and fields at
  32px exist only as scattered raw values; nothing names
  "inspector row height".
- **IA-020 — Icon tokens exist but are unconsumed by inspector controls**
  (P1, with IA-003).
- **IA-021 — Inspector type sizes are local clamps, not ramp tokens**
  (P2): `--insp-label-size: clamp(0.6875rem, calc(0.663rem + 0.1087vw),
  0.75rem)` and `--insp-value-size` (inspector.css:7309-7310) scale with
  **viewport width**, so narrowing the window shrinks Inspector text even
  when the panel rail is unchanged; `--type-interface-label-size` /
  `--type-interface-control-size` tokens exist but are consumed exactly once
  each. The code comment above the clamp ("12px @360 → 13px @1280") does not
  match the actual clamp (max 0.75rem = 12px) — stale comment. WCAG 1.4.4
  concern: window resize is not a user font-size control; text shrinking
  with the window compounds small-text complaints (research F1).
- **IA-022 — Raw literals inventory** (P1 to gate, P3 to exhaust): §2
  census. 1px/2px literals (535 occurrences) are mostly borders/outlines —
  candidates for `--separator-thickness`-style tokens or an explicit
  border-width allowance list; hex/rgb literals cluster in four satellite
  stylesheets (effect-preview art).

## 6. Missing frontend / dead wiring (fresh)

- **IA-023 — `prototype-flow` section unreachable** (P2): registry
  predicate requires `ctx.prototypeMode`, no UI sets it (verified: no
  setter outside tests). Either wire a toggle or drop the section from the
  registry.
- **IA-024 — DocumentPanel raw number inputs** (P2): 8 `type="number"`
  inputs in `DocumentPanel.tsx` (12 across `panels/*.tsx`) bypass the
  NumberField contract (no scrub, no math, no mixed, no aria spinbutton
  semantics).
- **IA-025 — No stories for editor-local inspector primitives** (P2):
  Storybook exists (`packages/ui/.storybook`, 44 stories, all in
  `@varve/ui`); `NumberField`, `FieldRow`/`InspectorFieldGroup`,
  `DisclosureSection`, `ContrastIndicator` have unit tests but zero stories.
- **IA-026 — SmartFilters add entry is single** (verified clean): one
  `Select` add entry ("Add Object Filter" / "Choose a filter…",
  `SmartFiltersSection.tsx:488-501`). No triple-entry clutter found in the
  current tree.
- **IA-027 — SegmentedControl duplication** (P2): `@varve/ui` exports
  `SegmentedControl` (with stories); the Inspector imports
  `controls/SegmentedControl.tsx` — verify divergence (height/style) and
  whether the editor copy should defer to the UI-kit one. Evidence: the two
  selected-state treatments (IA-012).

## 7. Accessibility (fresh)

- Targets: 0 failing (IA-005). Focus visible in all themes (token audit
  213/213; screenshots show focus rings in high-contrast).
- Keyboard: NumberField = APG spinbutton (verified source header + tests);
  disclosure triggers are native buttons with min-height 24.
- Gaps carried: focus-ring geometry untokenized (IA-018); screen-reader
  pass not performed in this environment (recorded honestly; carried).

## 8. Clutter inventory (what a user sees, per state)

| Element | Frequency of need | Duplicates | Progressive disclosure? | Merge candidate |
|---|---|---|---|---|
| Align & Distribute icon row (7 icons) | frequent | no | no (flat, fine) | no |
| Position & Size X/Y/W/H + rotation + constraints | constant | no | no | no |
| Corner Radius (own section for 4 inputs) | occasional | no | collapsed by default | could fold into Position & Size (Figma parity) — **deferred: changes IA, not styling** |
| Appearance (opacity/blend/visibility) | frequent | no | no | no |
| Fill rows (label-above) | frequent | no | collapsed summary exists | no |
| Paint Library / Palette | occasional | no | collapsed | no |
| Stroke | frequent | no | no | no |
| Object Filters | occasional | single add entry (IA-026) | collapsed | no |
| Layer Effects | occasional | no | collapsed | no |
| Insights / Cognitive load | occasional | no | collapsed | no |
| Image: metadata + transform + destructive chips | mixed | no | no sub-grouping (IA-016) | group into labelled subsections |

No unreachable-function clutter was found beyond IA-023; no element was
removed from reachability in this pass.

## 9. Finding → spec requirement map

| Finding | Spec requirement |
|---|---|
| IA-001, IA-007 | R1 unified property-grid contract |
| IA-002 | R2 single label typography source |
| IA-003, IA-020 | R3 icon-size steps |
| IA-004, IA-019 | R4 height tokens |
| IA-008 | R5 trailing-slot/right-edge contract |
| IA-010, IA-011, IA-012, IA-027 | R6 one segmented-control source + cell content rules |
| IA-018 | R7 focus-ring geometry tokens |
| IA-021 | R8 decouple inspector type size from viewport |
| IA-009, IA-013, IA-014, IA-015 | R9 bounded layout repairs |
| IA-022 | R10 enforcement gate extensions |
| IA-023, IA-024, IA-025 | R11 wiring/stories (bounded slices) |
