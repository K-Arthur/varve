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

The target exact-face key is `sha256:<digest>:<member>`: original artifact
bytes and collection member. PostScript names are metadata. The current
`fontIdentityKey` still includes the PostScript name; compatibility adapters
and runtime aliases remain to be integrated. Display
family, version, source, and license are metadata and never replace the hash.
WOFF reconstruction keeps the original artifact hash. A text node,
character format, text style, and v2 font manifest entry may carry
`fontReference`; legacy `fontFamily`, weight, and style fields remain readable.

Variation axes and OpenType features remain authored presentation settings.
The ordinary weight control must update `wght` when supported and preserve
custom axes and mandatory shaping features. Existing hardcoded weight controls
still need this integration.

## Persistence and recovery

Browser artifacts currently use IndexedDB database `varve-font-storage-v2`,
version 1. Its legacy migration lacks a durable journal and removal tombstones;
it can reimport removed fonts on restart. Native storage is still keyed by
family and can overwrite another face. Both require artifact/face records,
original-byte integrity checks, atomic migration recovery and exact removal.

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
