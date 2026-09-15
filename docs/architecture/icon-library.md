# Icon Library — Architecture and Operations (2026-08-04)

Status: current-state documentation for the user-facing icon library
(Milestones 1–6 of the unified icon-system initiative, implemented
2026-08-04). Supersedes the architecture audit of 2026-08-02
(`docs/architecture/icon-system-audit-2026-08-02.md`), which is now
historical evidence.

This document covers the **user-inserted document icons** system only.
It does not cover:

1. **Internal Varve UI icons** — `packages/ui/src/icons/` (Lucide/Phosphor
   wrappers, semantic registry). Feature code must not import third-party
   icon libraries directly.
2. **Application/installer icons** — `apps/desktop/src-tauri/icons/` and
   `apps/desktop/public/icons/`, generated from `varve-app-icon.svg`.
3. **Logo-workspace export icons** — `packages/scene/src/logo/`.

## 1. System overview

Designers browse free/open icon collections, preview icons, insert them
into documents (one action, online or offline), replace them without
losing geometry, cache packs for offline use, and export projects with
licence metadata.

```
┌────────────────────────────┐      ┌───────────────────────────────┐
│ Icons panel / quick dialog │      │  Iconify public API (3 hosts) │
│  (React, editor package)   │      │  api.iconify.design          │
└──────────┬─────────────────┘      │  api.simplesvg.com (backup)  │
           │                        │  api.unisvg.com (backup)     │
           ▼                        └──────────────┬────────────────┘
┌──────────────────────────┐   fetch (timeouts,    │
│ IconAcquisitionService   │◄──── retry, circuit,  │
│  cache→fetch→sanitize→   │        validation)    │
│  store (one action)      │                       │
└──────┬───────────────────┘                       │
       │ sanitized SVG + provenance                │
       ▼                                           │
┌──────────────────────────┐                       │
│ useIconAssets            │  IconifyProvider      │
│  rewriteSvgIds → import  │  IconifyClient        │
│  pipeline → scene nodes  │  (engine package)     │
│  (one undo transaction)  │                       │
└──────┬───────────────────┘                       │
       ▼                                           │
┌──────────────────────────┐                       │
│ DocumentIconAsset        │  IconStorage (IDB)    │
│  embedded sanitized SVG  │  budget/LRU/pinned    │
│  + provenance (codec)    │  favourites/recents   │
└──────────────────────────┘                       │
```

### Layer boundaries

| Layer | Module | Responsibility |
|---|---|---|
| Network client | `packages/engine/src/icon/iconifyClient.ts` | HTTP: hosts, timeouts, abort, retry/backoff, circuit breaker, response validation, size limits, batching |
| Provider | `packages/engine/src/icon/iconifyProvider.ts` | Maps Iconify API to the provider contract (`IconSourceDescriptor`) |
| Provider contract | `packages/engine/src/icon/iconProviders.ts` | Capability flags, canonical ids, structured errors, registry lifecycle |
| Licence policy | `packages/engine/src/icon/iconLicence.ts` | SPDX parsing, reviewed policy table, unverified state, trademark caveats |
| Sanitizer | `packages/engine/src/icon/svgSanitize.ts` | Trust boundary for every SVG; ID rewriting for insertion |
| Catalogue | `packages/engine/src/icon/iconCatalogue.ts` | Curated, verified pack list and groups |
| Cache | `packages/editor/.../iconStorage.ts` | IndexedDB: v2 schema, budget, LRU, pinned/favourite protection, migrations |
| Acquisition | `packages/editor/.../iconAcquisition.ts` | One-action fetch/cache/sanitize/insert; batch prefetch; pack download |
| UI | `packages/editor/.../IconBrowser/` | Panel, grid, details, pack manager, discovery sections |
| Scene model | `packages/scene/src/iconAsset.ts`, `iconAttribution.ts` | Document assets + attribution inventory |

## 2. Identifiers

- **Canonical icon id** (stable across sessions): `provider:pack:name`
  e.g. `iconify:mdi:home`. Cache keys, favourites, and recents all use it.
- **Document asset id**: `icon-<safe-prefix>-<hash>` (deterministic,
  content-addressed; the same icon embeds once per document).
- Pack prefixes are never used as provider ids.

## 3. Iconify API integration

Verified against live responses on 2026-08-04 (see fixtures in
`packages/engine/src/icon/__fixtures__/`):

| Endpoint | Notes |
|---|---|
| `GET /search?query=&limit=&start=&prefix=&category=` | Collection metadata lives under `collections`, not `info` |
| `GET /collections?prefixes=a,b,c` | Catalogue metadata incl. `license.spdx` |
| `GET /collection?prefix=X&limit=&start=` | Icon names; categorized collections put names under `uncategorized` + `categories` |
| `GET /{prefix}.json?icons=a,b,c` | Batched icon data; aliases resolved through `aliases.parent` chains |
| `GET /{prefix}/{icon}.svg` | Modern single-SVG route (the legacy `/svg?prefix=&icon=` shape is 404) |
| `GET /keywords?keyword=` | Suggestions (`query=` param is invalid) |
| `GET /last-modified?prefixes=` | Timestamps wrapped under `lastModified` |
| `GET /version` | Health check |

