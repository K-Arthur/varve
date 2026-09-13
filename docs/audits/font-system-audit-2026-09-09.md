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
The toolbar menu-boundary and picker-first Escape repairs are now covered by
the focused E2E contract; a fresh runtime capture remains dependent on the
concurrent InspectorQuickBar worktree being HMR-clean. Those observations are
tracked as editor UX acceptance tests rather than being hidden by screenshot
updates.

## Original hypothesis disposition

The 16 hypotheses from the prior review are kept explicit here so a passing
unit test cannot be mistaken for end-to-end completion.

| # | Original hypothesis | Current disposition |
| --- | --- | --- |
| 1 | Native enumeration has no production caller | Confirmed in fresh source audit. Request shape repaired earlier; startup/Refresh and exact native handles remain open. |
| 2 | Stored-font restoration has no production caller | Disproved for browser: restoration is already called before editor mount. Native exact-file restoration remains incomplete. |
| 3 | Fonts inspector onSelect is a no-op | Open integration check: verify the actual mounted panel target adapter; browse-only is valid only when explicitly labelled. |
| 4 | Browser face selection discards face metadata | Confirmed: selection callbacks still accept a family string. Real face/instance application remains open. |
| 5 | Family strings collapse distinct files and members | Confirmed across picker, native storage and runtime projection; optional schema references alone do not fix it. |
| 6 | Inspector edits ignore active ranges and inherited styles | Confirmed for top-level batch update and floating toolbar callbacks. Shared range/caret adapter remains open. |
| 7 | Select by Font ignores effective runs and current scope | Existing command needs the shared effective usage index and explicit scope/navigation integration. |
| 8 | Native metadata and exact file loadability are lost | Confirmed: paths are enumerated but no opaque exact-file/member handle flows to rendering. |
| 9 | Native storage overwrites by normalized family | Confirmed in font_storage.rs; artifact/face migration and exact uninstall remain open. |
| 10 | Byte-loaded fonts do not reach render workers | Partial repair: blob-backed CSS bridge exists. Exact revision acknowledgement and main/worker oracle remain open. |
| 11 | Readiness and caches omit full face instance | Confirmed: useDocumentFonts keys family/weight/style. Axis, features, language and face revision require audit/integration. |
| 12 | Missing-font checks conflate family and usable face | Partial resolver states exist; distinct capability outcomes and recovery UI remain open. |
| 13 | Catalog and registry disagree through lossy bridging | Confirmed architecture risk: family projections and placeholder metadata remain. One authoritative exact-face service is required. |
| 14 | Image identification ignores region and text target | Confirmed: whole-image analysis, missing classifier/comparison dependencies, and an ineffective image-selection Apply path. |
| 15 | Download lifecycle needs explicit verification | Earlier queue/cancellation tests exist. Migration restart, integrity, offline retry and exact uninstall still require end-to-end proof. |
| 16 | Historical audit completion claims conflict | Confirmed. Historical claims remain historical; the restored original acceptance matrix is the current checklist. |

The acceptance scenarios and their current evidence ownership are tracked in
[`font-acceptance-matrix-2026-09-09.md`](./font-acceptance-matrix-2026-09-09.md).

## Remaining platform limits

Linux native enumeration and WebKitGTK evidence can be run locally through
the embedded desktop lane. Windows WebView2 and macOS WKWebView still require
their CI or platform environments. The collaboration package remains a
transport stub, so this work will provide portable font references and
authorized asset descriptors without claiming live peer synchronization.


## Continuation audit — 2026-09-10

The earlier hypothesis table accidentally substituted parser discoveries for
several of the supplied hypotheses. The table above now follows all 16 original
hypotheses, and the acceptance matrix follows all 24 original scenarios.
Parser discoveries remain additional findings, not substitutes.

At `8cd73fc72` plus the shared working tree, the font picker always consumed
Escape, including when closed. Inline fallback-placement arrays also restarted
the toolbar positioning effect on every parent render. The menu had no
independent collision boundary. The current repair makes placement inputs stable,
portals the menu separately, keeps active options mounted, preserves native text
editing keys and only consumes Escape while open.

Chromium run `1494` passed both typography-editing tests, including the second
Escape and empty-layer cleanup. Inspected captures nevertheless exposed an
empty virtual list: the portaled scroll element arrived after virtualizer setup.
That observation prompted a callback-ref repair and an explicit visible-option
assertion. The capture also exposed toolbar contents overflowing its background;
alignment/list controls were moved into More. Run 1494 is evidence of this
intermediate defect, not visual approval of the finished toolbar.

Implementation order, primary standards and integration gates are in the
[remaining-work plan](../plans/font-system-remaining-2026-09-10.md).

The subsequent cross-component review confirmed 40px family/weight fields next
to 32px buttons and differently sized field text. The toolbar now follows the
main floating palette's spacing and surface tokens. Computed comparisons and
27 inspected final captures cover three themes at DPR 1/2/3; the shadow was
moved onto the placement layer after visual inspection found clipped corners.
Exact measurements, failed iterations and passing commands are in the
[toolbar evidence log](./font-toolbar-evidence-2026-09-10.md). This verifies the
local toolbar repair, not completion of the broader font acceptance matrix.

