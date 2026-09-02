# File ingestion system

Status: current implementation contract (2026-09-02)

Varve treats local file acquisition as a shared interaction concern and file
meaning as a feature concern. This keeps Open, Import, Place, Install, and
Upload honest without forcing every workflow through one generic uploader.

## Action vocabulary

| Action | Meaning | Typical owner |
| --- | --- | --- |
| Open | Make a native project document active. | Home and the File menu |
| Import | Convert source content into the active document or local asset store. | `@varve/import`, Home asset library |
| Place | Put content at a canvas or inspector-defined location. | Canvas drop and image/reference controls |
| Install/Add | Store a reusable resource for later use. | Icon packs, brushes, palettes, fonts, models |
| Upload | Send bytes to a remote service after explicit consent. | Diagnostic/crash reporting only |

“Upload” is not a synonym for choosing a file. Core document and artwork
flows are local in the desktop app and use local browser storage in the web
build.

## Shared UI primitives

The design-system layer exposes small, composable primitives from
`@varve/ui`:

- `FilePickerButton` — a keyboard- and screen-reader-accessible browse button
  with a reset-safe hidden input;
- `FileDropZone` — a semantic drag surface with nested picker fallback,
  accepted/rejected/processing/disabled states, depth-safe drag tracking, and
  reduced-motion styling;
- `FileQueue` — ordered rows for queued, processing, complete, failed, and
  cancelled files with progress, retry, and remove affordances;
- `FileError` — a consistent alert surface for early selection and
  feature-level parser errors.

`@varve/shared/fileIngestion.ts` provides the cheap, deterministic selection
checks used by these controls. It preserves order, allows same-named files,
and reports empty, unsupported, over-size, and over-count selections. An
`accept` string is a picker hint and an early UI filter, not a security or
format-validation boundary.

## Ownership boundaries

Feature code owns the actual parser, decoder, sanitizer, and persistence
operation:

- File-menu Open keeps its single-document controller and migration path.
- File-menu Import and canvas placement keep `ImportService`, raster
  inspection, parser reports, cancellation, world-coordinate placement, and
  the Tauri native file-drop bridge.
- Home drops split native documents from reusable media. A lone native
  document opens; image, SVG, and font drops enter the local asset store.
  Batch failures do not roll back successful files.
- Bulk Home import validates native document JSON before persistence and never
  creates a blank placeholder for malformed or unsupported content. Images,
  SVG, and fonts are stored as assets.
- Archive restore validates the ZIP and manifest after the shared acquisition
  layer; password/decryption and two-phase restore remain archive-owned.
- Reference images and image fills retain intentional data URLs because their
  scene contracts persist embedded content. They do not use object URLs for
  durable state.
- Icon packs, brushes, LUTs, palettes, and token sources retain their
  format-specific parsers and sanitizers while sharing browse affordances
  where it does not alter their semantics.

## Platform and performance contract

Browser workflows read `File.text()` or `File.arrayBuffer()` only at the
feature boundary that needs the bytes. Large files must not be converted to
base64 merely for a preview. Raster import performs encoded-byte, pixel-count,
and dimension checks before decode. Native desktop drops use the platform
bridge when the webview cannot deliver an operating-system path as a regular
DOM `File`.

Every asynchronous import reports progress or a useful terminal state. A
partial batch may succeed, and the UI identifies the failed item and reason.
Object URLs created for temporary previews are revoked by their owner; data
URLs that are written into document state are intentionally retained.

## Accessibility and visual states

All shared file controls have a keyboard browse fallback, visible focus, a
semantic label, and status/error output suitable for a live region. Visual
validation covers idle, drag-active, accepted, rejected, processing, complete,
failed, disabled, duplicate-name, multi-file, narrow-panel, light, dark, and
reduced-motion states. Feature-specific controls may use a compact picker;
large empty-state drop zones are reserved for onboarding and batch/library
surfaces.

## Verification map

Selection rules are unit-tested in `packages/shared/src/fileIngestion.test.ts`.
Shared interaction states are covered by the UI tests for `FileDropZone` and
`FileQueue`. Home file routing is covered by
`packages/home/src/homeFileDrop.test.ts` and the batch dialog tests. Archive
restore retains its full parser and two-phase behavior suite. Browser tests
must exercise real `DataTransfer`/file-input events for Home, canvas, and
archive surfaces; screenshots are reviewed directly for the state matrix.
