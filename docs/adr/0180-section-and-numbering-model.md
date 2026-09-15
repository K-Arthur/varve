# ADR-0180: Section and numbering model

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

`PageSection` exists (startPageOrder, numberStyle, startNumber,
showPageNumber, prefix — `types.ts:1668-1681`); numbering lookup scans
sections per page (O(pages×sections), `document-pages.ts:495-604`). There are
no page-number variables for master-generated numbers, no numbering
restart/continuation UI, no blank/cover handling, no RTL-aware parity.

## Decision

D1 — Keep the section model; add a resolved-numbering cache service keyed by
document revision: one pass assigns each page its section, display number,
formatted string, and parity.

D2 — Add text-frame page-number variables: `PageNumber`, `SectionName`,
`PageCount` tokens resolve at render/export time inside master frames
(ADR-0185); resolved values are never stored on the story.

D3 — `startPageOrder` stays the anchor; `startAt` (numbering style base) and
optional `restart` semantics: default = continue from previous section end
when `startNumber` unset.

D4 — Display number parity (odd/even) derives from the display number within
its section, honoring prefix/suffix and `showPageNumber: false` (cover/blank
pages still have parity from position).

D5 — Sections participate in master applicability (`first-in-section`,
`last-in-section`, `section` scopes, ADR-0181).

## Alternatives

- Numbering as derived-from-index only — rejected: restarts and prefixes are
  required.
- Storing display numbers on pages — rejected: derivable state drifts; diff
  noise.

## Consequences

- Masters with page-number frames propagate the same token; each page renders
  its own resolved value.
- Export page labels use the same resolver as canvas.

## Migration impact

None — additive resolver; existing sections keep semantics.

## Compatibility impact

None.

## Security considerations

Numbering loop bounds: max sections 1,000; depth of nested prefixes bounded.

## Rejected shortcuts

- PageNumber stored as literal text per page.
- Parity from array index (ADR-0178 D5).
