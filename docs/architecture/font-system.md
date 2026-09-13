# Font system architecture

This records the intended font contract and the current integration gaps.
The acceptance matrix, rather than this contract alone, determines completion. It complements the shaping and geometry details in
[`text-pipeline.md`](./text-pipeline.md) and the provider boundary in
[`font-provider-architecture.md`](./font-provider-architecture.md).

## One service, several projections

`FontCatalog`, `FontLoader`, and `FontResolver` are the authoritative runtime
services. `FontRegistry`, the semantic catalog, the compact selector, and the
full browser are projections that subscribe to their revisions; they must not
construct independent placeholder catalogs. Search is local and does not fetch
font artifacts. Installation is the only operation that may download bytes.
Editor services that still need a catalog view call the engine's
`createFontCatalogFromRegistry` adapter. It projects every registered face,
including collection members and variable-axis definitions, and copies known
family metadata. A registry entry without a verified artifact keeps an explicit
non-canonical identity; the adapter never upgrades a family name into a
portable hash.

```text
catalog metadata ──┐
system discovery ──┼──▶ FontCatalog / FontRegistry
stored artifacts ──┘              │
                                  ├── FontLoader → document.fonts
                                  ├── FontResolver → missing/fallback diagnostics
                                  └── layout, worker, export, and picker consumers
```

## Portable identity

The exact-face key is `sha256:<digest>:<member>`: original artifact bytes and
collection member. PostScript names are metadata. Non-canonical legacy records
retain their old display key until they can be rehashed; they never become an
exact portable reference by name alone. Display
family, version, source, and license are metadata and never replace the hash.
WOFF reconstruction keeps the original artifact hash. Both single-face and
collection-capable WOFF2 parsing retain that original hash, format and byte
size, with one artifact hash shared by its collection members. A text node,
character format, text style, and v2 font manifest entry may carry
`fontReference`; legacy `fontFamily`, weight, and style fields remain readable.

Variation axes and OpenType features remain authored presentation settings.
The shared typography weight adapter updates `wght` when supported and
preserves custom axes and mandatory shaping features across the inspector,
contextual bar, floating text bar, and Logo controls. Static faces retain
ordinary weight behavior without inventing variation data.

## Parsed metrics

OS/2 x-height and cap-height are signed font-unit values at offsets 86/88 in
version 2 and later. Reads are bounded to the actual table span. Legacy 68-byte
version-0 tables have no typographic ascender/descender fields; hhea supplies
them instead. Valid zero metrics are preserved. The checked-in real-font tests
use required fixtures, and their absence fails validation.

Name records and their strings are bounded by the declared name table, rather
than the whole file. Unicode-platform names use UTF-16BE; incomplete code units
are ignored. Legacy code pages and format-1 language tags still need coverage.

WOFF1 decoding uses zlib streams and requires exact decoded table lengths.
Header/directory spans, block order, padding and table checksums are validated
before metadata extraction. Original and reconstructed bytes are bounded to
128 MiB, with at most 4,095 tables and a two-second deadline per compressed
table. SFNT reconstruction preserves the physical table order, restores the
search fields and recomputes the `head` checksum adjustment. The original
container remains the identity source. These bounds do not yet provide the
planned parser-worker deadline or validation of every inner OpenType table.
See the [WOFF evidence](../audits/font-woff-evidence-2026-09-10.md).

Embedding policy is additive: the OS/2 base right (`installable`,
`preview-and-print`, `editable`, or `restricted`) is stored beside independent
`noSubsetting` and `bitmapOnly` flags. The legacy `embeddingRights` value remains
for older manifests, but policy evaluation uses the separate fields. A font
with unknown license provenance cannot be offered for redistribution or live
embedding merely because its fsType bits look permissive; the details panel
shows the unknown state and the reason an export option is unavailable.

## Persistence and recovery

Browser artifacts use IndexedDB database `varve-font-storage-v2`, version 2.
The `artifacts`, `artifactBlobs`, and `faces` stores are joined by the exact
SHA-256 artifact/member key; shared blobs carry a reference count. Writes
rehash the original bytes, reads quarantine tampered records, and exact removal
leaves a tombstone. A durable migration journal prevents a completed legacy
import from resurrecting a deleted face after restart. Family lookup remains a
compatibility projection and is not used for exact recovery.

Native storage now writes the same face key into hash-addressed directories,
keeps old family-addressed files readable, and verifies the sidecar digest on
load and listing. Windows and macOS native runs remain pending.

Download attempts retain their concurrency slot through validation and integrity
checks. Cancellation and pause invalidate an attempt generation, so a late
result cannot overwrite a retry of the same job. A retry waits for the prior
attempt to settle before starting; removal also prevents late publication.
The configured queue limit is clamped to one or two attempts. An operation-wide
parser deadline and cancellation of work inside storage remain separate gaps.
The network transfer has a 30-second deadline covering headers and body reads.
Abort checks after each read prevent late progress, and error cleanup closes
unread response bodies. Timeout is a retryable failure rather than a successful
installation. Expected-hash verification fails if SHA-256 is unavailable; the
legacy synchronous guard cannot claim to have verified a supplied hash.

