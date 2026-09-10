# ADR-0106: Modes, themes, brands, platforms, and density

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Varve's variable model has per-collection modes (`variables.ts:42-49`).
Design systems layer multiple independent context dimensions: theme
(light/dark), brand, platform, density, contrast, locale. Resolver modifiers
(ADR-0105) express these; Varve modes express a single axis of values per
collection.

## Decisions

### D1 — One axis per collection; contexts compose via the resolver

A collection's modes remain one dimension of values. Multi-dimensional
contexts (theme × brand × density) are expressed as resolver modifiers, not
by stacking more modes into one collection.

### D2 — Platform outputs are derived, not token dimensions

Platform-specific values (Android dp/sp, iOS pt, web rem/px) are produced by
platform transforms at generation time (unit/color policy per ADR-0106-D3 and
the codegen ADR-0115), not by creating `platform` variants inside the token
document unless the source itself defines them as distinct tokens.

### D3 — Unit and color-space policy is explicit

- `dimension` values keep their declared unit (`px`/`rem` per the format
  report; `%`, `pt`, etc. only as documented extensions). No silent relative
  → absolute conversion: `rem`/`em` generation requires a declared context
  (e.g. 16px root).
- Color values keep source color space and precision; sRGB clamping happens
  only at display/export conversion with a warning (resource limits-related gamut
  reporting), never in canonical storage.

### D4 — Theme permutations never multiply stored values

Light/dark/brand variants of a token are distinct tokens or resolver-selected
sets — never a hidden array of copies inside one token record.

## Alternatives

- Global document mode list applied to everything — rejected: does not model
  per-collection variation.
- Nested mode dimensions inside collections — rejected: couples unrelated
  axes and duplicates resolver semantics.
- Eager materialization of all context combinations — rejected (ADR-0105 D2).

## Consequences

- A clear mapping table: Varve collection → token group; Varve mode →
  collection mode axis; resolver modifier → external context dimension;
  platform transform → codegen concern.
- The UI can label each dimension honestly.

## Migration impact

Existing collections keep their mode lists; nothing is restructured.

## Compatibility impact

No serialization change for existing documents.

## Security considerations

None beyond the resolver bounds already defined.

## Rejected shortcuts

- Auto-creating light/dark copies of every token on import.
- Pretending CMYK is a DTCG color space (Color module defines the list).
- Storing display-converted previews as canonical values.