`/categories` does **not** exist on the public API; categories are derived
from collection metadata (`category`, `tags`).

### Hosts and redundancy

Primary `https://api.iconify.design`; official backups
`https://api.simplesvg.com`, `https://api.unisvg.com`. The client prefers
the last-working host, suppresses hosts after `circuitFailureThreshold`
consecutive failures (30 s), retries only retry-safe failures (network,
timeout, 5xx) with elapsed-based backoff + jitter, and validates every
response before use. No user tracking: requests carry only API parameters.

### CSP requirements

Tauri must allow exactly the three hosts above in both `csp` and
`devCsp` (see `apps/desktop/src-tauri/tauri.conf.json`). The test
`tests/unit/csp-icon-providers.test.ts` fails the build if hosts drift or
a wildcard is introduced. No script/frame/object source was expanded.

## 4. Provider contract

`IconProvider` implementations declare `capabilities` explicitly
(`search`, `browse-collections`, `browse-collection`, `fetch-icon-data`,
`fetch-svg`, `batch-retrieval`, `keyword-suggestions`, `update-checks`,
`licence-metadata`, `multicolor`); the UI tests capabilities rather than
optional methods. Every provider returns `IconSourceDescriptor` objects —
never raw API payloads.

Structured errors (`IconProviderError`) carry machine-readable codes:
`network-error`, `timeout`, `cancelled`, `http-error`, `invalid-response`,
`response-too-large`, `csp-blocked`, `provider-unavailable`,
`icon-not-found`, `registry-empty`.

Lifecycle: `ensureIconProviders()` (engine) registers built-in providers
idempotently; `IconProviderRegistry.ensureProviders(fn)` runs the callback
once; `resetIconProviderRegistry()` is test-only. An empty registry throws
`registry-empty` — searches never silently return zero results.

## 5. Security model

Every remote or imported SVG is hostile input. `sanitizeSvg()` is the
single trust boundary and is applied at: remote fetch (acquisition),
batch prefetch, starter-pack install, custom SVG import, cache read
(SafeSvg re-sanitizes on render), and document insertion
(`useIconAssets` re-sanitizes + rewrites ids).

Hardening implemented 2026-08-04:

- Input size limit (1 MiB) before parsing.
- Inline `style` declarations are parsed; unknown/blocked properties and
  external `url(...)` references are removed (allowlist + blocklist).
- All `data:` URLs rejected; external `url()` refs in `clip-path`, `mask`,
  `fill`, `stroke` removed.
- Non-finite/out-of-range numbers in geometry attributes and `viewBox`
  rejected.
- Recursive `<use>`/`<symbol>` cycles detected via a reference graph.
- `rewriteSvgIds(svg, prefix)` gives every inserted icon collision-free
  fragment ids within a document.
- The UI renders third-party SVG only through `SafeSvg`, which re-sanitizes
  at render time; raw `dangerouslySetInnerHTML` is not used in feature code.

## 6. Licence policy

`resolveLicenceSnapshot` maps provider-reported SPDX ids through the
reviewed policy table (`ICON_LICENCE_POLICY`). Unknown SPDX ids are marked
`unverified` with **no asserted permissions** — never fabricated. Brand
packs (`simple-icons` etc.) carry a trademark caveat in the UI and are
flagged with `isBrandPack()`.

Filters: commercial-use OK, attribution required, unknown licence,
monotone/multicolour, general vs brand.

Attribution: `packages/scene/src/iconAttribution.ts` collects a
per-document inventory (`collectIconAttribution`) and renders plain-text
and Markdown reports. The Icons panel exposes "Attribution report"
(copies Markdown to the clipboard); `IconSection` shows licence, source,
and attribution requirements in the inspector.

## 7. Storage and offline packs

IndexedDB `varve-icon-storage` v2 (migrated from v1 and from the legacy
pre-2026 icon storage name; favourites migrate from localStorage). Records
are keyed by canonical id. Policy:

- Byte budget (default 50 MiB) with LRU eviction; pinned and favourited
  records are protected.
- Per-pack stats, integrity scan, rebuild, and clear-cache controls.
- Pack manager: browse curated catalogue, download with progress +
  cancel, incremental re-download, update check via `/last-modified`,
  remove pack, storage reporting, custom SVG import (multi-file, sanitized
  into the `custom` pack), and the bundled **starter pack**.
- The starter pack (`apps/desktop/public/packs/starter-pack.json`,
  ~21 KiB, 78 icons) is generated deterministically by
  `scripts/generate-starter-pack.mjs` from pinned versions and installs
  with zero network (licences Apache-2.0 + ISC; see THIRD_PARTY_NOTICES).