Document format 2.27 introduces a recovery-safe font-reference migration and
font manifest v2. The migration lowercases valid SHA-256 references, bounds
collection members, removes malformed reference objects, and leaves family-only
legacy requests untouched. Manifest resolution reports missing, substituted,
restricted, and unavailable outcomes instead of silently changing authored
text.

The resolver treats an authored `fontReference` as a hard lookup against the
artifact hash and collection member. A same-family entry with a different
artifact is therefore an unavailable face and cannot satisfy the request. When
a validated face has parsed cmap ranges, the resolver reports the distinct
`missing-glyph` state with the requested characters; an empty range list means
coverage is unknown and is never interpreted as an empty font. Replacement can
be scoped to the exact reference, clears stale identity when the user chooses a
family-only fallback, and records that scope in manifest replacement history.

Document Fonts now exposes a scoped **Replace** action beside each used face.
It opens the same full browser used by the other typography surfaces, so a
replacement can be chosen as either an installed family or an expanded exact
face/member. The panel reports the affected layer and character counts before
the chooser opens. A committed choice updates matching rich runs and shared
text styles in one history transaction, clears stale identity for a family-only
choice, and records the original family/reference in manifest replacement
history. Closing the chooser leaves the document untouched. A full layout
geometry preview and restore-original command are still pending.

## Discovery and privacy

Desktop enumeration uses the native `enumerate_system_fonts` request envelope
and registers the returned family/style faces. Browser Local Font Access is
only attempted after a deliberate user action and permission; denial falls
back to the shipped catalog. Hovering, searching, or opening a catalog result
does not fetch a remote font. The public browser demo can browse metadata and
bundled faces, but additional artifacts require an explicit desktop install.

The full browser exposes that boundary as an explicit **Allow local fonts** or
**Refresh local fonts** action. Its status reports whether native enumeration,
the browser permission, or the compatibility list supplied the results. Face
expansion reads exact registry entries (including a known PostScript name and
portable face key); catalog weight/style combinations are never presented as
selectable faces when no corresponding artifact is installed. The family list
uses measured virtualization with an overscan window; an unmeasured or
zero-sized test viewport falls back to normal flow until a real range exists.
Selecting an expanded registered face applies its weight, style, PostScript
metadata, and canonical `fontReference` together; variable-font named
instances are real `fvar` records and apply their declared coordinates without
inventing a face. Choosing a family row clears an older exact reference instead
of leaving stale identity attached to new text.

## Readiness boundary

The useful capabilities are distinct: catalog presence, stored bytes, a
validated face, main-thread readiness, worker adoption, shaping/export
support, and operation permission. A face is not “ready” merely because its
family name is present. Byte-backed loads publish a local blob-backed
`@font-face` rule so the worker can harvest the exact payload without a
network request. Worker font assets still need an adoption acknowledgement
before worker rendering can reuse them; otherwise the main-thread replay
   remains authoritative. Package export sets `bundled` only after writing
   verified bytes into `fonts/`. Export requests carry a document's exact
   `fontReference`, so same-family artifacts and collection members remain
   separate; an unavailable requested member is never silently replaced by a
   different family artifact. Full cache identity across face revision, axes,
   features, language and rich runs remains an integration requirement, not
   established by the family bridge.

## Compact editing surfaces

The inspector, contextual text bar, floating text toolbar, and Logo wordmark
panel use the same family picker model. The contextual bar exposes family,
weight, and size commands directly below the menubar, with 32px compact
controls and a horizontal overflow boundary instead of shrinking a family
field to an unreadable label. The floating toolbar uses the main floating
palette's spacing, surface and shadow tokens, with 32px compact controls,
consistent field typography and a separate More panel for alignment and lists.
Its independently anchored font menu remains inside the viewport. Escape has an
explicit precedence: an open family picker
closes first without committing the search; a subsequent Escape exits text
editing. The size field commits its draft on blur or Enter; Escape discards an
unfinished draft. Family, weight, and size changes from the contextual and
floating bars use the shared range/caret command adapter. The inspector and
toolbar weight controls share the same variable-font `wght` update path,
preserving unrelated authored axes.
Presentation-only hover preview is not integrated yet.

The full browser's license details view exposes the base embedding right,
no-subsetting and bitmap-only declarations as separate rows, plus whether the
font actually declares license provenance. This keeps a technical file flag
from reading like a legal assurance and gives export preflight a stable reason
to block an unsupported operation.

