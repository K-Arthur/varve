# Inspector Design tab — follow-up review and de-cluttering (2026-09-16)

Companion to `docs/research/inspector-design-tab-review-2026-09-15.md`. This
record covers the second pass over the same seven Design-tab surfaces
(Align & Distribute, Position & Size, Corner Radius, Image Placement,
Crop & Bounds, Mask, Selection Colors) after the 2026-09-15 rewrite shipped.
The 2026-09-15 pass reorganized the panel; this pass fixes the regressions the
rendered review exposed and removes the remaining duplicate controls.

Method: rendered measurement on a real-world document (frame, drawn
rectangle, live text layer, two imported real photographs from
`tests/e2e/fixtures/`) at 1440x900 with a 2x device scale factor, plus
source-checked competitor research. Screenshots and JSON metrics:
`reports/inspector-review/<run>/` (local, git-ignored).

## 1. Regressions found by rendering the shipped panel

### 1.1 A section-scale token used as control padding

`--space-15` is a fluid **section** rhythm token
(`clamp(12rem, 10.5rem + 5vw, 16rem)` in `packages/ui/src/tokens/tokens.css`),
not a 1.5x control step. The 2026-09-15 rewrite used it as `padding-inline`
in three places:

| Site | Rendered result |
|---|---|
| `.insp-align-targets .pill-group__btn` | **523px-wide** "Selection" chip at 1440x900 (240px inline padding), overflowing a 319px panel |
| `.insp-align-section__target-badge` | full-width badge text |
| `.insp-mask-actions .insp-btn-sm` | **240px inline padding** on every mask action button |

Measured `scrollWidth` for `.insp-align-bar` was **1561px inside 292px**
before the fix and 0 overflow after. This is the class of bug stylesheet
reading cannot catch — only rendering exposed it.

### 1.2 The dead second toolbar

For a single selection the Align & Distribute section rendered the full
15-control apparatus: 6 align buttons, 2 distribute buttons, Gap, key object,
three reference targets, tidy grid and OBB. Every command that needs two or
more layers was disabled. Competitor research documents why this pattern
fails:

- Figma's UI3 moved/hid alignment and users reported losing muscle memory and
  one-click access ("Stuff that used to take 1 click now takes 2–3. Crucial
  functions are hidden." —
  <https://www.reddit.com/r/FigmaDesign/comments/1dq5lg8/ive_been_part_of_the_figma_ai_redesign_beta_test/>).
- Figma also *hides* align controls in some modes rather than disabling them,
  producing "why is everything greyed out" threads
  (<https://forum.figma.com/archive-21/why-are-align-options-disabled-when-frame-is-on-auto-layout-22734>).
- Illustrator's key-object reference is a common source of confusion because
  the target mode is implicit until a popover is opened.

The design rule adopted: **never render a permanently inert cluster, and
never hide a command that has no other route.** Single selections keep the six
align buttons live by resolving the reference to the nearest frame or the page
(the only meaningful targets for one object), and the relative-only clusters
(distribute, gap, key object, tidy, OBB) are omitted from the rendered toolbar.
Every omitted command is still reachable — align, distribute and tidy have
Menubar entries and keyboard shortcuts; key object and OBB remain in the
toolbar whenever two or more layers are selected. An `sr-only` note states the
availability rule in the accessibility tree, so assistive-technology users are
not left guessing why controls are absent.

A first attempt also removed the *reference* options themselves when they were
unavailable (no "Selection" with one layer, no "Frame" without a containing
frame). Rendered review rejected that: reviewers read the missing chips as
missing functionality ("where is align to selection / align to frame?"), and
more importantly the align buttons then silently meant something different
after a selection change with nothing on screen naming the target. Final
rule, applied in both code and tests:

- **All three references stay visible at all times** — `Selection`, `Frame`,
  `Page` — with unavailable options carrying `aria-disabled`, a non-activating
  click guard, reduced opacity, and a hover/`title` reason ("Select two or more
  layers to align to the selection bounds", "This selection has no shared
  containing frame"). `aria-disabled` rather than `disabled` keeps the option
  in the accessibility tree and focus order so the reason is discoverable.
- **Every align command names its live target in its accessible name and
  tooltip** — "Align left edges to page" / "…to parent frame" / "…to
  selection" — so the command can never silently change meaning. This follows
  the same principle as the earlier finding that Figma's greyed-out alignment
  without explanation generated a recurring complaint thread.

### 1.3 The 2x2 corner grid never rendered as a grid

`.insp-quad-grid` declared `display: grid` with two columns, but
`.insp-panel fieldset` (0,1,1 specificity) forces `display: flex` for stacked
fieldsets, and the single-class `.insp-quad-grid` (0,1,0) lost. Rendered
measurement showed computed `display: flex` and four full-width rows — the
exact single-column "dials on a stove" layout Sketch's Corners redesign
explicitly moved away from, and which users reported as error-prone
(<https://www.sketch.com/blog/behind-the-scenes-corners/>: "we didn't want to
arrange them in a single row, like dials on a stove — because sometimes you
turn the wrong knob"). Fixed by scoping
`.insp-panel fieldset.insp-quad-grid`, plus long-form accessible names
("Top left (px)") with compact visible labels (TL).

### 1.4 A missing icon rendered as an empty span

The mask invert button asked for `<Icon name="FlipHorizontal">`; the installed
Lucide set has `FlipHorizontal2`, so the button painted an empty `<span>` and
logged a console warning. Replaced with `Contrast`, and every other icon added
in this pass was verified against `lucide-react`'s export before use.

## 2. Duplicate controls removed

### 2.1 Per-fill blend mode vs layer blend mode

The Fill section rendered a full-width **Blend mode** dropdown under every
expanded fill, while Appearance rendered a **Blend mode** dropdown for the
layer. Two identically-named rows a few pixels apart is the Photoshop
"layer vs fill blending options" problem, where the fill-level control is
hidden inside Layer Style > Blending Options specifically to avoid the
collision. Varve now keeps the layer-level row visible and surfaces the
per-fill override only when it differs from Normal: a compact chip
("Multiply") that opens the full radio list; the same list is available as a
submenu in the fill row's `…` menu. No capability is removed — the default
view simply stops repeating itself.

### 2.2 Selection Colors on a one-colour object

Figma's own Selection Colors retrospective documents the open question — "you
have just one object with the same Fill and Stroke — should SC show up, or
would it be too much?" — and the answer they shipped was to suppress the
redundant list (<https://aresluna.org/designing-selection-colors/>). Varve's
section duplicated the Fills row verbatim for a single object with one paint
and offered a "select matching layers" action that could only re-select the
same node. The section is now suppressed for exactly that case, and shown when
there are two or more colours, multiple layers, gradient stops, non-colour
paints, or text ranges. The row itself gained a copy-hex action and a use
count that appears only when a colour is shared.

### 2.3 Image placement rows that cannot do anything

Stretch pins the image to the shape; offset and scale are inert. The section
previously showed both, disabled. They are now omitted for Stretch with a
one-line reason ("Stretch ignores offset and scale.") and reappear for every
other fit mode. Research basis: Figma users report crop/placement handles that
"only show on hover" and only in Crop mode as an ongoing discoverability
failure
(<https://forum.figma.com/ask-the-community-7/lost-the-ability-to-resize-images-that-are-filling-shapes-43243>);
the lesson taken is that hidden controls must come with a visible trigger or
explanation, not silently vanish.

### 2.4 Mask "button soup"

Five same-weight text buttons (On, Invert, Hide, Link, Remove) sat beside a
`Type: Clip` label. Mask semantics are already a documented confusion source
("thats a horrible UX. i hope they fix it, i had to search how to undo a mask
its not near intuitive" —
<https://forum.figma.com/archive-21/which-is-the-name-of-the-command-to-undo-a-mask-in-figma-28378>),
so the card was rebuilt around labelled controls instead of icon guessing:
Type and Source become labelled rows, Hide source and Link transform become
switches with explicit accessible names, invert is a `Contrast` toggle, and
Remove is a danger icon button. The collapsed section header now carries the
active mask type so an enabled mask cannot be invisible.

## 3. Arrangement and rhythm

- Align & Distribute, Position & Size and Mask cards use one control grammar:
  a 38% label spine, 24px minimum targets, `--space-*` control tokens, and the
  same sunken-track segmented control for short enumerations.
- The rotation row keeps R + flip H + flip V + the skew disclosure on one
  line; the skew disclosure previously wrapped alone onto its own row because
  the grid declared three columns for four children.
- Image Placement now follows Stroke in mixed multi-selections (it previously
  trailed Layer Effects and Selection Colors), while an all-image selection
  still leads with placement and crop via the contextual order in
  `sectionRegistry.ts`.
- The five image-fit modes occupy one equal-width track; the generic
  `auto-fit minmax(4.5rem)` grid had wrapped them into 3+2.

## 4. What was deliberately not changed

- Rotation, flips and the proportion lock stay visible: the UI3 backlash is
  specifically about burying frequent transform controls. Skew stays behind a
  disclosure but auto-surfaces whenever a layer actually carries skew.
- No command was removed. Distribute/gap/tidy keep Menubar and keyboard
  routes; key object and OBB are rendered whenever their prerequisites hold.
  Alignment *references* are never removed at all — only marked unavailable
  (see §1.2), because the reference is the mode the buttons operate in.
- Selection Colors keeps its full editor popover, its "select matching
  layers" action and its expand-more pagination.
- Crop & Bounds keeps all five aspect presets plus its Trim/Protect/Expand
  subsections; only the preset row's wrapping changed.

## 5. Fill Section: Opacity, Reordering, and Blend Modes

### 5.1 The unscrubbable opacity trap
In previous iterations, the Fill row used `hideLabel: true` on its opacity `NumberField`.
In `NumberField.tsx`, when `hideLabel` is enabled, the `<label>` is given class
`varve-visually-hidden`, and pointer events are stripped (`onPointerDown={disabled || hideLabel ? undefined : handleLabelPointerDown}`).
This led to two major user complaints commonly heard in design tools:
1. "I can't tell what this 100% number box does without hovering or typing."
2. "Dragging to scrub opacity doesn't work on the fill row."

**Solution:** Replace `hideLabel` with `displayLabel="Op"`. The visible label displays a compact
"Op" prefix with `cursor: ew-resize`, activating horizontal scrub gestures. The underlying
accessible name remains `Fill opacity (%)`, ensuring zero regression for screen readers
and automated test assertions (`findByLabelText('Fill opacity (%)')`).

### 5.2 Multi-fill reordering without drag drop misplacement
In tools like Figma and Sketch, reordering fills requires dragging tiny 24px rows. Users
frequently complain about misplacement, jerky drop indicators, and accessibility failure
("reordering small inspector rows with a mouse is error prone and impossible with a keyboard").
In Varve, reordering had previously been buried under `... > Move fill up` / `Move fill down`,
requiring 6+ clicks across menu open/close cycles to reorder a 3-layer fill stack.

**Solution:** When `totalFills > 1`, render accessible direct reorder buttons (`ChevronUp` /
`ChevronDown`) directly within the paint row. They feature boundary disabled states (top cannot
move up, bottom cannot move down) and announce reordering actions (`Fill reordered`) to screen
readers. When `totalFills === 1`, the reorder buttons are omitted, keeping the single-fill row
clean and uncluttered.

### 5.3 Surfacing blend modes when multiple fills interact
When an object has a single fill, layer-level blend mode governs its appearance. However, when
a designer adds a secondary fill (e.g. gradient overlay or texture pattern), adjusting the blend
mode of each fill layer is essential. Previously, the blend chip was only rendered when non-normal
or mixed (`blendIsMixed || blendValue !== 'normal'`). A user adding a new fill layer was met with
no visible blend mode control at all unless they discovered it buried in `... > Submenu > 19 items`.

**Solution:** Render the compact blend mode chip whenever `totalFills > 1 || blendIsMixed || blendValue !== 'normal'`.
In multi-fill stacks, each fill displays its blend mode chip (`Normal ▾`, `Multiply ▾`), opening the
blend mode menu in 1 click. When a single fill uses `normal`, the chip remains hidden to reduce clutter.

### 5.4 1-click removal in multi-fill stacks
When pruning multi-fill stacks, digging through `... > Remove fill` for every layer was tedious.
When `totalFills > 1`, a direct `X` icon button is provided beside the actions menu trigger.

## 6. Layout and Table Section De-cluttering

### 6.1 Layout: Grow/Shrink and Fluid Clamp Sizing
- **Flex Grow / Shrink:** Replaced raw unstyled HTML `<input className="insp-select">` with
  paired `<NumberField>` components inside `<InspectorFieldGroup columns={2}>`, saving a full row
  and restoring numeric scrubbing and keyboard step handling.
- **Min/Max Fluid Bounds:** Paired `[Min W] [Max W]` and `[Min H] [Max H]` into 2-column tracks.
  Replaced 4 full-width standalone "Clear" text buttons with compact conditional clear actions
  rendered only when bounds are set, eliminating 4 unnecessary vertical rows from the default view.

### 6.2 Table: Tabular Dimensions Pairing
In `TableSection.tsx`, 8 full-width single-value rows were paired into 4 two-column groups using
`<InspectorFieldGroup columns={2}>`:
1. `Header rows` + `Header columns`
2. `Frozen rows` + `Frozen columns`
3. `Row gap` + `Column gap`
4. `Border width` + `Corner radius`

This clusters related horizontal/vertical tabular dimensions together as standard desktop controls,
cutting vertical inspector height in half while preserving all labels and validation.

