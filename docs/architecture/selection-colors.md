# Selection Colors inspector

The **Selection Colors** disclosure is a compact, selection-scoped summary in
Properties. It is a paint inspector, not a pixel sampler: it reports authored
vector colours that contribute to the selected content and deliberately keeps
raster/image pixels, effects, and blend results out of the editable set.

The canonical implementation is `packages/scene/src/selectedPaints.ts`. The
editor component (`SelectionColorsSection.tsx`) only renders the derived model
and applies its replacement operation through the existing document/history
transaction path. Desktop and browser builds share this TypeScript scene
contract.

## Collection contract

`collectSelectedPaints(document, selectedIds, { textRange })` visits selected
roots depth-first in document child order. A visited set means selecting both a
container and one of its descendants never double-counts a paint. Hidden nodes
and hidden descendants are ignored; visible locked content is shown, but marked
non-editable.

| Source | Inspected | Replacement behavior |
| --- | --- | --- |
| Shape, path, frame, and text fills/strokes | Solid colours and every visible gradient stop | Changes only the exact selected usage. Gradient geometry, interpolation, tiling, opacity, and blend mode stay intact. |
| Groups/frames and nested children | Traverses rendered descendants; frame-owned fills also count | Selecting a parent and child has the same result as selecting the parent alone. |
| Rich-text runs and a partial text range | Only overlapping run colours; unformatted run portions inherit the text fill | Direct node text updates are editable. Linked-story data is inspectable but disabled until a story editing command owns it. |
| Table appearances/cell styles | Cell fills, strokes, and text colours, excluding hidden tracks | Replaces only the addressed selected table usage. |
| Colour styles | Resolved style colour | Creates a local selected-node style override; it does not mutate the shared style. |
| Shared paints (`paintRefs`) | Resolved effective paint stack | Detaches the selected node to an equivalent inline stack before editing, so other users of the shared paint stay unchanged. |
| Variables and variant-derived paints | Resolved display value | Shown as non-editable with an explanation, rather than silently breaking the binding or component source. |

Image/pattern fills and raster layers appear as semantic non-colour notices,
for example “image fill — not sampled as editable vector colors.” This prevents
an image thumbnail or an average pixel value from being mistaken for an
authored fill. Effects remain in the Effects workflow for the same reason:
their colours are operation parameters, not the selection's paint palette.

## Grouping and labels

The inspector has one swatch per semantic paint group. A group key includes:

- the complete `ManagedColor` identity and ICC/profile fingerprint;
- authored colour alpha and the paint's separate opacity;
- source identity (local usage, style, shared paint, or variable);
- all grouped usage references and their roles.

This avoids collapsing visually similar but semantically different CMYK,
Display-P3, spot, Lab/LCH, profile-tagged, or alpha-bearing colours. The
swatch face composites alpha over a checkerboard, while its accessible name and
tooltip retain colour-space, role, usage count, opacity, and any disabled
reason. The first 16 groups render immediately; an explicit “more” control
reveals the remainder for large selections.

## Editing and history invariants

`replaceSelectedPaintReferences` is immutable and address-scoped. It never
performs a document-wide search/replace, and a no-op preserves document object
identity so it cannot create a history entry. The Inspector wraps an actual
picker gesture with `beginTransaction` / `commitTransaction`; a single swatch
edit therefore has one undo/redo entry and existing document-change rendering
updates the canvas without a second state path.

The colour picker is the standard Inspector picker, including RGB/CMYK and
other supported managed spaces. Its swatch button is keyboard reachable and
opens the same dialog on `Enter`/`Space`; disabled sources retain an accessible
reason.

## Verification matrix

- Scene unit coverage (`selectedPaints.test.ts`) covers stacked fills/strokes,
  gradients, visibility, alpha/opacity, colour-space identity, nested
  containers, rich text/ranges, tables, shared paints, locked content, image
  semantics, exact replacement, and no-op replacement.
- Inspector unit coverage (`SelectionColorsSection.test.tsx`) covers compact
  deduped rendering, authoritative picker opening, image-only semantics, and
  overflow disclosure.
- Playwright (`selection-colors.spec.ts`) creates and selects a real canvas
  object, exercises keyboard picker entry, verifies the image exclusion, and
  keeps light/dark inspector screenshots under
  `selection-colors.spec.ts-snapshots/`.

## Explicit boundaries

- This feature does not sample, quantize, or replace raster pixels; use the
  palette/image workflows for that work.
- It does not edit linked story, variable-bound, or variant-derived sources
  indirectly. Their owning workflow must make the edit so source identity is
  preserved.
- It is a summary/edit surface for selected paint usages, not a replacement for
  the full Fill, Stroke, Gradient, Effects, or Paint Library workflows.
