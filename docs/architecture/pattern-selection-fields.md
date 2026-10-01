# Pattern placement fields across a selection

This contract covers the Pattern Fill controls when several selected objects
use the same pattern source. The broader definition, repeat, persistence, and
export model is documented in [fill-system.md](./fill-system.md).

## Eligible selections

The inspector edits one fill slot across the current selection only when every
selected object has a pattern in that slot and the sources match. A mixed paint
type hides pattern controls. Different source definitions or inline tile/recipe
sources show an explanation instead of presenting the first object's source as
though it belonged to the whole selection. Shared Paint references continue to
require the explicit detach or shared-paint workflow.

## Mixed-value behavior

Numeric placement fields report `Mixed` when their effective values differ.
Effective values include definition defaults for linked fills, such as the
definition cell size and repeat origin. A number typed into a mixed field is an
absolute batch edit: it sets only that field to the entered value on every
eligible selected fill. Arrow, wheel, and label-scrub gestures are relative:
they apply the same delta to each fill's own starting value. This lets a user
keep a useful difference between two placements while adjusting them together.

The rule applies to tile width and height, rotation, phase, gaps, and row or
column offsets. Choosing a repeat arrangement or mirror state is an absolute
edit for that named setting. For an eligible selection, the preview identifies
when it shows the first selected fill. The user can inspect each fill
separately by selecting it alone.

## Preservation and limits

Every edit patches the named pattern fields into each selected fill. It keeps
other per-fill placement values intact, even when the fills started with
different sizes, phases, or rotations. Linked source definitions remain shared;
placement changes stay on the fill instances. A batch source edit is offered
only for a common source. Detaching a linked definition remains a one-fill
action so different selected sources cannot be replaced with the first fill's
source.

Non-finite values are rejected. Tile dimensions have a minimum of one logical
pixel, and row/column offsets are clamped to the inspector's `-8` to `8`
range. Dragging or stepping applies a delta against each fill's resolved
current value. The editor groups each committed interaction into its normal
fill-history operation.

The focused acceptance test is
[`FillSection.test.tsx`](../../packages/editor/src/components/Inspector/sections/__tests__/FillSection.test.tsx),
with numeric selection math in
[`patternSelectionFields.test.ts`](../../packages/editor/src/patterns/patternSelectionFields.test.ts)
and a browser interaction in
[`pattern-multiselect.spec.ts`](../../tests/e2e/canvas/pattern-multiselect.spec.ts).

## Browser validation

The Chromium workflow selects two real canvas objects, sets different phase
and rotation values on each, then verifies that the inspector reports both
fields as mixed. Typing an absolute phase makes both fills agree; stepping
rotation applies the same delta to each fill and keeps the values mixed. The
captured [multi-selection inspector view](../screenshots/pattern-system-2026-09-30/app-multiselect-placement.png)
shows the two selected panels, their repeated fill, and the mixed state at
100% canvas zoom. This is browser evidence; native desktop and touch-device
validation were not performed.
