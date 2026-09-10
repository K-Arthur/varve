# ADR-0192: PDF page-box mapping

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

MediaBox always emitted (lib.rs:3027-3032, cmyk.rs:299-304); TrimBox/BleedBox
only in PDF/X with bleed = full page (cmyk.rs:305-316); CropBox/ArtBox never;
multi-page PDF unsupported (`maxPageCount: 1`); export bleed comes from the
dialog, not the document.

## Decision

D1 — Every PDF page is emitted from the page's resolved geometry
(ADR-0190): MediaBox = bleed box; TrimBox = trim size; BleedBox = trim +
bleed; CropBox = TrimBox by default (or slug-aware when page info is on);
ArtBox = TrimBox (content boundary). All boxes are optional per format:
PDF/X requires Trim+Bleed; screen PDF emits Media+Trim.

D2 — Multi-page PDF becomes a first-class export dimension: page-range
selection (parser per spec §26), reader-spread output (two pages side by
side in one PDF page), per-page mixed sizes with correct boxes.

D3 — Bleed flows from the document resolver; the dialog's bleed field becomes
an export-job override that participates in precedence (ADR-0190 D1), never a
separate value.

D4 — Structural tests verify emitted box dictionaries (page count, order,
dimensions, rotation, boxes, font embedding policy) by parsing generated PDFs
— no screenshots-only validation. PDF/X compliance claims require passing the
profile validator.

## Alternatives

- BleedBox = full page (status quo PDF/X) — rejected: it overstates bleed
  geometry and fails mixed-size/page-specific bleed workflows.
- No CropBox/ArtBox ever — rejected: page-info workflows and strict printers
  need explicit crop geometry.

## Consequences

- Demo 4/5 (mixed-size export, section labels) becomes testable end-to-end.
- `@varve/print` facade becomes the editor's export entry point (currently
  bypassed, SpecPanel/export.ts:637).

## Migration impact

Export behavior changes where dialog bleed ≠ document bleed; documented in
release notes with a migration warning for stored presets.

## Compatibility impact

None for documents; exported PDFs gain correct boxes.

## Security considerations

Page-range parser rejects unbounded/huge ranges; export cancels cleanly on
disk-full/permission errors (existing job pipeline handles per-node errors).

## Rejected shortcuts

- Claiming PDF/X without profile validation.
- Bleed from dialog only (status quo).

## Implementation note (2026-08-13)

The PDF/X encoder now applies D1 for its single-page native path. Its input
dimensions are trim dimensions; when bleed or marks are enabled, the media
sheet expands around trim, authored scene content is translated into the trim
origin, and `MediaBox`, `BleedBox`, `TrimBox`, `CropBox`, and `ArtBox` are
emitted in one coordinate system. With zero bleed the boxes coincide. The
remaining multi-page and screen-PDF work described above is still separate
from this correction.
