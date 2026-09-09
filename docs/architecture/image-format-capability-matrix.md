# Image format capability matrix

This is the current format contract for Varve's image lifecycle. It is backed
by `packages/import/src/formatCapabilities.ts`; the registry is the source of
picker and detection policy. A format's extension is never enough to select a
decoder: when bytes are available, signature detection wins and a mismatch is
reported.

## Support levels

| Level | Meaning |
| --- | --- |
| Editable raster | A decoded raster can be placed and edited as an image source. The browser working surface is currently RGBA8. |
| Flattened raster | A container is decoded to one raster for placement. Layer/page fidelity is not retained. |
| First frame | Animation is inspected and recorded, but ordinary image placement uses the first frame. |
| Vector preserving | Supported vector constructs remain editable scene content; unsupported constructs are reported. |
| Partial document | The parser maps a bounded subset of a document format and reports omissions. |
| Unsupported | No local decoder is bundled. The picker must not advertise it as importable. |

## Matrix

| Format | Detect | Import | Place/edit | Alpha | Color and metadata | Animation/pages | Export/convert | Browser / Tauri |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PNG | Signature | Editable raster | Yes | Full | PNG color chunks and valid ICC inspected; browser surface is 8-bit | APNG is detected as animated metadata; not a timeline | PNG export; conversion can be lossless | Native / native |
| JPEG/JFIF | Signature | Editable raster | Yes | None; JPEG output needs an explicit background | EXIF orientation and ICC inspected; CMYK/YCCK is not silently treated as RGB | None | JPEG export is lossy and background-flattens alpha | Native / native |
| WebP | RIFF/WEBP signature | Editable raster | Yes | Full | ICC inspected; browser surface is 8-bit | Animated container metadata retained; placement is first frame | WebP export is capability-checked | Native / native |
| AVIF | ISO BMFF `ftyp` brand | Editable raster when runtime decode succeeds | Yes | Full | CICP/ICC inspected; browser surface may be sRGB8 | Container support is runtime-dependent | Encoder is capability-checked | Runtime / runtime |
| GIF | Signature | First frame | Yes | Palette/binary | Indexed source; frame metadata inspected | Timing, loop, disposal inspected; not a timeline | Static export only in the image conversion path | Native / native |
| BMP | Signature | Editable raster | Yes | Decoder-dependent | Header dimensions; browser surface | None | No generic BMP encoder | Native / native |
| TIFF | Signature | Flattened raster | First IFD only | Decoder-dependent | EXIF/ICC/photometric metadata inspected before normalization | First page only | No generic TIFF encoder | Normalized / normalized |
| SVG/SVGZ | XML or gzip/container path | Vector preserving | Supported paths/text/paints remain editable; unsafe/external resources rejected | Yes | Scene color policy; SVG metadata where safe | Animation is not exported as a motion timeline | SVG export when representable; embedding and tracing are separate semantics | Parser / parser |
| PDF | `%PDF-` signature | Partial document | Page/vector fidelity depends on source constructs; warnings are retained | Target-dependent | Page boxes and print/color policy | First page or bounded page import, depending parser path | Print PDF export; not a generic PDF-to-image claim | Parser / parser |
| PSD | `8BPS` signature | Partial document | Supported layers only; effects/smart objects disclosed | Yes | Parsed source metadata where available | None | No PSD encoder | Parser / parser |
| PSB, HEIF/HEIC, JPEG XL, QOI, ICNS import | Signature/extension where available | Unsupported | Not placed | — | — | — | Not offered as generic conversion targets | Unsupported / unsupported |
| ICO | Container signature/extension | Not generic image import | — | Yes | Icon frame metadata | Multiple icon frames | Dedicated icon export only | Export path / export path |

## Lifecycle invariants

- A detected content format is carried into import reports; a misleading
  filename is disclosed instead of being treated as authority.
- Raster inspection happens before data-URL allocation or browser decode and
  enforces encoded-byte, dimension, and decoded-pixel budgets.
- EXIF orientation is recorded as source metadata and used for displayed
  dimensions. Browser-decoded pixels are treated as already orientation
  normalized; no second transform is applied.
- ICC extraction and color interpretation are metadata operations. The current
  browser editing surface does not claim full-fidelity CMYK, wide-gamut, or
  high-bit-depth raster editing.
- Embedded assets are content-addressed and deduplicated. Placement state stays
  on the image fill, while source bytes and source metadata stay on the asset.
- Animated containers are not silently flattened without disclosure: frame
  facts are retained, while ordinary placement remains explicitly first-frame.
- Raster-to-SVG is not one operation. Embedding pixels, tracing to paths, and
  exporting native scene vectors have different fidelity and editability
  semantics and must keep separate labels.

## Deliberate deferrals

There is no bundled HEIF/HEIC, JPEG XL, RAW, EXR, PSD encoder, or generic TIFF
encoder. Adding one requires an evaluated local provider, bounded-memory
measurements, license/provenance review, browser/native parity, and packaging
tests. The registry therefore marks these capabilities unsupported instead of
showing a control that cannot complete the workflow.

