# ADR-0228: Page export selection is an explicit logical contract

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

Varve pages are publishing surfaces, not Figma-style organizational tabs.
Export therefore has to resolve page identity, document order, print ranges,
spread topology, and page-level exclusion before a renderer is called. The
previous planner resolved `page` and `pages` targets to one flattened node list:
it could silently lose missing or excluded pages, and `PrintExportSettings`
contained range/spread fields that no consumer interpreted.

## Decision

1. Page-aware targets resolve through `resolveExportPageSelection` in the scene
   package. Node, frame, slice, and selection targets remain non-page targets.
2. The resolver preserves document order and reports missing page ids and
   invalid or empty ranges as structured selection issues. It does not silently
   turn a missing page into a nearby page.
3. `Page.printSettings.excludeFromExport` is respected by default. A persisted
   page/document target must explicitly set `includeExcludedPages: true` to
   override it. An exclusion is reported even when the remaining pages can be
   exported.
4. `PrintExportSettings.pageRangeExpression` uses the canonical display-label
   grammar (`current`, `selected`, `section:Name`, numeric/prefixed ranges,
   and parity). The legacy numeric `pageRange` remains an inclusive,
   document-order ordinal range.
5. A spread export resolves to logical `ExportPageUnit` records. A spread is
   atomic: if one member is excluded or missing, a partial spread is not
   emitted. The resolver may include the other member when a selected page
   belongs to a complete reader spread.
6. The normalized job spec carries `pageIds` and `pageUnits`. Encoders remain
   responsible for turning those logical units into separate files or pages;
   this ADR does not claim that the native PDF adapter is multi-page yet.

## Consequences

- The export planner, preflight, editor export UI, and native adapter can share
  one selection result instead of independently interpreting pages.
- An export can be blocked with an actionable reason rather than producing a
  plausible file with silent omissions.
- Page exclusion is not a workspace filter. Workspace mode controls disclosure
  only; explicit export intent and document print settings control output.
- Mixed page sizes and page boxes remain representable because selection does
  not collapse page geometry into a single synthetic page.

## Implementation

- Resolver and planner integration: `packages/scene/src/export/plan.ts`
- Logical unit type and target opt-in: `packages/scene/src/export/model.ts`
- Display-label range boundary: `packages/scene/src/pageRange.ts`
- Contract tests: `packages/scene/src/export/plan.test.ts` and
  `packages/scene/src/__tests__/pageRange.test.ts`
