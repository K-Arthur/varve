# Image conversion system

Status: implemented for the local Quick Convert workflow (2026-09-08).

This document describes the boundary between Varve's image import lifecycle,
the standalone raster converter, and document export. It is intentionally
more precise than a list of file extensions: a format can be detected,
inspected, imported as a flattened raster, or exported without being a
round-trip-preserving image codec.

## User-facing paths

### File > Quick Convert

Quick Convert accepts a bounded batch of local raster files and processes them
one at a time through the active browser/webview codecs. The current output
choices are PNG, JPEG, WebP, and AVIF. Each row reports source detection,
encoded size, color/alpha facts, profile/bit-depth facts where available,
warnings, and save status.

The queue is capped at 25 files and 512 MiB of encoded input. Each file is
checked against the shared 128 MiB limit, decoded dimensions against 65,535
pixels per axis and 64 megapixels, and conversion is sequential so a batch
cannot create an unbounded collection of decoded canvases.

### File > Export

The advanced Export dialog exports Varve scene nodes, pages, prototypes, and
code. It is not a general-purpose image-container transcoder. SVG/PDF and
code generation retain their own scene semantics; raster jobs render the
scene into an output surface.

### Import/place

Import and place preserve the source bytes where the document model supports
that. They also record detected animation, EXIF orientation, ICC/color
metadata, and fidelity warnings. A GIF/APNG/WebP can therefore retain media
facts even though editor placement is currently a first-frame raster.

## Conversion contract

The implementation lives in `packages/import/src/rasterConversion.ts`.

1. `inspectRasterBytes` validates the signature, dimensions, encoded size, and
   decoded pixel budget before a browser decoder or data URL is created.
2. The capability registry identifies the input from content, not a trusted
   filename extension or MIME string. Mismatches remain visible in import
   diagnostics.
3. `createImageBitmap(..., { imageOrientation: 'from-image' })` decodes the
   checked source and applies EXIF orientation at the conversion boundary.
   TIFF uses the existing first-IFD-to-PNG normalization path because browser
   image decoders do not generally decode TIFF.
4. The pixels are painted into one RGBA8 canvas. JPEG first paints an explicit
   user-selected matte color when the source may contain alpha.
5. `canvas.toBlob` is requested with the chosen MIME type. If the runtime
   silently returns another type (for example, PNG for an unavailable AVIF
   encoder), conversion fails with a typed `encoder-unavailable` error.
6. The output is saved as bytes through the platform save adapter. No remote
   service or upload is involved.

The normalized canvas boundary intentionally does not promise to copy ICC,
EXIF, DPI, XMP, PNG ancillary chunks, animation timing, or arbitrary bit
depth. Those facts are surfaced as warnings. Conversion is therefore a
pixel-oriented convenience path, not a metadata-preserving archival
transcoder.

## Capability matrix at the conversion boundary

| Source | Detect/inspect | Quick Convert | Important boundary |
| --- | --- | --- | --- |
| PNG | Yes | Yes | Full alpha is possible; output metadata is normalized. |
| JPEG/JPG | Yes | Yes | No alpha; lossy outputs use the selected quality. |
| WebP | Yes | Yes | Animated inputs export the first decoded frame. |
| AVIF | Yes, runtime decode required | Yes, runtime encode required | Failure is reported when the active webview lacks AVIF support. |
| GIF | Yes | Yes | Palette/transparency is inspected; animated inputs export the first frame. |
| BMP | Yes | Import/convert to supported outputs | No Varve BMP encoder. |
| TIFF | First IFD | First-IFD flattened conversion | Layered/multi-page fidelity and TIFF metadata are not round-tripped. |
| SVG/SVGZ | Yes | No | Use the vector import or SVG export path; raster conversion is a separate deliberate operation. |
| PDF/PSD/PSB/EPS/AI/Figma/Sketch | Format-specific parser or partial support | No | Use the document importer/exporter; these are not raster containers for Quick Convert. |
| HEIF/HEIC/JXL/QOI | Detected where signature is available | No bundled decoder | Not advertised as locally convertible until a decoder is shipped. |

The canonical per-format registry is
`docs/architecture/image-format-capability-matrix.md` and
`packages/import/src/formatCapabilities.ts`. New UI should consume that
registry rather than maintain another extension list.

## Security and failure behavior

- Content sniffing wins over extension and supplied MIME type.
- Size and pixel budgets run before browser decode and before data-URL
  allocation.
- SVG/XML parsing remains on the safe parser path; Quick Convert does not
  execute or rasterize arbitrary SVG input.
- Decoder, encoder, invalid background, corrupt input, cancellation, and
  unsupported-format failures have typed conversion error codes. The UI keeps
  the failed row visible and continues a batch where possible.
- Names are reduced to a safe filename stem before saving. The save adapter
  remains responsible for the platform's native destination boundary.

## Deliberate non-goals

The current workflow does not claim:

- animation timeline editing or animated output encoding;
- layered PSD/PSB/TIFF or multi-page TIFF preservation;
- ICC-accurate color conversion through the browser canvas;
- metadata-preserving archival transcode;
- HEIF, JPEG XL, QOI, or generic BMP/TIFF encoding;
- vector/document-to-raster conversion through Quick Convert.

Those capabilities require dedicated codecs or scene/document workflows and
should be added behind the same capability vocabulary, validation limits, and
typed failure contract.
