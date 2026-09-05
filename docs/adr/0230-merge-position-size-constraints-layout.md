# ADR-0230: Merge Position & Size + Constraints into a single Layout section

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

The Inspector panel was recently restructured (commits 5ca1753f5…8067c472a):
Properties + Appearance + Audit merged into one context-adaptive Design tab with
progressive disclosure. That work deferred merging Position & Size and Constraints
into one logical group.

Research basis:
- **Figma UI3 Design panel:** Layout section contains W/H/X/Y plus resizing
  behavior; constraints are contextually relevant and hidden when not applicable
  (e.g. inside auto-layout frames).
- **Photoshop Properties panel:** Transform group merges size/position/rotation.
- **Affinity context toolbar:** size/position/constraint options are one visual
  cluster.

## Decision

### Surviving section ID and title

**Keep `position-size` as the surviving section ID.** Change its title from
"Position & Size" to "Layout". Remove the standalone `constraints` entry from
the section registry entirely.

Rationale:
- `position-size` is `essential: true, canHide: false` — non-negotiable UI.
  Keeping it as the surviving id preserves its persistence contract (not hideable,
  always shown when available).
- The existing `layout` id (for auto-layout frame controls, order 120) serves a
  different purpose and must not be conflated. It remains separate.
- `constraints` is `essential: false, canHide: true`. Its persisted state
  (collapsed/hidden) will be silently dropped by `migrateSectionState` because
  unknown IDs are ignored (line 170 of `sectionState.ts`). No crash, no phantom
  entry.

### Title: "Layout"

The merged section title is "Layout" because it now covers "everything about
where an object sits": position (X/Y), size (W/H), rotation, skew, flip, and
responsive constraints. "Layout" is the natural name for this in Figma's UI3 and
conveys the semantic grouping.

Note: this creates a third section with a similar name ("Layout" for frames at
order 120, "Layout child" at order 120, and our merged "Layout" at order 100).
These are disambiguated by:
1. The merged Layout is at order 100 (first in the geometry group).
2. The frame Layout is order 120 and only available for single frame selections.
3. The Section Manager shows the full title for each.

### Constraint controls embedded as a sub-group

Constraint controls (horizontal/vertical axis selects, visual pin editor) are
rendered inside the PositionSizeSection disclosure body as a field group
**without** their own DisclosureSection wrapper. This avoids nested
disclosures (a UX anti-pattern in the Inspector) and keeps the single
"Layout" trigger as the only APG disclosure button.

### Auto-layout exception

When the selected node's parent frame has `layoutStyle` (auto-layout is
active), constraint controls are **hidden** inside the merged Layout section.
Constraints are semantically meaningless inside auto-layout frames — Figma
hides them too. The position/size/rotation/flip/skew controls remain visible
regardless.

Implementation: `PositionSizeSection` checks each node's parent for
`layoutStyle`. If ALL nodes are inside auto-layout parents (or have no frame
parent), constraint controls are hidden. If ANY node has a non-auto-layout
frame parent, constraint controls show (with mixed-state handling).

The separate `layout-child` section (for per-axis child sizing and
flow/absolute position inside auto-layout frames) remains independent and
is **not** folded into the merged section — that's a future consideration.

### Multi-selection behavior

Both `PositionSizeSection` and `ConstraintSection` already handle multi-select
via `commonValue` / mixed-state logic. The merged section inherits this
unchanged. Mixed-kind selections (some nodes have frame parents, some don't)
correctly show/hide constraint controls per the auto-layout check.

### Variable bindings

Position/size fields support variable binding UI (`BindingMenu`). This lives
in `PositionSizeSection` and is completely untouched by the merge.

### Section Manager

The merged entry appears once under `position-size` with title "Layout".
`canHide: false, essential: true` — position/size is non-negotiable.
The Section Manager lists it once; hiding is not possible for this section.

### Stale persisted state

If a user previously had `constraints` collapsed/hidden in their persisted
state:
- `migrateSectionState` silently drops unknown IDs (the `key in result` guard).
- No crash, no phantom entry.
- The legacy slug `constraints` in `LEGACY_SLUG_MAP` is kept for one release
  cycle (sessionStorage migration) but maps to a no-op since the id is no longer
  in the registry.

## Consequences

1. One section, one registry entry, one accessible trigger for position, size,
   rotation, flip, skew, and constraints.
2. DOM budget in ownership.spec.ts should decrease (fewer sections = fewer
   DOM nodes).
3. E2E tests referencing "Position & Size" trigger name must be updated to
   "Layout".
4. E2E tests referencing standalone "Constraints" section trigger must be
   updated to find constraint controls inside the Layout section.
5. Unit tests for `ConstraintSection` continue to test the component in
   isolation (rendered inside a DisclosureSection test wrapper), but the
   E2E integration tests verify the merged behavior.
