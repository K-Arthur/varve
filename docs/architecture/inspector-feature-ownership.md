# Inspector feature ownership

The Design tab is the contextual Properties surface; it is not a default
container for new editor features. Every section registered in
`components/Inspector/sectionRegistry.ts` must also have an exhaustive entry in
`components/Inspector/featureOwnership.ts`. The ownership contract is checked
by `featureOwnership.test.ts`; adding a section without classifying it fails the
test suite.

Single selection uses the canonical sections directly. Position & Size owns
X, Y, W, H, rotation, and sizing controls; Appearance owns opacity and blend
mode; Fills owns paint rows and the primary color editor. Quick properties is
a compact summary for high-frequency edits, with every field routed to those
same owners and undo/binding paths. Empty and mixed selections retain their
existing selection-aware section semantics.

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

## Placement decision

Answer these questions in order before choosing a surface:

1. Does the control configure the active tool or a temporary interaction?
   Place it in Tool Options. Examples: brush behavior, frame creation presets,
   crop, mask refinement, and temporary selection modes.
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
4. If a compact summary remains in Properties, ensure it links directly to the
   canonical surface and does not introduce a second state path.
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
