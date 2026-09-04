# Font provider architecture

Varve treats font discovery, artifact delivery, and runtime registration as
separate responsibilities. The shipped catalog is the runtime source of truth;
the network is only an explicit desktop installation transport.

## Runtime flow

```text
fontsource-catalog.json
        │ local search / exact identity
        ▼
FontsourceCatalogStore ── resolve ──▶ version-pinned CDN artifact
        │                                      │ explicit install only
        │                                      ▼
        └──── reactive revision ◀──── download → validate → hash
                                               │
                                  shared IndexedDB artifact store
                                               │
                                  FontLoader + FontRegistry (Fontsource face)
```

The catalog is generated with `pnpm fonts:catalog` from the official
Fontsource metadata API. That maintainer-side command is the only metadata
refresh path. Runtime search is synchronous and local, so startup and typing
do not contact Google Fonts, Fontsource metadata, or any other provider API.

Each result carries the canonical Fontsource family id, display family,
available weights/styles/subsets, variable axes, license, upstream version,
and exact npm package version. Artifact resolution rejects unknown subsets,
weights, styles, non-variable requests, and non-exact versions. Runtime URLs
must be HTTPS `cdn.jsdelivr.net` URLs; redirects, unexpected MIME types, size
limits, font signature/parse failures, and optional SHA-256 mismatches fail the
job before it is persisted or registered.

## Persistence and migration

`packages/engine/src/font/fontStorage.ts` is the single browser/Tauri-webview
artifact store. Its key includes provider id, family id, package version,
weight/style, subset, variable/static kind, and content hash. Family name is
not a uniqueness key. The first access migrates records from the former
`varve-font-storage`, `varve-fonts`, and `strata-fonts` stores and hashes their
content. The editor module is only a compatibility re-export of this engine
store.

Document manifests retain canonical identity and missing/substituted status.
Opening an older document never triggers a download and never silently changes
the text family. A user may explicitly install a matching catalog artifact and
then resolve the manifest again. Restoring a persisted artifact preserves its
provider, weight, and style in `FontRegistry` and marks the matching local
catalog record installed; a reopened project therefore does not regress to a
generic user-font label or offer the same download again.

## Capability and UI contract

Search results are preview-only until installation succeeds. Installation is
the only operation that may fetch bytes; it persists and registers the face,
updates the catalog/registry revisions, and allows selector, canvas measurement,
and export consumers to observe the same state. Failed installation leaves the
previous selection intact and presents a user-facing error.

The browser demo exposes the shipped catalog and bundled fonts, but its
`onlineFonts` capability blocks additional downloads. Desktop CSP permits only
the explicit Fontsource CDN transport; the Google Fonts API origin is not
allowlisted.

## Missing-font recovery

The missing-font controller performs an identity-only lookup against the same
shipped Fontsource catalog. An exact family, canonical id, or declared alias may
offer installation; fuzzy and semantic search results never become an “exact”
action. The requested weight and style are resolved to the immutable artifact,
and the dialog labels any nearest-face fallback before the user acts.

Installation does not mutate the document when the canonical family name is
unchanged. Alias recovery updates the document to the canonical family in one
undoable replacement transaction so CSS and canvas lookup can resolve the
newly registered face. When there is no exact catalog identity, the dialog can
open the full semantic browser for a reviewed alternative while preserving the
existing local replacement controls.

WOFF2 metadata decompression is bounded. If the optional decompressor cannot
initialize in a browser or native webview within two seconds, parsing falls
back to its header metadata and the browser's `FontFace` parser remains the
final validity gate. A decompressor initialization failure must never leave an
explicit install permanently pending.
