# Fill & Stroke inspector — competitor research and redesign record (2026-09-16)

Third pass over the Inspector Design tab, scoped to the two paint sections and
their popovers. Companion to the 2026-09-15 redesign research
(`inspector-design-tab-competitor-failures-2026-09-15.md`) and the 2026-09-16
follow-up (`inspector-design-tab-followup-2026-09-16.md`), which covered Fill
opacity scrubbing, direct stack reordering, and the per-fill blend chip. This
pass answers the remainder of the request: make Fill and Stroke
"more user friendly, appealing, well designed", decide when their items should
appear, hide, or compress with options expandable, and reduce clutter without
weakening function or accessibility.

Method:

1. **External research** across Figma, Sketch, Illustrator, Photoshop,
   Affinity, Penpot, Inkscape, and Canva — official docs, product blogs, forum
   threads, and user complaints (sources inline below).
2. **Source audit** of Varve's `FillSection.tsx`, `StrokeSection.tsx`,
   `InspectorColorPopover.tsx`, `GradientEditor.tsx`, the paint operations in
   `context.tsx`, and the painting path in `packages/editor/src/render/` and
   `crates/varve-engine`.
3. **Rendered review** on a real-world document (frame, drawn rectangle, live
   text, imported photograph) at 1440×900 with Playwright, measuring row
   geometry and capturing screenshots (`reports/inspector-review/paint-rows/`,
   local). The audit lives in `tests/e2e/inspector/design-tab-audit.spec.ts`
   under "Design tab paint rows (fill / stroke pass)".

## 1. What users complain about in competitor paint panels

### 1.1 Paint types and values hidden behind clicks

