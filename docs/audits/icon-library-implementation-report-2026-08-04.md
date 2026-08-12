# Icon Library — Implementation Report (2026-08-04)

Companion docs: `docs/architecture/icon-library.md` (current-state
architecture), `docs/architecture/icon-system.md` (ADR-0006, updated),
`docs/architecture/icon-system-audit-2026-08-02.md` (historical evidence).

## 1. Executive summary

Varve's user-facing icon library was rebuilt from a dead-code dialog into a
production icon workflow: verified Iconify API integration (correct
endpoints, schemas, hosts), a provider contract with structured errors and
capability flags, one-action acquisition (cache → fetch → sanitize → store
→ insert), a first-class Icons panel with virtualized grid and pack
manager, a reviewed SPDX licence policy with attribution reports, an
offline starter pack, and hardened SVG sanitization. The feature works end
to end in the browser and in packaged-Tauri security conditions (CSP
allowlist + regression test), offline, and across save/reload.

## 2. Root causes found (all verified against the live API and code)

| Symptom | Environment | Request | Failure layer | Root cause | Fix | Regression test |
|---|---|---|---|---|---|---|
| Search returns nothing | browser + Tauri | `GET /search` | provider registry | `createIconifyProvider()` was never called anywhere in app code — registry empty; zero results returned silently | `ensureIconProviders()` bootstrap; empty registry throws `registry-empty` | `iconProviders.test.ts`, E2E "actionable failures" |
| Search fails in packaged app | Tauri | `GET /search` | CSP | `connect-src` lacked the Iconify hosts | Allowlisted exactly the 3 hosts (csp + devCsp) | `tests/unit/csp-icon-providers.test.ts` |
| SVG fetch 404 | browser | `GET /svg?prefix=&icon=` | endpoint | Legacy route removed upstream (404); modern `/prefix/icon.svg` required | Rewrote client/provider to the documented routes | `iconifyClient.test.ts` |
| Categories empty | browser | `GET /categories` | endpoint | Route does not exist on the public API (404) | Categories derived from collection metadata | `iconifyProvider.test.ts` |
| Licence/author metadata missing | browser | `GET /search` | schema | Code read `data.info`; the API returns `collections` | Parsed `collections` with runtime validation | `iconifyClient.test.ts` fixtures |
| Keywords 400 | browser | `GET /keywords?query=` | endpoint | Parameter must be `keyword=` | Fixed param + validation | `iconifyClient.test.ts` |
| Cancellation ignored | browser | fetch | threading | `AbortController` created but signal never passed to `fetch` | Signals threaded through client/provider/registry/acquisition | `iconifyClient.test.ts`, `iconAcquisition.test.ts` |
| Two-step insert | browser | — | UX | Insert disabled until a separate download completed | One-action `acquire()` command path | E2E "one-action insert" |
| `providerId` wrong | cache | — | model | Pack prefix stored as provider id | Canonical ids `provider:pack:name`; migration of legacy keys | `iconStorage.test.ts` |
| Batch alias icons missing | browser | `GET /{prefix}.json` | schema | Aliases (`settings`→`cog`) not resolved; client dropped the aliases map | Alias-chain resolution in the provider | `iconifyProvider.test.ts` |
| Unbounded cache | cache | — | storage | No budget/eviction | 50 MiB budget, LRU, pinned/favourite protection | `iconStorage.test.ts` |
| Sanitizer gaps | browser | — | security | `style` kept verbatim; `data:` URLs; external `url()` in paint servers; use/symbol cycles; non-finite numbers | Hardened per §5 of the architecture doc | `svgSanitize.test.ts` attack fixtures |
| Preview retry storm | browser | `GET /{prefix}.json` | UI | Same-range callbacks refetched; null-resolved batches never settled | In-flight set + failed-id exemption | E2E stability |
| Silent all-provider failure | browser | search | registry | Per-provider errors swallowed when every provider failed | All-failed → structured error | `iconProviders.test.ts` |

## 3. Architecture before and after

**Before:** raw `fetch()` calls in `iconifyProvider.ts` against legacy
endpoints with wrong schema keys; a registry nothing ever registered; a
two-step download-then-insert dialog reachable only from the Layers panel;
unbounded IndexedDB cache; `providerId = pack prefix`; no licence policy;
sanitizer gaps; no pack management, attribution, or offline content.

**After:** layered engine (client → provider → contract → licence →
sanitizer → catalogue) feeding an editor-side acquisition service
(one-action, cancellable, budgeted, batched) behind the Icons panel
(Resources tab, virtualized grid, details, pack manager) and the scene
model (embedded sanitized SVG + full provenance, content-addressed,
attribution reports). See the architecture doc for the full diagram.

