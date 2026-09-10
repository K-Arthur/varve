# Font system architecture

This is the current authority for font identity, discovery, persistence, and
typography readiness. It complements the shaping and geometry details in
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

An exact face is identified by the SHA-256 of the original artifact, an
optional collection member, and the PostScript name. The runtime key is
`sha256:<digest>:<member>` plus the PostScript face discriminator. Display
family, version, source, and license are metadata and never replace the hash.
WOFF reconstruction keeps the original artifact hash. A text node,
character format, text style, and v2 font manifest entry may carry
`fontReference`; legacy `fontFamily`, weight, and style fields remain readable.

Variation axes and OpenType features remain authored presentation settings.
Changing the ordinary weight control updates `wght` when that axis exists;
custom axes and mandatory shaping features are preserved separately.

## Persistence and recovery

Browser artifacts use the versioned IndexedDB store. Desktop startup prefers
the native filesystem store, verifies the recorded hash before registration,
and falls back to IndexedDB when the native directory is unavailable. A
failed or corrupt record is counted and skipped; it cannot block opening the
document. Legacy stores are rehashed into content-addressed records, while
unknown metadata remains unknown. Removal is exact-face work and must not
re-import a deleted family during migration.

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
verified bytes into `fonts/`. Layout caches include face revision, axes,
features, language, and rich runs.

## Evidence and open platform work

The parser and identity corrections are recorded in
[`font-system-audit-2026-09-09.md`](../audits/font-system-audit-2026-09-09.md).
Focused Chromium captures verify the compact toolbar menu is visible after a
font field click and that an untouched text node is removed on Escape. Linux
native/WebKitGTK evidence is still pending for the embedded desktop lane;
Windows WebView2 and macOS WKWebView require their platform environments.
Collaboration currently has portable asset descriptors only; live font
transport is outside this implementation.
