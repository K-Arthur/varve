# Inspector paint-stack follow-up

**Date:** 2026-09-16
**Scope:** Appearance opacity, per-fill opacity, fill-stack ordering, and
fill-row action priority
**Branch:** `master`

## Evidence and research

The reported screenshots show two different layout grammars being used for
the same bounded opacity value:

- layer Appearance uses a labelled `NumberField` row and right-aligns its
  bounded value box;
- each Fill uses a nested property grid, whose opacity wrapper currently
  inherits a full-width control treatment even though the value has the same
  0–100% range.

That difference is not justified by the value family. The field height is
shared, but the value box and its containing track are not governed by one
width role.

The current Fill row also has keyboard move-up/move-down actions and a visible
remove icon, but no pointer/stylus drag affordance. The overflow menu repeats
some of those actions while also containing lower-frequency variable/harmony
commands.

Current product guidance supports the following decisions:

- [Figma Guide to fills](https://help.figma.com/hc/en-us/articles/360041003694-Guide-to-fills)
  keeps fill opacity visible beside the fill and supports drag reorder plus a
  direct remove action.
- [Adobe Illustrator Appearance attributes](https://helpx.adobe.com/illustrator/using/appearance-attributes.html)
  treats fills/strokes/effects as a stack: reorder by dragging, with menu and
  delete fallbacks.
- [Figma blend modes](https://help.figma.com/hc/en-us/articles/360040667874-Apply-blend-modes-to-layers-fills-and-effects)
  keeps per-fill blend mode in the fill editor rather than making every row a
  second full appearance panel.
- [WAI-ARIA spinbutton](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/)
  supports one labelled value control; the input should not gain extra tab
  stops just because it is nested in a paint row.

## Decision

1. Give bounded numeric values one intrinsic width role. Appearance opacity
   and per-fill opacity use the same compact value width, height, unit spacing,
   and right edge. The Fill property grid uses a flexible Fill-type column and
   an intrinsic Opacity column rather than two equal-width tracks.
2. Keep visible in the normal Fill row: visibility, paint preview/value, Fill
   type, and Opacity. These are the common state and editing path.
3. Add a visible drag handle for fill order. Pointer and stylus movement use
   pointer capture and one undo transaction; Arrow Up/Down remains the
   keyboard fallback. Escape/cancel aborts the gesture.
4. Put low-frequency commands in the row menu: per-fill blend mode when it is
   not already open in the colour editor, variable binding, colour harmony,
   duplicate if available, and removal. Remove the redundant always-visible X
   so the row has one action policy. A non-normal/mixed blend state remains
   discoverable through the menu label/badge and colour editor.
5. Preserve the current “at least one fill” invariant. The menu explains why
   removal is disabled instead of silently doing nothing.

## Acceptance criteria

- Appearance opacity and Fill opacity input boxes have equal computed height
  and equal intrinsic value width at 240, 320, 480, and 640px Inspector rails.
- Fill type may use remaining width, but opacity does not stretch to consume
  it and does not collapse below the compact target.
- Two or more fills can be reordered with pointer/mouse and stylus-compatible
  pointer events; the operation commits as one undo step.
- Arrow Up/Down and the overflow menu provide equivalent reorder access.
- Escape/cancel does not leave a partially reordered stack.
- Remove is reachable from the overflow menu, is destructive-labelled, and is
  disabled with an explanation for the final required fill.
- Normal and non-normal per-fill blend modes remain reachable for solid,
  gradient, image, and pattern fills.
- No row overflow or label clipping occurs at the supported Inspector widths.
- Real-editor E2E covers adding two fills, reordering, removing, changing
  opacity, and undoing the reorder/removal.

## Implementation evidence — 2026-09-16

The first implementation slice is now applied to fills, strokes, and effects.
The per-fill opacity field uses the same bounded `NumberField` width role as
Appearance opacity; its visible `Opacity (%)` label remains the canonical
scrub target rather than a decorative duplicate. The Fill-type column is
flexible and the opacity column is an intrinsic `8ch` rail, which avoids the
old nested-field stretch and the narrow-select collapse.

Paint stacks use the existing shared `@varve/ui` sortable primitive. Fills,
strokes, and effects expose one labelled drag handle only when there is more
than one row. Menu move-up/move-down and destructive removal remain available
as explicit keyboard-friendly commands. Effect drag reorder respects the
scene renderer's backdrop/content/appearance stage boundaries.

During validation, the shared primitive exposed a real keyboard defect: its
vertical `pointerWithin` collision strategy returned no destination for the
keyboard sensor because keyboard events do not provide pointer coordinates.
The primitive now uses `pointerWithin` when coordinates exist and falls back
to `closestCenter` otherwise. This is covered by a unit test and a real
browser Space/ArrowUp/Space Fill workflow.

Measured Chromium evidence:

- Appearance and per-fill opacity inputs: 39px × 32px each at the default
  1440px viewport, with a 1px fractional trailing-edge difference caused by
  the separate outer disclosure rail.
- Inspector rails tested: 240, 320, 480, and 640px; no row horizontal
  overflow, no compact value below the tested target, and Fill-type width
  stayed above its documented narrow-rail threshold.
- Interaction workflow: 2/2 Playwright scenarios passed, including pointer
  drag, keyboard drag, menu reorder, and overflow removal. The focused
  component set passed 115/115 tests.

One concurrent, uncommitted Design-tab E2E file still asserts the superseded
visible `.insp-paint-blend-select` row control. That test is intentionally not
rewritten here because its file is owned by another Inspector pass; the
ownership record identifies the required reconciliation before a full audit
gate.

## Validation handoff

- Final real-editor run: `fill-surface-followup.spec.ts`, Chromium, 2/2 passed
  in 51.8s. The run captured the geometry and stack screenshots under
  `test-results/run-4175085-1545/`.
- Focused component run: 7 files, 115/115 tests passed.
- E2E typecheck and `git diff --check` passed.
- The escalated repository gate reached the architecture audit and then
  stopped at an unrelated concurrent engine type error in
  `packages/engine/src/lut/lut-edge.test.ts` and `lut.test.ts`: those tests
  still read `.size` from the `LutTransform` union after the current engine
  change removed that common property. No Inspector or sortable file was
  reported as the cause.
