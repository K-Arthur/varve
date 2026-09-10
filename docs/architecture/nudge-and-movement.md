# Nudge and Movement Contract

This document is the current-state contract for keyboard nudging and pointer
movement. The implementation is split between the canvas input pipeline,
`ToolManager`, `CanvasNudgeController`, `SelectTool`, and the shared planner in
`scene/selectionArrangement.ts`.

## Input ownership

Arrow input is owned by the nearest meaningful editor context:

| Context | Owner | Result |
|---|---|---|
| Input, `contenteditable`, IME composition, dialog, menu, slider, or combobox | Native/widget owner | Arrow navigation or caret movement; the canvas does not move objects. |
| Layers tree, listbox, timeline, gradient stop, guide, crop, or vector-anchor editor | Focused composite/editor owner | Its documented navigation/editing behavior. |
| Active specialized tool with an unfinished Arrow-driven edit | Specialized tool | The tool consumes the event. |
| Canvas focus with an idle tool and an eligible selection | `CanvasNudgeController` fallback | The selected movement roots move in world/document axes. |
| Canvas focus with no eligible selection | Canvas/tool | No document mutation; the existing focus and viewport behavior remain intact. |

The active tool receives first refusal. An idle Frame, Rectangle, Text, Pen,
Image, Hand, or other tool therefore does not disable object nudging when the
canvas owns focus. There is no unconditional window-level Arrow listener.
`keydown` and `keyup` are kept together by the tool manager; blur, visibility
loss, tool changes, and focus loss finish the gesture exactly once.

## Amounts and coordinates

The local Settings > Nudging & Movement section exposes:

- small nudge, default `1` canonical document unit;
- big nudge, default `10` canonical document units, used by `Shift+Arrow`;
- finite positive values from `0.01` through `10,000` canonical units;
- display conversion through General unit preferences (`px`, `pt`, `mm`, `cm`,
  and `in`), with local persistence, corrupt-value recovery, and reset.

The stored values are preferences, not document state or history. Movement is
world/document-axis movement: camera zoom, camera rotation, device-pixel ratio,
monitor scale, and the selected object's rotation do not alter the requested
delta. The shared planner converts the same world delta into each direct
parent's local coordinate system and changes only translation components.

## Hierarchy and eligibility

The planner resolves independent transform roots before calculating positions.
If a selection contains both a parent and a descendant, only the parent moves;
children travel through the hierarchy without being rewritten. It also skips
missing, invalid, locked/hidden, inherited locked/hidden, adjustment-only, and
flow-managed roots. Absolute-positioned children remain eligible. Mixed
selections move eligible roots and leave ineligible roots unchanged; an entirely
ineligible selection produces no document write or history entry.

Keyboard nudges never reparent. Pointer drags use the same roots and captured
world origins, then retain the established drag-only reparent/reorder behavior.
Flow-managed children can be reordered inside their existing layout parent but
are not translated into another parent by an ordinary drag.

## Pointer intent

Pointer movement is based on a CSS-pixel activation threshold, so zoom does not
make a hand tremor larger or smaller. No movement transaction begins until that
threshold is crossed. A visible sample is one batched position mutation and a
completed drag remains one undoable gesture.

The modifier contract is deliberately explicit:

- `Shift` locks the drag axis using the existing interaction-session policy;
- `Alt/Option` duplicates once and moves the clones;
- `Ctrl/Cmd` bypasses snapping;
- `Ctrl/Cmd+Shift` preserves the current parent while retaining axis lock;
- keyboard Arrow movement does not use pointer snapping or any reparent intent.

Snapping and preserve-parent are separate fields in `InteractionSnapshot`, so a
future UI can expose them independently without changing movement geometry.

## Transactions and feedback

A held Arrow gesture announces once, reuses its repeat session, and commits on
the final keyup. Escape commits the in-progress keyboard movement to preserve
the user's visible intent. Blur, visibility loss, tool switch, and canvas focus
loss also finish the gesture. Pointer cancellation aborts the active drag and
clears its transient state.

The nudge settings use labelled fields with inline validation and an explicit
reset action. Existing selection announcements and Inspector/Layers updates
remain the source of visible document feedback; repeated key events do not
produce one toast or announcement per repeat.

## Source research and Varve decisions

Directly confirmed in the official product documentation:

- [Figma's alignment and position guide](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)
  documents small Arrow nudges and larger `Shift+Arrow` nudges.
- [Figma's nudge settings guide](https://help.figma.com/hc/en-us/articles/4404575206295-Set-small-and-big-nudge-values)
  documents configurable small and big amounts with defaults of 1 and 10
  resolution-independent points.
- [Sketch's moving-layers guide](https://www.sketch.com/docs/designing/layer-basics/moving-layers/)
  distinguishes moving layers from changing their hierarchy, and
  [Sketch's frame guide](https://www.sketch.com/docs/designing/frames/)
  documents Arrow movement without changing a layer's parent.
- [Figma auto layout](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-Auto-Layout)
  distinguishes flow-managed positioning from independently positioned layers.

The following are implementation inferences rather than claims made by those
sources: preserving one rigid world delta across transformed parents, using one
undo transaction for held-key repeat, and keeping active-tool-first routing are
the choices that best fit Varve's existing scene and input architecture.

Varve-specific choices are the canonical document-unit storage, the removal of
the unreachable fine-nudge mode, no keyboard reparenting, the shared planner
between keyboard and pointer movement, and the Ctrl/Cmd modifier split above.

## Validation ownership

The focused contract tests live in:

- `commands/nudge.test.ts` and `settings.test.ts` for amounts and persistence;
- `scene/selectionArrangement.test.ts` for roots and transformed-parent plans;
- `tools/__tests__/ToolManager.test.ts` and
  `tools/__tests__/InteractionContext.test.ts` for routing and intent;
- `components/Settings/SettingsDialog.test.tsx` for settings validation;
- `tests/e2e/canvas/nudge.spec.ts` for real canvas focus, active-tool routing,
  movement, transactions, and authoritative redraw behavior.
