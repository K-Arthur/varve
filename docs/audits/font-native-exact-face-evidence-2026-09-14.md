# Native exact-face loading evidence — 2026-09-14

The native font boundary now consumes the opaque handle returned by desktop
enumeration instead of falling back to `local(family)`. A document request
with a portable `sha256:<artifact>:<member>` reference is matched against the
registered face key. A stale handle or a missing exact entry reports an error
and leaves the family fallback path unused.

TTC/OTC artifacts are returned by the native command as their original bytes.
The runtime extracts the requested member into a standalone SFNT, validates
the collection header, member offset, table count, table spans, duplicate
tags, and a bounded extraction deadline, then registers that exact byte set
with `FontFace`. Single-face TTF/OTF artifacts are copied without changing
their bytes.

The document-face collector now carries `fontReference` through node defaults,
text styles, rich runs, and linked-story runs. Its readiness key includes the
artifact/member identity, so two same-family files cannot collapse into one
prefetch request.

An explicit local-font refresh now unregisters the previous native face keys
and opaque handles before publishing the new enumeration. Removing an OS font
while Varve is open therefore cannot leave a stale native face in the catalog;
the document keeps its authored reference and reports the next exact-face
load as unavailable until the user repairs or replaces it.

## Evidence

```text
pnpm exec vitest run packages/engine/src/font/fontParser.corpus.test.ts \
  packages/engine/src/fontRegistry.native.test.ts \
  packages/engine/src/fontRegistry.test.ts \
  packages/engine/src/font/fontNative.test.ts \
  packages/editor/src/canvas/useDocumentFonts.test.ts \
  --config vitest.config.ts --pool=threads --maxWorkers=1 --reporter=dot
5 files, 65 tests passed
```

The new native registry tests prove:

- a real Liberation TTC member is extracted and loaded from its opaque handle;
- a missing exact reference does not call `document.fonts.load` for the family;
- a stale native handle produces an error without attempting local-family
  fallback; and
- a refresh can remove a native face by its opaque handle without removing
  another same-family source; and
- the existing browser/native bridge contract remains nested as
  `load_system_font({ request: { handle } })`.

The corpus test parses the extracted member again and verifies its independent
family metadata (`Liberation Serif`), while a corrupted table span is rejected.
The commit hook reran the focused collector/parser/native tests (14 tests) and
passed Biome, emoji, health, import-boundary, secret, contacts, and impact
checks.

Native WebKitGTK, Windows WebView2, and macOS WKWebView still require their
platform lanes for restart, OS refresh/revocation, and native export proof;
this evidence does not promote those acceptance rows beyond their documented
Partial status.
