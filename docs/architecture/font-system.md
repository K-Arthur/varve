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
The ordinary weight control must update `wght` when supported and preserve
custom axes and mandatory shaping features. Existing hardcoded weight controls
still need this integration.

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
selectable faces when no corresponding artifact is installed.

## Readiness boundary

The useful capabilities are distinct: catalog presence, stored bytes, a
validated face, main-thread readiness, worker adoption, shaping/export
support, and operation permission. A face is not “ready” merely because its
family name is present. Byte-backed loads publish a local blob-backed
`@font-face` rule so the worker can harvest the exact payload without a
network request. Worker font assets still need an adoption acknowledgement
before worker rendering can reuse them; otherwise the main-thread replay
remains authoritative. Package export sets `bundled` only after writing
verified bytes into `fonts/`. Full cache identity across face revision, axes, features, language and rich
runs remains an integration requirement, not established by the family bridge.

## Compact editing surfaces

The inspector and floating text toolbar use the same family picker model. The
toolbar uses the main floating palette's spacing, surface and shadow tokens,
with 32px compact controls, consistent field typography and a separate More
panel for alignment and lists. Its independently anchored font menu remains
inside the viewport. Escape has an explicit precedence: an open family picker
closes first without committing the search; a subsequent Escape exits text
editing. The size field commits its draft on blur or Enter; Escape discards an
unfinished draft. Range/caret targeting still requires the shared typography
command adapter.
Presentation-only hover preview is not integrated yet.

The full browser's license details view exposes the base embedding right,
no-subsetting and bitmap-only declarations as separate rows, plus whether the
font actually declares license provenance. This keeps a technical file flag
from reading like a legal assurance and gives export preflight a stable reason
to block an unsupported operation.

Moving focus from typing to the quick toolbar first flushes pending text and
closes the typing transaction, while keeping the editing surface mounted.
The next formatting choice therefore gets its own undo entry. The pointer
regression verifies typing followed immediately by Bold, Undo and Redo; it
does not establish the still-pending rich-range command adapter.

The inspector gives the family picker a full-width row with one label and a
32px Browse button. Line height and letter spacing use separate shared numeric
rows so their names and units remain visible at minimum panel width. Alignment
choices stay on one row. These scoped styles do not change other inspector
sections. Rich-text operations preserve inherited character-style links when
splitting, replacing and clearing runs; the ordinary toolbar still needs the
range/caret command adapter.

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
