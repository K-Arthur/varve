# Inspector and input-surface system

**Status:** accepted specification; implementation is staged
**Owner:** editor/UI maintainers
**Related:** [`label-field-system.md`](label-field-system.md),
[`../adr/0234-inspector-stack-layout-contract.md`](../adr/0234-inspector-stack-layout-contract.md),
[`../research/inspector-input-surface-system-audit-2026-09-16.md`](../research/inspector-input-surface-system-audit-2026-09-16.md)

This is the current contract for Inspector input surfaces. It extends the
shared label/field and stack-layout contracts; it is not a second design system.
`@varve/ui` remains the owner of general field, select, combobox, overlay, and
state primitives. The editor owns the selection-aware adapter because document
transactions, mixed values, and scrubbing are editor semantics.

## Selection-first composition

The Inspector is composed in bands:

1. contextual identity and action band;
2. selection-primary property band;
3. shared appearance band;
4. structure and interaction band;
5. advanced/provenance/analysis band;
6. recovery and section-management path.

Primary order is derived from capabilities and selection context:

| Context | Primary order |
| --- | --- |
| Text | Typography → Text on Path when applicable → Position & Size |
| Single image | Image Placement → Crop & Bounds → Position & Size |
| Multi-image | Batch Image Placement → Position & Size |
| Frame | Position & Size → Stack/Grid; Component/Mockup is promoted when active |
| Component instance | Component/variant context → Position & Size → Layout |
| Adjustment | Adjustment → Scope → applicable position/appearance |
| Table/edit scope | Table context → cell/row/column edit controls |
| Raster layer | Raster/brush context → Position & Size → effects/mask |
| Shape/path/group | Position & Size → applicable geometry → Appearance |
| Heterogeneous selection | Shared intersection controls; mixed values explicit |
| Empty selection | Document/page/canvas context and recovery settings |

Contextual priority may supersede a user’s saved global order for the primary
band. User order still applies within bands and to secondary/advanced content.
This prevents a previous reorder from making the most relevant section
unfindable while preserving customization.

## Field anatomy

Every property row follows one of these forms:

```text
PropertyRow
  FieldLabel (persistent, associated)
  FieldControl
    leading visual/prefix (optional)
    value/editor region
    unit/suffix (optional)
    stable action region (optional)
  FieldDescription or status (optional)
  FieldError (optional)
```

Labels do not become placeholders. Units belong to the shell but are not an
accidental part of the accessible name. Reset, bind, link, lock, clear, and
visibility actions keep a stable end column so appearing actions do not move a
value between renders.

## Value-family contracts

| Family | Use | Do not use |
| --- | --- | --- |
| Native select | Short stable select-only list where platform behavior is acceptable | Rich previews or large/searchable collections |
| Select | Rich select-only popup | Free-form text or query input |
| ComboBox | Editable/filterable list with separate query and committed value | A short simple select |
| SearchField | Querying a collection or panel | Accidentally persisting the query as a document property |
| NumberField | Exact document number with draft/commit/cancel, units, mixed state, optional step/scrub | A continuous range better represented as a slider |
| SliderField | Continuous exploration paired with exact entry when stored | Exact-only values with no meaningful interpolation |
| ColorField | Swatch/summary trigger and focused color editor | An unvalidated raw text field for every colour model |
| Segmented control | Small mutually exclusive visible set | Long lists or options needing descriptions |
| Menu | Commands/actions | A property value list |
| Popover | Small non-modal related editor | Modal or multi-step workflows; use dialog/focused panel |

## State contract

Fields expose these orthogonal states as applicable:
`default`, `hover`, `focus`, `pressed`, `selected`, `disabled`, `read-only`,
`invalid`, `warning`, `loading`, `empty`, `mixed`, `inherited`, `bound`, and
`unavailable`.

State is represented by a semantic attribute/class and, when needed, an
accessible description. Color is never the only signal. `mixed` is a value
state, not a placeholder string that can be committed. Async loading/errors
must not overwrite a newer committed selection.

## Numeric editing contract

Numeric fields separate:

1. the editing string, which may temporarily be empty, `-`, `.`, or `1.`;
2. parsing and validation;
3. preview/mutation of a valid value;
4. commit on Enter/blur according to field policy;
5. cancellation on Escape or context invalidation.

Arrow keys and Page Up/Page Down step without breaking text editing. Scrubbing
uses pointer capture, cancellation, modifier rebasing, a non-drag keyboard
route, and one undo transaction per changed gesture. Wheel changes are never
triggered merely by hovering. Units and locale rules are explicit.

## Overlay contract

Each overlay declares its semantic family: listbox, menu, combobox popup,
popover editor, or dialog. Trigger, popup ownership, focus entry/return,
light-dismiss, Escape, collision, scroll preservation, nested-overlay behavior,
and portal cleanup are tested as one contract. Portaling is an implementation
detail, not a reason to drop accessible ownership or focus return.

## Responsive and density contract

Tokens define compact desktop (32px), standard (40px), and touch-oriented
(44px) controls. Compact fields retain 24px minimum action targets; touch mode
uses 44px targets. At narrow container widths, rows wrap or stack, paired
values stack, long controls span the row, and popup width is bounded by the
viewport. Important properties do not disappear solely because a panel was
narrowed; they move behind an explicit, discoverable disclosure.

## Governance

New Inspector controls must:

- choose a value family from the table above;
- declare applicability and primary/secondary/advanced placement;
- use shared tokens and the field anatomy;
- define keyboard, pointer, touch/pen, and assistive-technology behavior;
- add unit/component coverage and a real selection workflow when document state
  changes;
- document an intentional exception in the migration ledger.

The dated audit is the complete inventory and evidence record. This contract is
updated when a migration changes the system, not for every individual field.
