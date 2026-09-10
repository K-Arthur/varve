# Font provider migration audit — 2026-08-31

Status: implementation in progress. This audit records the pre-migration
runtime evidence and the target boundaries for the Fontsource-first provider
architecture.

## Confirmed findings

| Current component | Responsibility | Authoritative state | External requests | Provider IDs / cache key | Defect |
| --- | --- | --- | --- | --- | --- |
| `useOnlineFontSearch.ts` | Search provider adapters and download orchestration | React state split into Google and Fontsource result arrays | Debounced search calls both providers after two characters | Family name; download provider inferred from URL text | Search is remote, Google is still a registered path, and structured face/version data is discarded |
| `FontsourceProvider` | Metadata search, details, and download URL construction | Private in-memory response cache | `/v1/fonts`, family detail requests | Family ID only; download URL uses `5.x` and the variable package for every face | Assumes an obsolete detail shape and emits floating, sometimes incorrect artifact URLs |
| `GoogleFontsProvider` | Legacy metadata and CSS URL adapter | API key constructor argument | Google Web Fonts API and CSS API | Family string | Ordinary callers can construct it without a key; it is not compatible with the local-first product decision |
| `FontDownloadManager` | Queue, fetch, parsing, and progress | In-memory jobs | Arbitrary URL passed by caller | Job URL and family name | Redirect hosts, MIME/signature policy, and expected face identity are not enforced at the transport boundary |
| editor `fontStorage.ts` | Browser persistence | IndexedDB `varve-font-storage` | None | `familyName` object-store key | Different weights, styles, subsets, versions, and files collide |
| engine `fontStorage.ts` / `fontStorageFs.ts` | Engine/browser and Tauri storage adapters | IndexedDB or Tauri filesystem | Tauri IPC when available | Family only | Metadata and bytes cannot represent canonical artifact identity; the two stores are not reconciled |
| `FontLoader` | `FontFace` registration and registry notification | In-memory family map plus `document.fonts` | URL loading path can fetch | Family only | A loaded binary is registered as bundled and only inferred subfamily metadata is retained |
| `FontRegistry` | Existing editor-facing family registry | Registry entries and revision | No direct request | Family + weight/style in entries | It is the runtime registry, but the modern catalog and downloaded-font store are not one reactive source |
| `FontCatalog` / manifest | Parsed local font metadata and document manifest | Parsed `FontIdentity` entries | None | Content hash + PostScript name | It is sound for parsed binaries but has no provider-neutral offline family catalog or artifact resolver |
| browser demo | Capability gating | `onlineFonts` restriction | None in the demo CSP | N/A | Copy says online fonts are unavailable, but the selector still owns a live remote search path |
| Tauri CSP | Network policy | `tauri.conf.json` | Google, model, icon, and other hosts | N/A | Google host remains solely for the retired provider; Fontsource binary host is not explicitly represented |

## Verified Fontsource contract

The official Fontsource API currently documents:

- `GET https://api.fontsource.org/v1/fonts` as an array whose family records
  contain `id`, `family`, `subsets`, `weights`, `styles`, `defSubset`,
  `variable`, `lastModified`, `category`, `version`, `license`, and `type`.
- `GET /v1/fonts/{id}` as a detailed family object. Its `variants` value is a
  nested object keyed by weight, style, and subset, with `url` objects for
  `woff2`, `woff`, and `ttf` files. The response also includes `unicodeRange`,
  `npmVersion`, and license/source metadata in the current live response.
- `GET /v1/variable/{id}` as `{ family, axes }`; each axis has `default`,
  `min`, `max`, and `step` values (the live API serializes these values as
  strings, despite the documentation table describing numeric values).
- `GET /v1/version/{id}` as exact static and variable package-version lists.
- Fontsource’s documented immutable CDN form is
  `https://cdn.jsdelivr.net/fontsource/fonts/{id}@{version}/{subset}-{weight}-{style}.woff2`
  for static assets and
  `https://cdn.jsdelivr.net/fontsource/fonts/{id}:vf@{version}/{subset}-{axes}-{style}.woff2`
  for variable assets. `@latest`, major-only, and minor-only URLs are not
  acceptable persisted asset identities.

Representative live responses were inspected on 2026-08-31 for `inter`, its
variable axes, and its package-version history. CI will use sanitized fixtures;
live contract checks remain maintainer-invoked so ordinary builds do not depend
on a third-party service.

## Target state

The migration separates six responsibilities:

1. A generated, versioned Fontsource catalog ships with the app and supports
   search/filter/detail discovery without network access.
2. An artifact resolver converts a structured family/face/subset request into
   exact, allowlisted, version-pinned descriptors.
3. A transport downloads only an explicit artifact plan and validates HTTPS,
   redirects, size, content type, and cancellation.
4. A canonical font store persists bytes and metadata by content hash plus face
   identity, using IndexedDB in the browser and the Tauri filesystem on
   desktop.
5. The runtime loader parses, validates, registers, and publishes one final
   font revision after a logical installation.
6. Document resolution treats old Google/remote values as legacy provenance;
   opening a document never triggers an automatic replacement download.

The public demo remains capability-gated: catalog discovery is local and
available, while additional binary downloads are disabled and explain why.

## Sources

- [Fontsource Fonts API](https://fontsource.org/docs/api/fonts)
- [Fontsource Font ID API](https://fontsource.org/docs/api/font-id)
- [Fontsource Variable API](https://fontsource.org/docs/api/variable)
- [Fontsource Version API](https://fontsource.org/docs/api/version)
- [Fontsource CDN URL formats](https://fontsource.org/docs/getting-started/cdn)
