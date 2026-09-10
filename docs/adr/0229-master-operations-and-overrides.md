# ADR-0229: Master mutations use typed operations and sparse overrides

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Varve's publishing pages and Figma-like frames have different ownership and
rendering semantics. A master page is a reusable source tree; applying it to a
page must not copy inherited nodes into the page's local layer tree. Page
changes also need to survive master edits, remain undoable, and be safe when a
panel action was made against stale document state.

The document model already stores master assignments and sparse override
records. The missing boundary was a replayable operation family and editor
adapters for master CRUD, assignment, and override lifecycle.

## Decision

1. Master mutations use the versioned `master.*` operation family:
   `create`, `delete`, `rename`, `duplicate`, `set-applies-to`, `assign`,
   `override`, `remove-override`, and `reset-overrides`.
2. The editor routes these operations through `updateDoc`, so each user action
   is one normal history entry and no panel can bypass operation validation.
3. A page assignment stores only the master id. The resolved projection keeps
   source node ids for inherited content and substitutes only the local node
   referenced by a `modified` override. `hidden` and `deleted` overrides omit
   the source node from that page's projection.
4. Override targets are validated against the currently assigned master. A
   modified override must reference an existing replacement node. Invalid or
   stale actions are no-ops at the editor adapter boundary and cannot create a
   dangling assignment or source reference.
5. Detaching a master clears the assignment and its sparse overrides. Resetting
   overrides clears only the page's override map; it does not alter the master
   source or unrelated pages. Removing one override leaves other overrides
   intact.
6. The existing `appliesTo` field is an intended page-side applicability hint
   (`all`, `left`, or `right`), not an implicit bulk-assignment command. Explicit
   assignment remains authoritative until range/selection assignment semantics
   are added.
7. This slice does not claim nested masters, multiple stacked masters, master
   source edit mode, structural override materialization, or full detach
   materialization. Those features require their own resolver and transient
   editor-context contracts and must not be implied by the panel.

## Consequences

- Source identity remains stable across propagation, so a master edit can
  update all assigned pages without serializing resolved copies.
- Undo, replay, summaries, and affected-entity indexing have one contract for
  master actions alongside page and node actions.
- The panel provides direct apply, detach, and reset controls, while existing
  menus continue to use the same context commands.
- A future master edit mode can reuse the operation family without changing
  the page-vs-frame ownership model.

## Implementation

- Operation definitions: `packages/scene/src/operations/ops/masterOps.ts`
- Operation registration: `packages/scene/src/operations/bootstrap.ts`
- Editor adapters: `packages/editor/src/masterCommands.ts`
- Context wiring: `packages/editor/src/context.tsx`
- Projection: `packages/scene/src/document-components.ts`
- Tests: `packages/scene/src/operations/__tests__/masterOps.test.ts` and
  `packages/editor/src/components/MasterPanel/MasterPanel.test.tsx`