## 4. Files added, changed, removed

- **Engine (`packages/engine/src/icon/`)** — added: `iconifyClient.ts`,
  `iconCatalogue.ts`, `ensureProviders.ts`, `__fixtures__/` (7 verified
  fixtures), `iconifyClient.test.ts`, `iconifyProvider.test.ts`.
  Rewritten: `iconifyProvider.ts`, `iconProviders.ts` (+test).
  Extended: `iconLicence.ts` (policy table, snapshots, trademark),
  `svgSanitize.ts` (hardening, `rewriteSvgIds`), `index.ts`.
- **Scene** — added: `iconAttribution.ts` (+test). Extended:
  `iconAsset.ts` (provenance), `index.ts`.
- **Editor** — added: `IconBrowser/IconGrid.tsx`, `IconDetailsPanel.tsx`,
  `IconDiscoverySections.tsx`, `SafeSvg.tsx`, `iconAcquisition.ts`
  (+test), `recents.ts`, `PackManager.tsx` (+css), `iconStorage.test.ts`,
  `ResourcesPanel/` (panel + css). Rewritten: `IconBrowser.tsx` (+css),
  `useIconSearch.ts`, `iconStorage.ts`, `IconBrowserDialog.tsx`,
  `IconBrowserDialog.test.tsx`, `IconSection.tsx`. Removed:
  `iconDownloadManager.ts`. Updated: `useIconAssets.ts`, `Shell.tsx`
  (1:1 import swap), `CanvasArea.tsx` (drop handler), `actions/*`,
  `ShortcutManager.ts`, `menu/defs.ts` + `localization.ts` + snapshot,
  `menuSnapshot.test.ts.snap`.
- **Apps** — `apps/desktop/src-tauri/tauri.conf.json` (CSP),
  `apps/desktop/public/packs/starter-pack.json` (generated).
- **Root** — `scripts/generate-starter-pack.mjs`, `THIRD_PARTY_NOTICES`,
  `tests/unit/csp-icon-providers.test.ts`,
  `tests/e2e/icons/icon-library.spec.ts`,
  `docs/architecture/icon-library.md`, `docs/architecture/icon-system.md`.

## 5. Provider and pack support matrix

| Pack | Prefix | Licence (verified 2026-08-04) | Group |
|---|---|---|---|
| Material Symbols | material-symbols | Apache-2.0 | General UI / Platform |
| Material Design Icons | mdi | Apache-2.0 | General UI |
| Lucide | lucide | ISC | General UI |
| Phosphor | ph | MIT | General UI |
| Tabler Icons | tabler | MIT | General UI |
| Heroicons | heroicons | MIT | General UI / Platform |
| Fluent UI System Icons | fluent | MIT | Platform |
| Carbon Icons | carbon | Apache-2.0 | Platform |
| Bootstrap Icons | bi | MIT | General UI / Platform |
| Remix Icon | ri | Apache-2.0 | Platform |
| Radix Icons | radix-icons | MIT | General UI |
| Iconoir | iconoir | MIT | General UI |
| Simple Icons (brands, trademark caveat) | simple-icons | CC0-1.0 | Brands |

Provider registered: Iconify (search, browse collections/collection,
icon data, SVG, keywords, update checks, licence metadata, batching,
multicolor).

## 6. Platform capability matrix

| Capability | Browser | Tauri Linux (WebKitGTK) | Windows (WebView2) | macOS (WKWebView) |
|---|---|---|---|---|
| Online search/insert | verified (E2E) | CSP allowlist verified by test | config-equivalent | config-equivalent |
| Offline cache + starter pack | verified (E2E) | same IndexedDB path | same | same |
| Custom SVG import | verified | same | same | same |
| Canvas drag-drop | HTML5 (verified path) | Tauri native event path | HTML5 | HTML5 |

Physical verification was performed on Linux (browser dev server + Playwright
Chromium). Windows/macOS were validated through the production-CSP test
(config parity), the platform abstraction, and WebKitGTK/WebView2/WKWebView
behavior notes — no physical devices available.

## 7. Security changes

Sanitizer hardening (style allowlist/blocklist, `data:` rejection,
external `url()` removal, non-finite numbers, viewBox validation,
use/symbol cycle graph, 1 MiB input cap, `rewriteSvgIds` for ID
collisions); `SafeSvg` re-sanitizes at render; sanitization at every trust
boundary (fetch, batch, starter pack, import, cache read, insertion);
CSP allowlists exactly three hosts in csp + devCsp with an automated
regression test; no script/frame/object expansion.

