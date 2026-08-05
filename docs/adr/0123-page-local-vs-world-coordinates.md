# ADR-0123: Page-local versus world coordinates

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Page content roots sit at world origin today (`document-pages.ts:54,65-66`),
so page-local == world. `coordinateService.ts` has node↔world transforms and
reparenting, but no page↔world mapping. Milestone 2 requires explicit spaces:
viewport ↔ world(pasteboard) ↔ spread ↔ page ↔ node.

## Decision

D1 — Introduce explicit coordinate spaces and a central page-aware
coordinate service (viewport/world/spread/page/node) on top of the existing
`coordinateService.ts` primitives.

D2 — Page-local origin is the page trim top-left in *unplaced* space; the
page-to-world transform is `placement translate × (identity)` — pages are
placed by translation only (no per-page rotation/scale) for v1.

D3 — All rendering, hit testing, snapping, guides, overlays, import placement,
and export-preview code routes through the shared service; ad hoc
"world minus page offset" arithmetic is banned in new code (lint rule).

## Alternatives

- Store content transforms in world space and place pages by shifting content
  — rejected: violates "moving a page must not mutate child-local coordinates"
  and breaks page-local snapping/guides.
- Keep page-local == world and render pages side by side by translating at
  paint time — rejected: hit testing, selection, and paste must agree with
  paint; a single source of truth is required.

## Consequences

- Property tests: pageToWorld(worldToPage(p)) == p and inverse; moving a page
  preserves page-local node coordinates; cross-page moves preserve world
  position.

## Migration impact

`migrateToPages`-era docs place page 1 at world origin — unchanged by design.

## Compatibility impact

None: new functions, no field changes.

## Security considerations

Placement values bounded (|v| ≤ 1e7 px) to keep floats and culling sane.

## Rejected shortcuts

- Per-page rotation/scale placement in v1.
- Painting-time-only page translation.
