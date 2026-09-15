# Pages, parent pages, spreads, and layout audit — 2026-08-29

## Scope

This audit covers the requested page-layout system across the shared scene
model, editor frontend, rendering, history, persistence, import/export,
workspace filtering, accessibility, and multimodal boundaries. It records the
current implementation evidence and the implementation sequence; it is a
dated audit, not a claim that every downstream milestone is complete.

## Executive result

Varve already has a substantial page-layout foundation: optional pages with
stable order, page-local placement, ownership validation, spreads, sections,
numbering, print geometry, parent/master projection, page navigation, a Pages
panel, and typed page operations. The central product distinction is now
explicit: pages are publishing surfaces; frames/artboards are authored design
surfaces. The additive `Surface` read model is the first consolidation step.

The main remaining delivery risks are mutation/history consistency, complete
multi-page output, parent editing/overrides, and end-to-end browser/desktop
verification. Existing editor typecheck failures are recorded in the working
session validation report and are not attributed to this slice without an
affected diff proving causality.

## Capability matrix

| Capability | Current evidence | Status |
|---|---|---|
| Page identity/order/size | `Page`, fractional `Page.order`, CRUD and resize operations | Implemented |
| Flat documents | Optional `Document.pages`, global/root content | Implemented |
| Page placement | `Page.placement`, `buildPlacedScene`, page-aware coordinates | Implemented |
| Page/frame distinction | ADR-0171 plus additive `Surface` projection | Consolidated in read model |
| Frame/artboard composition | Ordinary `FrameNode`, `isArtboard`, nesting and clipping | Implemented |
| Page-owned frame placement | Surface projection composes page placement without mutating transforms | Implemented in this slice |
| Spreads/facing pages | Explicit/derived spread helpers and side resolution | Implemented; output consumers remain partial |
| Sections/numbering | `PageSection`, page range parsing, numbering map | Implemented |
| Parent/master projection | Derived projection and override filtering | Implemented foundation; edit UX partial |
| Print geometry | Shared bleed/safe/slug resolver and print UI | Implemented; output wiring partial |
| Page navigation | Keyboard-reachable PageNav and Pages panel | Implemented; workspace policy tightened in follow-up |
| Workspace filtering | Existing effective config and mode-specific panels | In progress; must never filter canvas semantics |
| Export regions | Non-painting markers | Implemented; excluded from `Surface` |
| Persistence/repair | Codec normalization and page validation | Implemented foundation; history integration partial |
| Typed commands/history | Page operation registry exists; some UI uses `updateDoc` directly | Partial |
| Multi-page PDF/native output | Export planning exists; native adapter is still single-page oriented | Partial |
| Import preservation | Figma/SVG and page metadata paths exist; multipage fidelity varies | Partial |
| Browser/desktop parity | Shared scene model, divergent I/O adapters | Partial |
| E2E/visual/performance evidence | Focused unit coverage exists; full page workflow coverage remains | Gap |
| Multimodal page proposals | General proposal boundaries exist | Gap for page-specific actions |

## Concept overlap and ownership

| Concept | Canonical owner | May become a page? | May contain authored children? |
|---|---|---:|---:|
| Page | `Document.pages[]` metadata | Already a page | Via `contentRoot` |
| Spread | `Document.spreads` / topology helpers | No | No; groups pages |
| Frame | `FrameNode` | No | Yes |
| Artboard | Frame capability from coordinate service | No | Yes |
| Canvas | Editor viewport/world | No | Displays all applicable content |
| Pasteboard | Ownership/placement context | No | Yes, without page ownership |
| Group | Scene container | No | Yes |
| Component/instance | Scene component model | No | According to component rules |
| Parent/master | `Document.masters` + projection | No | Master content is projected |
| Template | Product/import/library concept | Not automatically | Depends on instantiated scene |
| Auto-layout | Frame layout configuration | No | Yes |
| Export slice/region | `frameRole: exportRegion` | No | Marker only |

## Edge cases that must remain explicit

- A flat document may have no pages. Adding or showing the page UI must not
  erase or silently rehome its pasteboard content.
- A page can contain direct shapes, groups, images, text, and frames. A frame
  inside a page is not a nested page and does not inherit page numbering.
- A frame may straddle trim, bleed, or another page while editing. Canvas
  visibility follows authored clipping; output applies page bounds.
- Page order and pasteboard placement are independent. Reordering pages must
  not unexpectedly move a manually placed page.
- Mixed page sizes, facing-page starts, blank insertion, RTL side semantics,
  section restarts, excluded pages, and page ranges must preserve stable ids.
- Parent/master content is projected, never copied. Hidden, deleted, and
  modified overrides must not leak into the wrong page.
- Export regions are not surfaces, even when their node kind is `frame`.
- Workspace panels may be hidden, detached, collapsed, or filtered by user
  preference. Those states must not alter render, ownership, persistence, or
  explicit command/export behavior.
- Selection, copy/paste, drag/drop, thumbnails, minimap, and multimodal plans
  need to retain page/frame provenance across page switches.

## Progressive implementation sequence

1. Establish the additive surface read model and contract tests.
2. Apply one workspace disclosure policy to Shell and page-management UI.
3. Route page UI mutations through typed operations and one history entry.
4. Unify spread/page export planning across browser and native adapters.
5. Add parent edit mode, inherited selection, and explicit override commands.
6. Add section/field panels, import/export preservation, accessibility E2E,
   performance fixtures, and multimodal proposal validation.

This order keeps the shared semantic boundary ahead of visual expansion. Each
step can be committed and validated independently.