Moving focus from typing to the quick toolbar first flushes pending text and
closes the typing transaction, while keeping the editing surface mounted.
The next formatting choice therefore gets its own undo entry. The pointer
regression verifies typing followed immediately by Bold, Undo and Redo; the
shared command adapter also routes family, weight, and size changes from the
contextual bar to an active rich-text range or collapsed caret.

The inspector gives the family picker a full-width row with one label and a
32px Browse button. Line height and letter spacing use separate shared numeric
rows so their names and units remain visible at minimum panel width. Alignment
choices stay on one row. These scoped styles do not change other inspector
sections. Rich-text operations preserve inherited character-style links when
splitting, replacing and clearing runs; compact family, weight, and size
controls use the shared range/caret command adapter. The inspector's broader
mixed-value and style-editing paths remain separately covered by its own
selection tests.

Selection-anchored quick bars use the same compact control height, interface
type scale, surface padding, gap, and horizontal overflow boundary as the main
floating palette. This keeps contextual actions on one centerline with the
font toolbar at wide, narrow, and coarse-pointer sizes; the bar's placement
still flips above a selection when the canvas safe area has no room below.

Document Fonts keeps selection and navigation separate: **Select** selects all
matching visible layers in the current scope, while **Go to** selects the first
matching layer, activates its publishing page when needed, and centers it in the
viewport. This makes cross-page results explicit instead of silently changing
the current canvas. Hidden and locked layers remain excluded from both actions.

The Logo wordmark controls use the same picker and an explicit Browse fonts
dialog. Choosing a family clears an older exact reference; choosing a
registered face applies its family, weight, style, and reference together.
Weight and style are available directly in the Logo panel so wordmarks do not
fall back to a family-only text field.

Ordinary weight menus are registry-backed across the inspector, contextual bar,
floating text toolbar, and Logo panel. Static families expose only the weights
registered for the selected style. Variable families expose their declared
`wght` range at the familiar stops plus the real minimum, default, and maximum;
other axes remain untouched. A legacy value outside the selected face is kept
as a disabled option with an explanation, so opening a document does not hide
or silently synthesize its requested weight. The floating **Bold** action is
disabled when a real 700 face or in-range variable value is unavailable, while
an existing legacy bold value can still be turned off.

The image **Identify Font** panel bounds decoded image data to a 2048px edge,
passes the live registry projection and local render comparison into the
detection pipeline, and accepts optional recognized text to improve matching.
Because an image selection is not a text target, a candidate action is labelled
**Use for new text**: it stores a pending family/reference and activates the
Text tool. Arbitrary transformed crop selection, OCR-assisted region overlays,
and applying a result to an existing text target remain separate work.

## Research-derived UX constraints

The 2026-09-12 comparison of Figma, Photoshop, Illustrator, InDesign, and
Affinity is recorded in the [font and typography UX research
note](../research/font-typography-ux-research-2026-09-12.md). It turns recurring
product complaints into runtime constraints:

- Discovery and commitment are separate. Search, hover, and keyboard movement
  stay local and synchronous; preview and installation are explicit, bounded
  operations.
- A family label is never proof of an available face. The UI exposes source,
  exact face, version/conflict, permission, stored-byte, and readiness states
  and keeps a missing or substituted request visible until the user resolves
  it.
- Replacement always names its scope and affected locations. The default
  Document Fonts/Select by Font scope is the current page, with inherited,
  linked, and component text included and hidden or locked content excluded.
  A replacement is previewable, one undo transaction, and reversible.
- Variable controls show only supported axes. Weight updates `wght` when
  present and preserves other authored axes; mandatory shaping features and
  rich-run settings remain part of the layout identity.
- Technical embedding flags and source-license provenance remain separate.
  Export claims are made only after exact bytes are verified and written.
- Image identification is reviewable and local: bounded transformed regions,
  confidence/model metadata, explicit text targets, cancellation on target
  change, and manual entry when recognition is unavailable.

These constraints guide new frontend work and are acceptance criteria for the
remaining Document Fonts, image-identification, and native platform slices.

## Evidence and open platform work

The parser and identity corrections are recorded in
[`font-system-audit-2026-09-09.md`](../audits/font-system-audit-2026-09-09.md).
Focused Chromium interactions verify nested Escape and empty-layer cleanup.
Intermediate screenshot inspection caught an empty portaled virtual list and
overflowing toolbar controls. The subsequent density review found mismatched
40px fields and 32px buttons; cross-component browser measurements now guard
control alignment, field typography, outer padding, gaps and surface styling.
See the [toolbar evidence log](../audits/font-toolbar-evidence-2026-09-10.md)
for inspected captures and the precise validation scope. Linux
native/WebKitGTK evidence is still pending for the embedded desktop lane;
Windows WebView2 and macOS WKWebView require their platform environments.
Collaboration currently has portable asset descriptors only; live font
transport is outside this implementation.