Figma UI3 moved frequent controls behind menus and produced sustained
pushback — "Stuff that used to take 1 click now takes 2–3. Crucial functions
are hidden."
([r/FigmaDesign](https://www.reddit.com/r/FigmaDesign/comments/1dq5lg8/ive_been_part_of_the_figma_ai_redesign_beta_test/)).
Illustrator is the anti-pattern for picker fragmentation: "there are a million
different color UIs and I never know which one will pop up"
([r/AdobeIllustrator](https://www.reddit.com/r/AdobeIllustrator/comments/kzatfg/is_the_adobe_illustrator_color_picker_very/)).

**Decision.** Do not remove controls; move the *type choice* into a compact,
named trigger and give the row a value readout. The trigger's accessible name
and tooltip state the current type ("Fill type: Solid"), the menu keeps the
four types one click away with radio semantics and icons, and the swatch grows
into a pill that prints `#4A90E2`, `Gradient`, `Image`, `Pattern`, or `Mixed`.
Scanning a fill no longer requires opening a dialog.

### 1.2 "Mixed" selections that impersonate one layer

Figma's `figma.mixed` is first-class precisely because silently showing the
first layer's value invites accidental broadcasts. Varve's pre-redesign row
rendered the first selected node's fill swatch with no mixed indication.

**Decision.** A mixed selection is named on the row (`Mixed` in the value
pill), in the swatch's accessible name ("Fill colour (mixed across selection —
editing applies to all)"), and the type trigger switches to a dashed-circle
icon. Editing still broadcasts deliberately; the row just stops lying about
what is shared.

### 1.3 Paint editing on layers that cannot paint

Groups composite children; the engine IR has no fill for group nodes, and the
line/arrow primitives are stroke-only. Varve's Fill section nevertheless
rendered "No fill" and "Add fill" for those nodes, writing `fills` state that
no renderer reads — invisible document junk. The same class of bug as
Illustrator's accumulated zero-width strokes and Figma's invisible-fill
cleanup plugins
([Figma Community zero-stroke remover](https://www.figma.com/community/plugin/1528019144517058510/remove-zero-strokes)).

**Decision.** `canPaintFills()` (scene) gates both the rendered section and
the registry availability, and every paint operation skips non-paintable nodes
so mixed selections stop accumulating dead state. Group selections lose the
section entirely; frame/text/shape selections keep it, and the first two still
work in multi-selection with groups.

### 1.4 Dash entry as a syntax test

Affinity's four unlabeled dash fields generate recurring threads: "Why is the
width and length of dashes/dots defined solely relative to stroke thickness?"
([Affinity forum](https://forum.affinity.serif.com/index.php?/topic/151614-setting-dashdot-size-in-stroke-panel/)).
Illustrator users asked for years for a dashed-line shape option that was
removed
([r/photoshop](https://www.reddit.com/r/photoshop/comments/1s7vl4y/why_cant_i_make_a_dashed_line_using_shape_tool/)).
Varve had a single comma-separated text field with silent rejection.

**Decision.** Dash becomes a preset list — Solid, Dashed, Dotted, Dash-dot —
in absolute canvas units, with the exact pattern field kept under **Custom**.
Malformed input still reverts to the previous pattern; presets remain the
one-click path.

### 1.5 Hidden stroke state that looks like defaults

The 2026-09-16 follow-up already noted that hidden controls must come with a
visible summary. For strokes this matters most: a dashed or arrowed stroke can
sit collapsed behind "Advanced" and read as plain.

**Decision.** The Advanced toggle carries a live summary of every non-default
setting ("Advanced · Dashed · Per-side"), so collapsing never hides the fact
that a stroke is customized. Zero-width strokes are flagged in place
("Zero width — this stroke is invisible on the canvas"), the failure mode
Figma users clean up with plugins.

### 1.6 Contextual controls that only apply sometimes

Miter limit is meaningless without a miter join; dash offset is meaningless on
a solid stroke; per-side widths only exist for rects and frames; arrowheads
only for lines and open paths. Showing them as disabled rows is the
"why is everything greyed out" complaint
([Figma forum](https://forum.figma.com/archive-21/why-are-align-options-disabled-when-frame-is-on-auto-layout-22734)).

**Decision.** Each control renders only when its precondition holds, and
returns the moment it applies: miter limit under miter joins, dash offset
under any dash style except solid, arrowheads for line/path selections,
per-side widths behind a switch that initializes from the current weight and
offers **Use one width** to clear the quadrille. Nothing is permanently
inert, and every command keeps a reachable route.

### 1.7 Precision and stroke memory

Illustrator users complain the tool "keeps changing to 1pt black on an object
when attempting to update fill color... I would like Illustrator to leave my
color and pt settings as I had them"
([Adobe UserVoice](https://illustrator.uservoice.com/forums/333657-illustrator-desktop-feature-requests/category/410598-strokes)).
Adding a second stroke in Varve reset to the 1px black default.

**Decision.** "Add Stroke" copies the layer's last stroke (colour, width,
dash, caps) with a fresh id and visible=true. Numeric precision is preserved
everywhere: custom dash patterns, miter limit, dash offset, per-side widths,
and the gradient rotation field.

### 1.8 Gradient angle

Numeric gradient angle is one of the most requested gradient controls in
Figma ("I can't see where I can enter those values by exact numbers, e.g. an
angle of 30 deg",
[Figma forum](https://forum.figma.com/ask-the-community-7/how-can-i-rotate-gradient-without-using-the-handles-29364)).
Varve had the field, but inside the collapsed "Gradient options" disclosure.

**Decision.** Linear and angular gradients surface **Rotation** inline as the
inspector NumberField (scrub, step keys, Enter commit, unit in the accessible
name). Radial and diamond omit it because the value does not apply.

### 1.9 Per-fill blend modes with no one-click route

The 2026-09-16 follow-up deliberately surfaced the per-fill blend chip only
for stacked, mixed, or non-normal fills, to stop duplicating the layer-level
Appearance row. The consequence: a single normal fill — the case where the
user has not yet diverged — could only reach blend through the row menu's
submenu, two interactions behind an unlabeled discoverability step. Sketch and
the Photoshop paint popover both keep the paint's compositing next to its
colour instead.

**Decision.** The fill colour/gradient popover owns a labelled **Blend mode**
row (same option groups as Appearance) under the picker, so the control is
one click from the swatch in exactly the state where the row chip is hidden.
For image and pattern paints, whose previews are not colour editors, the row
keeps a compact Blend mode chip even when the value is Normal. The chip
(non-normal/mixed/stacked, plus image/pattern Normal) and the row menu submenu
stay as the parities for every other state; all three write the same field.

### 1.10 Compact numeric controls must fit their values

The first rendered pass exposed a basic sizing defect: `NumberField` calculated
a compact width in `ch`, but the input used content-box sizing. Its horizontal
padding was therefore added outside the calculated width, clipping values or
the unit in narrow paint rows.

**Decision.** Compact numeric inputs use `box-sizing: border-box`; the width
contract includes padding and leaves the unit visible. This is validated at
the shared control boundary rather than by widening individual inspector rows.

## 2. Accessibility and interaction constraints honored

- The type trigger keeps a 24×24 target (`insp-inline-btn`), a tooltip naming
  the current type, `aria-haspopup="menu"`, `aria-expanded`, and radio menu
  items — no icon-only unlabelled affordance.
- The value pill is a single button whose accessible name includes the mixed
  caveat; the swatch face remains 24px with a 3:1 border.
- Mixed state is conveyed by the literal word "Mixed" plus the accessible
  name, never by colour alone.
- Per-side widths use labelled NumberFields (Top/Right/Bottom/Left, compact
  T/R/B/L visual labels) inside a real `fieldset`, matching the corner-radius
  quad.
- The Advanced summary is part of the disclosure button itself, so screen
  readers hear the non-default state with the toggle.
- Reducing clutter removed no command: Remove stays in the row menu when the
  direct button is absent (disabled with a "last fill" badge for a single
  fill, because the paint model keeps one fill per node), and the stroke row
  menu keeps move/remove for single strokes.

## 3. Deliberately unchanged

- No drag-and-drop fill reorder: direct keyboard-accessible up/down controls
  remain the primitive (the research repeatedly flags drag-only reordering as
  an accessibility failure).
- Stroke rows still do not expose opacity/blend: the `Stroke` model has no
  such fields, and inventing them silently would change document semantics.
- The shared colour dialog remains modal (`role="dialog"`, focus trap, focus
  return); this pass only added the value pill and the inline gradient angle.
- The paint stack remains index 0 at the bottom; the value text and row labels
  ("Fill", "Fill 2") keep describing the model rather than reversing it.
- Fill and stroke styles stay per-instance; paint styles/libraries remain a
  separate feature (Paint Library).

## 4. Sources

- Figma UI3 backlash:
  <https://www.reddit.com/r/FigmaDesign/comments/1dq5lg8/ive_been_part_of_the_figma_ai_redesign_beta_test/>
- Figma disabled align controls:
  <https://forum.figma.com/archive-21/why-are-align-options-disabled-when-frame-is-on-auto-layout-22734>
- Figma gradient angle request:
  <https://forum.figma.com/ask-the-community-7/how-can-i-rotate-gradient-without-using-the-handles-29364>
- Figma picker fragmentation and recent colours:
  <https://forum.figma.com/suggest-a-feature-11/color-picker-improvement-26950>
- Figma invisible zero-width strokes plugin:
  <https://www.figma.com/community/plugin/1528019144517058510/remove-zero-strokes>
- Illustrator picker fragmentation:
  <https://www.reddit.com/r/AdobeIllustrator/comments/kzatfg/is_the_adobe_illustrator_color_picker_very/>
- Illustrator stroke-style memory:
  <https://illustrator.uservoice.com/forums/333657-illustrator-desktop-feature-requests/category/410598-strokes>
- Affinity dash fields:
  <https://forum.affinity.serif.com/index.php?/topic/151614-setting-dashdot-size-in-stroke-panel/>
- Penpot stroke contract:
  <https://help.penpot.app/user-guide/designing/color-stroke/>
- Penpot "three stroke problem":
  <https://penpot.app/blog/the-three-stroke-problem/>
- Inkscape fill/stroke dialog size:
  <https://lists.inkscape.org/hyperkitty/list/inkscape-devel@lists.inkscape.org/message/4L6XUUKR67YFYYZWUQMZBRSFALGYLZGO/>
- WCAG 2.2 non-text contrast:
  <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>