Design choice: the browser cache lives in IndexedDB (works on web and in
Tauri WebView). The desktop app keeps the same path for browser/desktop
parity; a future Tauri app-data migration is documented as deferred.

## 8. Document icon asset model

`DocumentIconAsset` (scene) stores the sanitized SVG snapshot + provenance
(canonical id, pack, author, source URL, SPDX id, licence URL,
attribution text, source version, retrieved at, sanitizer version,
palette type). All provenance fields are optional and backward compatible;
the codec validates them loosely and prunes unreferenced assets.

Insertion flow: acquire → sanitize → `rewriteSvgIds` → ImportService
converts to scene nodes → single undo transaction → asset deduplicated by
content hash → node selected. Replace preserves position, rotation,
transform, opacity, and effects (contain-fit + center). Detach converts
instances to plain editable nodes and prunes the asset only when
unreferenced.

## 9. UI behavior

- **Entry points**: Resources panel (Icons tab, dockable), File → Insert
  Icon… menu item, command palette, `Ctrl+Alt+Shift+I`, Layers panel
  "Insert icon from library" button, inspector "Replace…", canvas
  drag-and-drop, and pack-browse mode.
- **One-action insertion**: Insert / Enter / Space / double-click /
  drag all run `acquire()` (cache → fetch → sanitize → store → insert)
  as one operation; failures keep the surface open with an actionable
  error.
- **Search**: debounced, cancellable, normalized (case, punctuation,
  synonyms: trash/delete/bin, settings/gear/cog, user/account/person,
  arrow left/chevron-left/back …), paginated with the server-reported
  total, and applied consistently to online results and cached icons.
- **Grid**: virtualized (`@tanstack/react-virtual`), dynamic-column
  keyboard navigation (arrows/Home/End/PageUp/PageDown/Enter/Space),
  roving tabindex, `role="grid"`; previews are fetched only for the
  visible range, batched per pack, deduplicated in flight, with failed
  ids exempted from retry storms.
- **Details**: provenance, licence status, trademark warning, multicolour
  indicator, offline state, Insert/Favourite/Copy SVG/Download-Remove.
- **Error states**: registry-empty, offline-with-cached, offline-without,
  all-hosts-down, timeout, invalid response, icon removed upstream,
  sanitizer rejection, storage quota — each with an actionable retry.

## 10. Adding a new provider

1. Implement `IconProvider` in the engine (`kind`, `capabilities`,
   `search`, `getSvg`, optional `getIconData`/`getPacks`/`getPackIcons`/
   `getKeywords`/`getLastModified`).
2. Register it in `ensureProviders()`.
3. Add the provider's hosts to the Tauri CSP and the CSP test.
4. Add fixtures + unit tests (see `iconifyProvider.test.ts` for the
   pattern). Never unit-test live network.
5. If it is a curated pack, add verified metadata to `iconCatalogue.ts`.

## 11. Testing

- Unit: client endpoints/URLs/batching/fallback/timeout/cancel/retry/
  circuit (fixtures only); provider mapping; registry lifecycle; licence
  policy; sanitizer attack fixtures; storage budget/LRU/migrations;
  acquisition one-action path; attribution reports; scene codec.
- Integration/E2E (`tests/e2e/icons/icon-library.spec.ts`, Chromium,
  mocked API): online discovery → preview → one-action insert →
  document persistence; offline restart with cached icons; starter pack
  offline install; actionable network failures.
- Desktop security: `tests/unit/csp-icon-providers.test.ts`.

## 12. Platform support matrix

| Capability | Browser | Tauri Linux (WebKitGTK) | Tauri Windows (WebView2) | Tauri macOS (WKWebView) |
|---|---|---|---|---|
| Search/insert (online) | ✓ | ✓ (CSP allowlist) | ✓ | ✓ |
| Cache/offline (IndexedDB) | ✓ | ✓ | ✓ | ✓ |
| Starter pack (offline) | ✓ | ✓ | ✓ | ✓ |
| Custom SVG import | ✓ | ✓ | ✓ | ✓ |
| Canvas drag-drop | HTML5 | Tauri native events path unchanged | HTML5 | HTML5 |

WebKitGTK requires no unsafe CSP expansion; the allowed hosts are the
three Iconify hosts only (verified in the production-CSP test).

## 13. Known limitations and troubleshooting

- **Web save**: saving a new document in the browser build downloads the
  file (pre-existing platform behavior); the desktop build saves natively.
- **Single provider today**: only Iconify is registered. The contract and
  catalogue are provider-neutral; additional providers follow §10.
- **Style variants**: style suffixes are extracted heuristically
  (`-filled`, `-outline`, …) for display; per-icon variant switching is
  not yet a document feature.
- **Custom packs** are stored in the cache, not in the document; embed
  icons into the document before distributing the file.
- **Troubleshooting**: "Icon sources are not configured" → provider
  registration failed (check console); "security policy blocked" →
  CSP missing a host (run the CSP test); "icon no longer exists" → the
  icon was removed upstream; "cache is full" → pack manager → remove
  packs.