Further range-editing review found that `splitRunAt` intentionally discarded the
right half's `characterStyleId`. `replaceTextInParagraph` also reconstructed the
whole prefix/suffix using one format, flattening unrelated runs. The repair
preserves run metadata on both split halves and retains the insertion style
through typing, paragraph creation and an empty paragraph. Direct regressions
cover those behaviors. The scene suite passes 2,873 tests, and the affected
consumer tests and type checks pass through desktop. One editor shortcut-test
timeout passed its isolated rerun (18 tests). Website validation still reports
two existing token checks in the unchanged canvas, grids and auto-layout pages;
these are not rich-text failures. This does not yet wire the floating toolbar
to the active range.


The range dependency check exposed stale schema assertions in seven scene test
files: current documents use 2.27 but those expectations and canonical goldens
still encoded 2.23. The reviewed canonical JSON diff changes only the version;
its SHA-256 is now `c3a4f50c56cd3ad10a6c667eeb7ce988cb98f16a5361699e8f1b25e7019dbdb9`.
Migration behavior tests now compare the exported current-version constant,
while their historical input fixtures retain their original versions.

A follow-up OS/2 review found another synthetic-fixture/parser agreement bug:
`xHeight` and `capHeight` are read/written two bytes late (86/88 instead of
84/86), without checking the table version. Short version-0 OS/2 tables are
also rejected using a whole-file bound rather than their actual table span.
The embedding classifier replaces a restricted base permission with
`no-subsetting`, while bitmap-only is lost. Versions 0/1 must ignore the later
restriction bits; versions 0–2 permit least-restrictive interpretation of
multiple base bits. These are pending parser repairs, confirmed against the
[OpenType OS/2 specification](https://learn.microsoft.com/en-us/typography/opentype/spec/os2).


Range-repair validation commands (shared working tree based on `40f330b26`):

```sh
GIT_INDEX_FILE=/tmp/varve-font-range-v2.index pnpm verify:plan --staged
GIT_INDEX_FILE=/tmp/varve-font-range-v2.index pnpm verify:affected --staged
node /tmp/varve-font-resume-validation.mjs
pnpm audit:tokens
node scripts/audit-architecture.mjs --ci
```

The temporary resume driver ran the one timed-out shortcut spec and every
remaining planner lane, preserving already-green lanes. Its exact command
sequence is recorded in `reports/font-integration-2026-09-10/range-commands.txt`.
The token audit passed 153 pairs across three themes; the architecture audit
passed with existing hub-budget warnings. No render dispatch, schema, or public
API was changed by this run-metadata repair, so no new full-gate escalation
was selected. The earlier schema integration still requires its final gate.


## OS/2 audit correction — 2026-09-10

The preceding claim that x-height/cap-height belong at offsets 84/86 is
**disproved and superseded**. The specification's code-page ranges occupy
78–85; signed `sxHeight` and `sCapHeight` are at **86/88**. The earlier parser
used the correct offsets. An independent opentype.js read of the actual bundled
files confirms Geist 530/710, IBM Plex Sans 516/698, and Fraunces 964/1400 font
units. The repair retains those offsets and corrects signed reads, version
guards, short-table bounds and fallback to hhea when OS/2 metrics are absent.

Real-font tests now require checked-in licensed artifacts instead of returning
success when a desktop dependency is unavailable. The synthetic OS/2 helper now writes an
actual version-4, 96-byte table; the SFNT helper now uses big-endian 32-bit
checksums and a byte-sized rangeShift. Regressions cover complete and shortened
version-0 tables, an OS/2 table at end of file, unrelated bytes after truncated
tables, signed heights, zero metrics and old versions with trailing bytes.

The embedding base/no-subsetting/bitmap-only findings remain open. This
correction does not certify whole-file checksums, all malformed-table handling,
collection identity, or export policy. Exact corpus provenance and validation
are in the [OS/2 metrics evidence](./font-os2-metrics-evidence-2026-09-10.md).

The real-font follow-up also reproduced inconsistent WOFF2 identity between
the single-face and collection parser entry points. The collection-capable
path now retains the original WOFF2 SHA-256, format and byte size; three
artifact comparisons failed before this correction. A true compressed
multi-member collection fixture remains pending.

## Exact PostScript substitute ranking — 2026-09-13

The resolver accepted an exact `fontReference` for missing-face detection, but
its first substitute tier still compared the display family to PostScript
names. A localized or shared family label could therefore miss the installed
face whose PostScript name was already present in the document. The resolver
now ranks a case-insensitive requested PostScript match first, then retains the
legacy family-only heuristic and compatibility tiers. An explicit `Unknown`
PostScript value is ignored rather than treated as a face signal.

The focused resolver suite passed **35/35**, including a regression where
`AcmeDisplay-Bold` is installed under a different localized family label. The
full missing-status and face-recovery matrix remains open pending corrupt,
version-mismatch, permission, and restart evidence.
