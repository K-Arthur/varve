# Font system audit — 2026-09-09

This audit supersedes the implementation-status claims in the 2026-07-27
font audit where they conflict with the current runtime. It was performed on
`master` with unrelated working-tree changes preserved. The parser findings
were reproduced against the installed Carlito, Cantarell, and Noto Sans CJK
files as well as the repository fixtures.

## Evidence and disposition

| Area | Finding | Disposition |
| --- | --- | --- |
| Native discovery | `enumerateSystemFonts()` had no production caller and passed `{}` to a command requiring `{ request: { family } }`. | Wire the command through the authoritative catalog and keep permission/error states explicit. |
| Stored fonts | IndexedDB restoration already runs before the desktop editor mounts. Native filesystem restoration was not connected. | Preserve the working IndexedDB path; add native restoration and exact artifact identity. |
| Parser names | Name records were read as if `languageID` did not exist. Real Carlito returned `Unknown` and no PostScript name. | Corrected in the parser slice. |
| Collections | TTC version and member count offsets were wrong; real Noto Sans CJK returned no members. | Corrected in the parser slice; member index is part of identity. |
| Coverage | Format-4 `endCode`/`startCode` and reserved padding were confused; format 12 was absent. | Corrected in the parser slice. |
| OpenType features | GSUB/GPOS parsed layout-header bytes as feature records. | Corrected in the parser slice; real feature tags now appear. |
| Face identity | Family, weight, and style projections could collapse collection members. | Collection index is now part of the canonical key and equality check. |
| Worker rendering | Dynamically registered bytes were not transferred to the render worker. | Byte-backed loads now publish a local blob-backed `@font-face` bridge for stylesheet harvesting; synchronous family admission remains the fallback when adoption is pending. |
| Package export | A manifest could report a bundled font without a corresponding package entry. | Package export now resolves exact bytes before setting `bundled` and writes the corresponding `fonts/` entry; unavailable bytes are reported explicitly. |
| Image identification | The UI analyzed the complete image and applied candidates to the current text selection even when the selected node was an image. | Follow-up crop/target slice, with optional local OCR. |

The parser work follows the OpenType [name table](https://learn.microsoft.com/en-us/typography/opentype/spec/name), [font-file and collection](https://learn.microsoft.com/en-us/typography/opentype/spec/otff#ttc-header), and [cmap](https://learn.microsoft.com/en-us/typography/opentype/spec/cmap) structures. Embedding permissions remain a separate policy concern; `fsType` does not establish a complete license grant.

## Validation evidence

The corrected fixture suite passes 33 parser tests. A read-only probe against
real files now reports Carlito, Cantarell, and ten Noto Sans CJK collection
members with non-empty PostScript names, valid ranges, and real GSUB/GPOS
features. The next slices will add committed licensed fixtures so CI does not
depend on host-installed fonts.

The existing compact-picker E2E was also inspected visually. The empty-text
scenario loses the picker surface after the text interaction; the non-empty
scenario keeps it alive but constrains the family field and clips the menu.
Those observations are tracked as editor UX acceptance tests rather than
being hidden by screenshot updates.

## Original hypothesis disposition

The 16 hypotheses from the prior review are kept explicit here so a passing
unit test cannot be mistaken for end-to-end completion.

| # | Hypothesis | Disposition |
| --- | --- | --- |
| 1 | Name records lose language/platform fields | Fixed in parser and real-font probes |
| 2 | Collection headers use incorrect offsets | Fixed; member index is retained |
| 3 | cmap format 4/12 coverage is incomplete | Fixed and covered by parser tests |
| 4 | GSUB/GPOS traversal reads headers as features | Fixed and covered by real fonts |
| 5 | WOFF reconstruction changes identity/checksums | Fixed for validation and original-byte hashing |
| 6 | Native enumeration uses a disconnected IPC shape | Request envelope fixed; production Refresh wiring remains |
| 7 | Native storage collides by family | IndexedDB is content-addressed; native exact-file migration remains |
| 8 | Legacy migration can resurrect removed families | Hash migration is guarded; durable removal journal remains |
| 9 | Dynamic byte faces bypass worker readiness | Blob-backed stylesheet bridge added; adoption is still gated synchronously |
| 10 | Variable axes are absent from measurement identity | Authored references now persist; cache-axis audit remains |
| 11 | HarfBuzz shaping is not the canonical render path | Existing backend is present; production compositor integration remains |
| 12 | Package manifests claim fonts without payloads | Fixed: `bundled` follows a written `fonts/` entry |
| 13 | Export readiness can silently time out | Raster readiness reports timeouts; font-specific preflight remains |
| 14 | Rich-text outlining reuses one face for all runs | Remains open; run-level outlining is required |
| 15 | Image identification ignores target regions/dependencies | Remains open; crop/target/OCR slice is required |
| 16 | Catalog previews can fetch artifacts implicitly | Fixed: browsing and hover are metadata-only |

The acceptance scenarios and their current evidence ownership are tracked in
[`font-acceptance-matrix-2026-09-09.md`](./font-acceptance-matrix-2026-09-09.md).

## Remaining platform limits

Linux native enumeration and WebKitGTK evidence can be run locally through
the embedded desktop lane. Windows WebView2 and macOS WKWebView still require
their CI or platform environments. The collaboration package remains a
transport stub, so this work will provide portable font references and
authorized asset descriptors without claiming live peer synchronization.
