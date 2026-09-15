# ADR-0191: Print-mark representation

- **Status:** Accepted
- **Date:** 2026-08-05

## Context

Marks exist only in the Rust PDF/X path (`marks.rs:41-121`) with hardcoded
geometry (trim offset 3 mm, `marks.rs:30`); nothing renders marks on canvas
and options like `markOffsetMm`, `includePageInformation` are dead types
(`model.ts:212`).

## Decision

D1 — Print marks are **generated overlays**, never editable scene nodes:
a typed `PrintMarkSettings` (crop, registration, color bars, page
information, fold marks; weight, offset, useDocumentBleed) lives on the
document with per-page/export-job overrides.

D2 — One mark-geometry generator (`@varve/engine` primitives) produces mark
geometry from resolved page geometry (ADR-0190); the Rust PDF path consumes
the same typed settings via IPC (replacing hardcoded offsets), and the canvas
preview renders the same geometry through the shared coordinate service.

D3 — Marks are excluded from selection/hit testing; they export only when
explicitly enabled; raster exports and normal page renders never include
them.

D4 — Mark geometry validates: marks fit within slug (or warn), no overlap
with neighboring pages, offsets ≥ 0, high-DPI scaling exact.

## Alternatives

- Marks as scene nodes (groups drawn per page) — rejected: they would
  participate in selection, undo, ownership, and diff; spec §8.10 bans it.
- Canvas-only approximation distinct from PDF geometry — rejected: preview
  must match output.

## Consequences

- Canvas preview and PDF/X marks come from one geometry source → visual
  parity.
- `markOffsetMm` and `includePageInformation` become real, forwarded to Rust.

## Migration impact

None (marks were export-only; settings default to current behavior).

## Compatibility impact

New settings object; old files default to current hardcoded values.

## Security considerations

Bounds-checked geometry; no marks geometry can reference page content.

## Rejected shortcuts

- Generating marks in Rust only (status quo) with divergent preview.
- Emitting marks as SVG groups into the scene.
