# Inspector feature ownership

The Properties panel is a contextual inspector, not a default container for
new editor features. Every section registered in
`components/Inspector/sectionRegistry.ts` must also have an exhaustive entry in
`components/Inspector/featureOwnership.ts`. The ownership contract is checked
by `featureOwnership.test.ts`; adding a section without classifying it fails the
test suite.

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

