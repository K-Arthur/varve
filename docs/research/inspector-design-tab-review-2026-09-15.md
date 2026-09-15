# Inspector Design tab — review, research, and repairs (2026-09-15)

Scope: the Inspector **Design tab** (`packages/editor/src/components/Inspector/`) —
every section and control a selected object renders there. This is a repair
record, not a full-product audit. Surfaces outside the Design tab (Adjustments,
Export, Fonts, Prototype, panels hosted elsewhere) were inventoried but not
changed.

Companion records:

- Ownership/handoff: `docs/agents/inspector-design-tab-2026-09-15-ownership.md`
- Rendered audit spec: `tests/e2e/inspector/design-tab-audit.spec.ts`
- Prior numeric-field work this review builds on:
  `docs/research/numeric-input-interaction-research-2026-09-14.md`

## 1. Method and baseline

Rendered measurement, not stylesheet reading: a Playwright run seeded a
real-world document (frame, drawn rectangle, live text layer, imported real
photograph `tests/e2e/fixtures/real-life-still-life.jpg`), expanded **every**
section for each selection kind, and measured geometry, type, targets,
overflow, and scroll behavior at 1440x900 (1x). Baseline artifact:
`test-results/<run>/…/design-tab-*-expanded.png`.

Baseline numbers (2026-09-15, before changes):

| Measurement | Value |
|---|---|
| Design sections, image selection | 21 (14 generic + 7 image-specific) |
| Design sections, text selection | 16 |
| Design sections, rectangle | 13 |
| Design sections, frame | 16 |
| Field label font size | **10.432px**, uppercase, `--font-size-2xs` |
| Numeric value font size | **12.48px**, `--font-size-xs`, tabular |
| Control height | 32px (`--component-compact-height`) |
| Panel scroll | `overflow-y: auto`, 3 156–5 706px content in a 665px rail |
| Row overflow | none (`scrollWidth > clientWidth` on no `.insp-field`) |
| Truncated labels (image selection) | `Image scale (x)`, `Effective resolution`, `Trim padding (px)`, `Expand padding (px)`, `Estimate quality` |
| Truncated labels (frame) | `Col start`, `Col end`, `Row start`, `Row end` |
| Sub-24px targets | hidden proportion-lock input (1×1); Adaptive Contrast / Light / Dark checkboxes (16×16 with a full-row wrapping label, so effective target passes) |

## 2. What comparable products get wrong (source-checked)

Research checked 2026-09-15. These are user-reported failures, used to choose
what to fix in Varve; they are not design law.

### 2.1 The panel shows the wrong thing for the current target

