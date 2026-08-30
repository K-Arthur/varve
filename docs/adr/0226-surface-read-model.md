# ADR-0226: Additive page and frame surface read model

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Varve has two valid meanings for a bounded work area:

- a `Page` is a publishing surface with trim dimensions, print geometry,
  numbering, spreads, sections, and parent/master projection;
- a `FrameNode` is authored scene content that can contain, clip, lay out, and
  export design content. A top-level frame may also be classified as an
  artboard by the coordinate service.

They must not be collapsed into the same persisted entity merely because both
look rectangular on the canvas. Treating a page like a Figma-style file page
would lose publishing semantics; treating every frame as a page would make
ordinary UI composition unexpectedly participate in pagination and print
output. Export regions are markers, not work surfaces, and pasteboard content
is intentionally surface-less.

The existing document format stores page metadata plus a `contentRoot`, while
frames remain ordinary scene nodes. A storage migration would be high risk and
is not required to give consumers one consistent answer about ownership,
placement, clipping, or export membership.

## Decision

1. Add `@varve/scene`'s `Surface` read model as an additive projection over
   the current document representation. It emits page, frame, and artboard
   surfaces with kind-qualified identity (`page:<id>`, `frame:<id>`, or
   `artboard:<id>`).
2. Page surfaces carry print-only metadata: trim, resolved bleed/slug,
   numbering, assigned parent/master ids, and page-export membership. They
   are placed by the existing page/spread placement resolver.
3. Frame and artboard surfaces carry authored node geometry, ancestor surface,
   ownership, and explicit container clipping. Their export bounds are not
   page trim geometry. A frame inside a page is included in page export, but
   remains a frame rather than becoming a page.
4. Canvas rendering remains editing-oriented: page trim/bleed is not an
   implicit canvas clip. Frame clipping follows `FrameNode.clipContent`.
   Preview and export may apply page trim/bleed as output policy.
5. Export-region nodes are excluded from the surface list and surface lookup.
   They remain available to the export-region system. Pasteboard and master
   ownership are preserved as ownership categories, not fabricated pages.
6. Workspace mode controls disclosure of page-management and print-geometry
   controls only. It never filters canonical scene rendering, ownership,
   persistence, command availability, or explicit export targets.
7. This is a read-model migration step. Existing page storage, page operations,
   master projection, and frame storage remain authoritative until every
   consumer has moved to the projection and a separate migration decision is
   approved.

## Consequences

- Hit testing, selection, thumbnails, minimaps, export planning, and future
  multimodal proposals can consume the same surface/ownership vocabulary.
- A Figma-like design file can use frames without becoming a paginated print
  document, while a print document can contain frames and ordinary pasteboard
  content.
- The read model is derived, so it must be recomputed or invalidated when
  pages, placements, node ancestry, transforms, parent/master assignments,
  or print settings change.
- Consumers must not infer page identity from a frame, content-root id, or
  workspace mode. They must use `Surface.kind` and `surfaceKey`.

## Rejected alternatives

- **Make every page a hidden frame:** conflates print semantics with authored
  content and breaks the existing page-operation and parent projection model.
- **Treat document pages like Figma file pages:** Figma-style organization is
  represented by the workspace/document navigation layer; Varve pages also
  define publishable geometry and output order.
- **Make every top-level frame a page:** changes existing design documents and
  incorrectly adds bleed, numbering, and page export behavior.
- **Replace the persisted page model immediately:** too broad for a read-model
  problem and would require a coordinated codec, history, import/export, and
  collaboration migration.

## Implementation

- Read model: `packages/scene/src/surfaceModel.ts`
- Contract tests: `packages/scene/src/surfaceModel.test.ts`
- Page placement and projection inputs: `pageScene.ts`, `pasteboardLayout.ts`,
  `pageOwnership.ts`, `printGeometry.ts`
- Workspace disclosure policy: `packages/editor/src/workspace/useWorkspaceConfig.ts`