## 8. Licensing and attribution changes

SPDX parsing through a reviewed policy table; unknown licences surfaced as
unverified with no asserted permissions; trademark caveats for brand packs;
commercial/attribution/unknown filters; per-document attribution inventory
+ plain-text and Markdown reports (Icons panel "Attribution report",
inspector provenance); `THIRD_PARTY_NOTICES` updated for the bundled
starter pack (MDI Apache-2.0, Lucide ISC).

## 9. Storage and offline behavior

IndexedDB v2 (canonical ids, migrations from v1 and legacy names,
favourites from localStorage), 50 MiB budget with LRU + pinned/favourite
protection, per-pack stats, integrity scan/rebuild, pack manager
(download/cancel/incremental/update-check/remove/custom import), bundled
starter pack (78 icons, ~21 KiB, deterministic build-time generation,
zero-network install). Design choice: IndexedDB on all platforms for
browser/desktop parity; Tauri app-data migration deferred.

## 10. UI/UX changes

Resources panel with Libraries + Icons tabs; Icons tab: search header with
connection indicator and density toggle, source/licence/style/palette/
type filters, virtualized grid with dynamic-column keyboard navigation,
discovery sections (recents/favourites/downloaded/curated packs), details
panel with full provenance, trademark and licence warnings, pack manager,
actionable error/empty/offline states. Entry points: toolbar/panel,
File → Insert Icon…, command palette, Ctrl+Alt+Shift+I, Layers panel
button, inspector Replace…, canvas drag-and-drop.
Screenshots (captured 2026-08-04, Playwright Chromium 1440×900):
`/tmp/opencode/icon-screens/01-panel-default.png`,
`02-search-results.png`, `03-details-panel.png`, `04-pack-manager.png`,
`05-error-state.png`.

## 11. Performance measurements

- E2E timings (dev build, mocked API, Chromium): panel open + first
  search results < 3 s; one-action insert (uncached) < 2 s; pack install
  with progress ~10 s for 78 starter icons; error-state surfacing after
  all-hosts failure < 2 s (elapsed-based backoff).
- Memory/perf budgets implemented: virtualized grid (only visible rows
  mounted), previews fetched only for visible range, batched by pack,
  in-flight dedup, concurrency cap (4), failed-id exemption, metadata
  indexes for local search, pack processing chunked with event-loop
  yields. Formal 4 GB-class memory profiling and the `.bench.ts`
  harnesses were not run in this session (deferred; see §14).

## 12. Tests run and outcomes

- Engine icon suite: 128 passed (client endpoints/URLs/batching/fallback/
  timeout/cancel/retry/circuit; provider mapping; registry lifecycle;
  licence policy; sanitizer attack fixtures; attribution).
- Engine full: 3158 passed. Scene icon suites: 15 passed.
- Editor (icon + actions + shortcuts + menu + resources + context):
  5391 passed (targeted); full editor suite passes except
  load-sensitive perf/timing tests that pass standalone (pre-existing).
- E2E (Chromium, mocked API): 4/4 passed — one-action insert into the
  document; offline restart with cached icons; offline starter-pack
  install; actionable network failures.
- Production-CSP unit test: 5/5 passed. Audits: emoji 0, docs 0, tokens
  123/123, architecture no layer violations, health gate passed.
- Known pre-existing (not from this work): `pnpm lint` reports
  `noArrayIndexKey` errors in untouched files; e2e typecheck fails on
  `tests/e2e/crash/*` from concurrent uncommitted crash/privacy work.

## 13. Commit list

- `c9c7900a` feat(icons): verified Iconify client, provider contract,
  one-action insertion, and first-class Icons panel
- `1d4940de` feat(icons): pack manager, starter pack, attribution
  reports, offline E2E
- `0e25707e` fix(icons): restore ResourcesPanel imports and drop the
  now-unused onInsertIcon prop

## 14. Remaining limitations

- Single provider (Iconify) registered; contract is provider-neutral.
- Per-icon style variant switching and full override editing (per-instance
  fill/stroke beyond `currentColor`) are not document features yet;
  monotone recolouring works via `currentColor`.
- Custom imported packs live in the cache, not the document.
- Formal benchmark-mode performance runs (`.bench.ts`, 4 GB-class memory
  profiling) and physical Windows/macOS verification were not performed in
  this session; the capability matrix for those platforms rests on config
  parity tests and the platform abstraction.
- The web-build save flow still downloads the document (pre-existing
  platform behavior); the E2E persistence coverage relies on scene codec
  tests plus the offline-cache test.