Photoshop's Properties panel repeatedly ships bugs where selecting a shape
shows mask density/feather instead of shape properties, and where
text-converted shapes show no fill/stroke at all (Adobe Community threads
2021, 2022, 2024, 2025; e.g.
<https://community.adobe.com/bugs/p-properties-panel-not-showing-shape-properties-anymore-old-bug-is-back>).
One 2024 report: a type layer's Properties panel shows only two expandable
sections and **no scrollbar** to reach the rest
(<https://community.adobe.com/t5/photoshop-ecosystem-bugs/properties-panel-for-a-type-layer-shows-only-two-property-sections-when-expanded>).

**Applied to Varve:** the availability layer is already registry-gated per
node kind, so "wrong controls" did not reproduce. The scroll complaint did not
reproduce either: every selection's expanded panel scrolls (`overflow-y: auto`,
verified). What *did* reproduce is the findability half — an image selection
listed its own controls **twelfth**, below Mask, Paint Library, Object Filters
and Layer Effects.

### 2.2 Scannability of dense property panels

Blender's own design task T54951 documents that its Properties Editor was
"hard to scan through" because controls were scattered across columns, and the
redesign moved to one column with right-aligned values and searchable
properties (<https://archive.blender.org/developer/maniphest/0054/0054951/index.html>).
A maintained inspector guide (Nubisco) states the principle Varve's panel
already follows — quiet labels, values are the loudest thing, one label spine,
one gap rhythm, and every labelled action must look like a button at rest
(<https://docs.nubisco.io/ui/patterns/inspectors.html>).

**Applied to Varve:** the panel already uses one label column (38%) and one
value spine. Two deviations remained: labels at 10.4px (below every reference
consulted: Nubisco utility 11px, Carbon caption 12px / productive base 14px,
Blender ~11–12px) and multi-line labels silently truncated to ellipses.

### 2.3 Numeric fields people actually complain about

Blender's drag-scrub drew years of complaints: unpredictable non-linear
acceleration so users could not map cursor travel to value
(<https://developer.blender.org/T37453>), and click-to-type versus drag
ambiguity so a "click to type" walked the value instead
(<https://blenderartists.org/t/new-changes-to-numeric-input-are-hard-to-use/598450>).
After Effects users likewise complain that scrubbing dies at the screen edge
(<https://www.reddit.com/r/AfterEffects/comments/hm0l84/click_and_drag_infinitely/>).

**Applied to Varve:** the existing NumberField already implements the fixes
these complaints point to — linear accumulate-from-baseline scrubbing, 2px
activation threshold so a click stays a click, modifier rebasing mid-gesture,
Escape cancel, one undo step per gesture, wheel only while focused. This
review verified those behaviors still hold in the real app (existing
`number-field-interaction.spec.ts` plus the new Design-tab spec) and did not
rework them. It did fix a **layout** defect that made edited values harder to
read: the `%` unit in range+number controls wrapped onto its own line below
the input.

### 2.4 Multi-selection "Mixed" presentation

Windows' property-inspector guidance: show the common properties, use the
control's mixed state where values differ
(<https://learn.microsoft.com/en-us/windows/win32/uxguide/win-property-win>).
A practitioner thread shows the failure mode to avoid — rendering mixed values
as an unchecked/empty control so users cannot tell "off" from "disagree"
(<https://ux.stackexchange.com/questions/53107/>).

**Applied to Varve:** the Inspector renders `Mixed` text with
`aria-valuetext="Mixed values"` rather than a fabricated zero for X/Y/W/H/R/
skew/opacity and paint fields (verified in the existing owner spec and in the
new multi-select audit assertions).

### 2.5 Controls that cannot be seen or reached

The brief's Section 6A qualification stands: hover-revealed secondary actions
must also exist on focus and touch. This review found a **conformance** defect
rather than a styling one: the Position & Size "Constrain proportions"
checkbox was a 0×0, `pointer-events: none`, `opacity: 0` input inside a label
whose `:focus-visible` rule could never match (labels are not focusable), so a
keyboard user tabbed to an invisible control with no focus indication (WCAG
2.4.7 Focus Visible, AA). The activation area was 22×22 (icon 14px + 4px
padding), under WCAG 2.2 SC 2.5.8's 24×24 minimum with no spacing exception
available between adjacent field controls.

### 2.6 Repo-policy violations found on inspection

`BooleanSection` (Pathfinder, Design tab for live Boolean groups) used a
native `<select>`, which AGENTS.md forbids, and bare buttons with inline
styles instead of the shared `@varve/ui` primitives.

## 3. Changes made

Progressive commits on `master` (see the ownership record for SHAs):

1. **Pathfinder controls** — operation is the shared `Select`; operand and
   action buttons are shared `Button`s with token-styled rows and focus rings.
   The existing unit test now opens the listbox and asserts the document
   operation changes, instead of asserting a native-select value.
2. **Constrain proportions** — stays a real checkbox (E2E specs depend on the
   checkbox role and `.insp-proportion-lock`), gains an accessible name on the
   input, a 24×24 activation area, and a visible focus ring painted on the
   label via `:has(input:focus-visible)`.
3. **Range+number unit** — `.insp-field__control` is a flex row so the unit
   sits beside the value; the input flexes instead of forcing 100% width.
4. **Contextual section order for images** — `resolveSectionOrder` now leads
   image selections with Image Placement (111) and Crop & Bounds (112).
   Resolution and Perspective deliberately stay in the advanced tail (read-out
   and rare operation). A user's saved order still wins. Matches the existing
   text-selection contract.
5. **Inspector type scale** — scoped tokens on `.editor-inspector`:
   labels 11→12px and values 12→13px, bounded with `clamp()` between 360px and
   1280px viewports, root-relative, with the previous sizes as fallbacks
   outside the Inspector's scope. Global type tokens are untouched.
6. **Long labels wrap instead of disappearing** — root cause found in the
   cascade: `.insp-field__label--wrap` (declared early in `inspector.css`) was
   silently overridden by the later, equal-specificity
   `.insp-field__label { white-space: nowrap; line-height: … }` in the
   "responsive field grammar" section, so the modifier had never actually
   enabled wrapping — it only ever changed `overflow-wrap`. The modifier is
   now declared as `.insp-field__label.insp-field__label--wrap` with
   `overflow-wrap: anywhere` (which, unlike `break-word`, shrinks the flex
   item's min-content width inside the 38% grid track). `labelWrap` is now
   used by Image Placement (Image scale), Crop & Bounds (Trim/Expand padding)
   and the layout grid placement rows (Col/Row start/end), and the previously
   inert wrap option in `FieldRow` starts working for its existing callers.
7. **Shared compact button primitive moved into the Inspector** — `.insp-btn`
   was defined only in the AdjustmentLayer stylesheet, which loads lazily, so
   twelve Inspector sections rendered button chrome that depended on session
   history; `--compact` matched no rule at all and measured 23.98px. The
   primitive now lives in `inspector.css` with a real compact modifier
   (`min-height: 24px`, border-box) and a focus-visible ring.
8. **Document empty state (Design tab with nothing selected)** — the
   type-scale increase newly clipped two labels ("Object geometry", "Pages and
   frames"); they now use the wrap modifier. Measured with and without the new
   tokens: at 10.43px they fit, at 12px they overflowed by 8/16px, so this was
   a real regression from the scale and is fixed at the source. The inline
   switch rows were already clipping at every size (`.insp-field__control--inline
   :where(label) { white-space: nowrap }`, measured 137px client vs 234px for
   "Enable magnetic pointer snapping"); they now wrap, which also unclips
   "Page and frame bounds" and "Ruler and layout guides".

## 4. Verification

- `tests/e2e/inspector/design-tab-audit.spec.ts` (new): real-world document;
  asserts scrollability, zero row overflow, label ≥11px, value ≥12px, ≥24×24
  effective targets, image-section ordering, a typed edit round-tripping
  through undo, and keyboard operability plus visible focus of the proportion
  lock. Screenshots per node kind in default and all-expanded states.
- `packages/editor/src/components/Inspector/PropertiesPanel.test.tsx` and
  `__tests__/sectionRegistry.test.ts` extended; direct unit suites green.
- Visual baselines for the Inspector snapshots were regenerated and reviewed
  (see the ownership record for the exact specs and paths).

## 5. Deliberate limits (not silently "fixed")

- **Undo anomaly observed, not claimed as diagnosed.** In the audit's first
  version, typing an X value on a rectangle and then choosing Edit → Undo
  made the *imported photo* the selected node and displayed that photo's X
  (repro: frame + drawn rect + live text + imported photo → select the
  Rectangle layer → type `75` into Position & Size X → Enter → Edit → Undo).
  The value round-trip itself is verified by the shipped test; the undo leg
  was removed because it needs the history/transaction owner to determine
  whether the typed edit merged with an open import transaction. Exact repro
  retained here and in the ownership record; the existing per-edit undo
  coverage in `tests/e2e/inspector/number-field-interaction.spec.ts` still
  passes.
- **One truncated label remains**: `Estimate quality` in
  `SelectionSourcesPanel.tsx` (measured: `white-space: nowrap`,
  `overflow-wrap: normal`, 50px column vs 115px text), which is another
  task's in-flight file
  (`docs/agents/ai-selection-routing-2026-09-15-ownership.md`). The audit spec
  keeps it as the single documented exception.
- **Cross-task failures observed during this review** (not caused by and not
  fixed in these changes): `tool-context.spec.ts` waits for an "iPhone 15 Pro"
  frame preset that the in-flight rewrite of `packages/shared/src/presetRegistry.ts`
  removed (HEAD still had it; 228+/21- in that file), and a concurrent edit to
  `ExportDialog.tsx` briefly left `nestedOverlayRef` undefined, which made
  Playwright's global warm-up time out twice before the app itself was
  confirmed to boot cleanly with zero page errors.
- **Caption text** elsewhere in sections still uses `--font-size-2xs`; only
  labels, values, and section headers moved. Widening the whole ramp is a
  design-system decision with broader snapshot impact.
- **The Insights/Audit block** at the bottom of every Design tab is
  document-level by design (per `PropertiesPanel.tsx`'s composition comment);
  it was left in place because removing it would contradict the documented
  composition contract.
- **Frame "Resize to Preset"** is collapsed by default (`order: 102`,
  `defaultExpanded: false`); the all-expanded audit makes it look dominant,
  which is an artifact of the audit, not the default experience.
- **Slider targets** (16px-tall native range inputs) are measured separately
  from click targets rather than asserted at 24px; a dedicated
  slider-target review is recorded as remaining work.
- Font size is not a WCAG criterion; the 11–12px label floor is an evidence-
  based legibility judgment (below every consulted reference), not a
  conformance claim. At 1440px the clamp maximum applies: labels 12px,
  values 13px.
- **Repaired controls not exercised in a browser in this pass**: the
  Pathfinder Select was verified by unit integration
  (`PropertiesPanel.test.tsx`) because the audit document has no Boolean
  group; the `labelWrap` fix is verified by the audit's truncation metrics
  (text/rectangle/frame clean; only the cross-task `Estimate quality`
  remains).
