# ADR-0129: Facing-page topology

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Side classification is index-based: slot 0 = left, 1 = right, single-spread =
right when `startOnRight` (`document-pages.ts:454-477`). There is no RTL
binding direction, no blank-page handling beyond `autoInsertBlank` (a config
flag, `types.ts:1661`), no foldout support (spreads capped at two pages).

## Decision

D1 — Extend `FacingPagesConfig` with `bindingDirection: 'ltr' | 'rtl'`
(default `ltr`). In RTL, the first page is a left page, "right" classification
mirrors, and spine-relative geometry (inside/outside bleed, ADR-0141) flips.

D2 — Side classification derives from spread topology, not raw index: within a
two-page spread, slot 0 is the left page and slot 1 the right page in LTR; the
reverse in RTL. Single-page spreads classify from `startOnRight` (LTR) or its
mirror (RTL).

D3 — Blank pages are real pages flagged `blank: true` (or `exportEnabled:
false` + no content); insertion keeps odd/even parity when enabled.

D4 — Foldouts are explicit custom spreads (`kind: 'foldout'`, ADR-0128) with a
defined page order and placement; the derived projection never emits foldouts.

D5 — Odd/even page-number semantics always derive from *display number*
(numbering section aware), not array position, so section restarts keep
left/right parity correct in RTL.

## Alternatives

- Mirroring only at render time — rejected: hit testing, snapping, and
  bleed resolution need topology-level truth.
- Treating RTL as a display flag — rejected: numbering and master side
  applicability must follow the binding.

## Consequences

- Master applicability (`left|right|odd|even|first-in-section`) resolves
  through topology (ADR-0132).
- PageNav shows spread pairing; reorder keeps pair parity.

## Migration impact

v2.19 migration: existing docs default `bindingDirection: 'ltr'`.

## Compatibility impact

New optional field; old readers ignore it.

## Security considerations

None beyond ADR-0128 spread validation.

## Rejected shortcuts

- Side derived from `pageIndex % 2`.
- RTL support deferred to display layer.
