# Inspector feature ownership

The Design tab is the contextual Properties surface; it is not a default
container for new editor features. Every section registered in
`components/Inspector/sectionRegistry.ts` must also have an exhaustive entry in
`components/Inspector/featureOwnership.ts`. The ownership contract is checked
by `featureOwnership.test.ts`; adding a section without classifying it fails the
test suite.

Single selection uses the canonical sections directly. Position & Size owns
X, Y, W, H, rotation, and sizing controls; Appearance owns opacity and blend
mode; Fill owns paint rows and the primary color editor; Stroke owns stroke
rows and its advanced geometry. There is no duplicate Quick properties surface.
Empty and mixed selections retain their existing selection-aware section
semantics.

Paint rows are capability-gated: a node whose renderer never reads its paint
stack (groups, line/arrow primitives) is excluded from the Fill section and
from every fill operation, so a mixed selection cannot accumulate invisible
fills. A row states its own value — `#hex`, the paint type, or `Mixed` — and
its type trigger names the current type. Stacked fills and mixed selections
move opacity onto the row's properties line so the value readout stays legible;
the collapsed Stroke "Advanced" toggle carries a summary of non-default state
(dash style, caps, joins, arrowheads, per-side widths) and miter limit, dash
offset, arrowheads, and per-side widths render only where they apply.

## Canonical Design composition

The Design tab uses one section owner for each concern. Position & Size owns
alignment, X/Y, rotation/flip, the single W/H pair, per-axis mode, ratio lock,
and min/max bounds. Stack / Grid owns container flow, wrap, alignment,
distribution, signed flex gaps, padding, and grid track/placement controls.
Layout Child is mounted only for a selected flow child and is never mounted a
second time under the frame section. Stack / Grid is the sole owner of frame
flow and track controls; it is visually distinct from Position & Size while
using the same compact field grammar.

Fills, Strokes, Effects, Typography, Images, Components, Tables, Selection
Colors, and Export each have one persistent owner. Advanced paint, effect,
image, table, and typography editors open as focused surfaces and return focus
to the owning row when dismissed. Layer effect parameters open in an anchored
focused editor beside the rail; reset, duplicate, reorder, and remove live in
the effect row's overflow menu. Mixed selections patch only the edited field;
unsupported values remain visibly mixed or unavailable.

The layout sizing modes are **Fixed**, **Hug**, **Fill**, and **Relative**.
Fixed bounds are shown as inactive retained constraints. Relative fields show
the authored percentage and its reference budget. A “Why this size?”
explanation is the canonical place for zero-reference, cycle, overflow, and
unsupported-owner diagnostics.

Rows in fills, strokes, and effects expose the same edit, duplicate, move, copy,
paste, visibility, and remove affordances. Their identity includes document
session, selected node, property, and paint/effect index, so an owner change
cancels a draft instead of applying it to the next selection.

All Inspector field surfaces follow one containment contract in
`components/Inspector/inspector.css`: controls may shrink with the resizable
rail, dropdown values ellipsize instead of widening it, segmented choices
reflow, and fixed per-side groups become responsive grids. Numeric controls may
format the resting display without changing stored precision. The contract is
covered by `tests/e2e/inspector/control-layout.spec.ts` at 240, 320, 480, and
640px rail widths.

## Tool context

With nothing selected, the Design tab adapts to the active tool. One map,
`components/Inspector/toolContext.ts`, classifies every tool, and both the
Inspector and the floating Tool Options popover read it, so neither surface
can point at controls the other does not render:

| Tool class | Examples | Empty Inspector shows |
|---|---|---|
| Inspector tool content | Frame | `Active tool · Frame` header, then the tool's own sections (Frame Presets, expanded). Choosing a preset places a frame of that size and selects it. |
| Tool Options | Paint Brush, Eraser, Pencil, Smudge, marquees, Magic Wand, Text, Crop | `Active tool · <registry label>` header, one line of guidance, and **Show … options**, which opens the popover beside the toolbar through `context/toolOptionsBridge.ts`. |
| No settings of its own | Select, Rectangle, Ellipse, Pen, Line, Page, navigation | The page/canvas/document settings, exactly as with the Select tool. Page's print overrides render at the top of those settings while the Page tool is active. |

Tool names always come from the tool registry (`toolLabel`), never the raw
tool id. Selection always wins over tool context: once something is selected,
the Inspector shows that selection's properties under any tool.

A selected frame (or multi-frame selection) embeds **Resize to Preset**
directly within the **Position & Size** section as a compact selector alongside
the orientation swap toggle. This eliminates an unnecessary separate accordion row
(`frame-resize`), keeping geometry and dimensions unified. When opened, it reveals
instant dimension and text search, category chips (Phone, Desktop, Social, Print,
Custom, Favorites), star favoriting, multi-frame batch resizing, and a
**Save current size as preset** action that persists custom dimensions to the preset library.

## Placement decision

Answer these questions in order before choosing a surface:

1. Does the control configure the active tool or a temporary interaction?
   Place it in Tool Options. Examples: brush behavior, crop, mask refinement,
   and temporary selection modes. The exception is a compact, persistent
   choice that would otherwise leave the empty Inspector with nothing to show
   (Frame presets); register that tool as `inspector` in `toolContext.ts`
   instead of adding a second copy to Tool Options.
2. Is the setting document-wide, page-wide, export-specific, application-wide,
   or diagnostic? Place it in Document, Export, Settings, or Audit respectively.
3. Does the feature require previews, model downloads, a long reorderable
   stack, a graph, a curve, a canvas, or more than one shallow disclosure?
   Place it in the matching durable workflow such as Appearance, Adjustments,
   Prototype, Typography, or a focused editor.
4. Is it low-frequency and action-oriented rather than a persistent value?
   Provide a searchable command and an appropriate menu or context-menu entry.
5. Only if the value directly affects the current selection, is adjusted often,
   gives immediate feedback, and remains understandable at sidebar width should
   it live in Properties.

Do not use an extra accordion as the justification for placing a large workflow
in Properties.

## Required proposal fields

Additions must record:

- `surface`: the durable owner
- `scope`: selection, mixed selection, document, active tool, or temporary workflow
- `frequency`: frequent, occasional, or rare
- `complexity`: compact, moderate, or large editor
- `status`: functional, incomplete, or disconnected
- `rationale`: one sentence explaining why the owner is correct
- `duplicates`: any materially overlapping UI

The implementation must also define:

- applicability for every supported object type and mixed selection
- the command or navigation path used to reopen the feature
- the document command/history path it reuses
- lazy-mount behavior for large editors
- focus entry and restoration behavior
- persistence scope, if any
- representative unit and E2E coverage

## Session checklist

For every panel-affecting session:

1. Update `featureOwnership.ts` before composing UI.
2. Run the ownership and section-registry tests.
3. Verify the feature has one canonical editing surface.
4. Keep common properties in their canonical section; do not add a duplicate
   summary surface or second state path.
5. Test no selection, supported single selection, unsupported selection,
   compatible mixed selection, and incompatible mixed selection.
6. Verify keyboard discovery through the action registry.
7. Profile mount count and selection switching if the editor is moderate or large.
8. Update the audit inventory when ownership, status, or duplication changes.

## Review rule

A new Properties entry should be rejected when any of these are true:

- it is primarily document-, application-, export-, or tool-scoped;
- it is incomplete but appears actionable;
- it silently edits only a compatible subset of a mixed selection;
- it duplicates another editor;
- it needs nested disclosures to fit;
- it starts model, network, analysis, or long-running processing work;
- it cannot support undo, focus restoration, or current-selection changes safely.
