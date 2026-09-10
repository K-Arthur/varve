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

## Remaining platform limits

Linux native enumeration and WebKitGTK evidence can be run locally through
the embedded desktop lane. Windows WebView2 and macOS WKWebView still require
their CI or platform environments. The collaboration package remains a
transport stub, so this work will provide portable font references and
authorized asset descriptors without claiming live peer synchronization.
