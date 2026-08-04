# Strata Icon System — Architecture Audit (2026-08-02)

Status: audit of the current icon architecture and implementation state,
gap analysis against the unified icon-system brief, and the migration plan
for the current milestone.

## 1. Existing icon sources

| Source | Location | Count / notes |
|---|---|---|
| Lucide (outline) | `packages/ui/src/icons/Icon.tsx` (only direct import site in apps) | `IconName = keyof typeof icons` |
| Phosphor (filled) | `packages/ui/src/icons/SolidIcon.tsx` (only direct import site) | curated `SolidIconName` union (~330 names) |
| Curated maps | `packages/ui/src/icons/index.ts` | `TOOL_ICONS`, `SOLID_TOOL_ICONS`, `CHROME_ICONS`, `SOLID_CHROME_ICONS` |
| Brand/wordmark SVGs | `packages/ui/src/icons/*.svg` | app icon, wordmarks (not UI affordances) |
| Iconify provider | `packages/engine/src/icon/iconifyProvider.ts` | public API, no key |
| Local cache | `packages/editor/src/components/IconBrowser/iconStorage.ts` | IndexedDB (`strata-icon-storage`, v1) |
| Scene icon asset model | `packages/scene/src/iconAsset.ts` | `DocumentIconAsset` — **not yet wired** |

### Duplicate systems / leakage

- Exactly **one** direct `lucide-react` import and **one** direct
  `@phosphor-icons/react` import exist in application code (both inside
  `packages/ui/src/icons/`). The ADR-0006 "no direct third-party imports in
  feature code" rule holds.
- However, feature code passes **raw third-party names** (e.g. `<Icon
  name="Search">`, `<SolidIcon name="Gear">`) — there is no *semantic* name
  layer. The curated maps exist but are used inconsistently (LayersPanel uses
  `SOLID_CHROME_ICONS`, Menubar/ToolPanel use raw names). This means a visual
  replacement still requires touching feature components.
- The `<Icon>` and `<SolidIcon>` primitives duplicate the same accessible-name
  contract (label → role=img, no label → aria-hidden) with different
  implementations; there is no single "icon" API for consumers.
- `packages/ui/src/icons/_backup_2026-06-30/` — stale backup directory.

## 2. Engine subsystem state (Phase 1 of ADR-0006, implemented 2026-07-27)

All modules under `packages/engine/src/icon/` with tests:

| Module | State | Notes |
|---|---|---|
| `svgSanitize.ts` (821 lines) | Implemented + tested (26 tests) | string-based parser, no DOMParser; dangerous tags/attrs stripped; resource limits (depth 32, 5k elements, 10k path cmds, 4 KB attrs); `allowImages=false` by default |
| `iconProviders.ts` | Implemented + tested | provider interface, registry, parallel search, dedupe, ranking hooks |
| `iconifyProvider.ts` | Implemented | search/getDetails/getSvg/getPrefixes/getCategories |
| `iconLicence.ts` | Implemented + tested | licence model, `canUseCommercially`, attribution report generator |
| `iconAudit.ts` | Implemented + tested | `auditIconSvg` / `auditIconCollection` |
| `iconExport.ts` | Implemented + tested | `exportIcon` (SVG/PNG/WebP/React/Vue/Svelte/Flutter/SwiftUI/AndroidVD/CSS) |
| `iconVariants.ts` | Implemented + tested | family/style/state typed variant model |

## 3. Editor subsystem state (Phase 2-3, partially implemented, UNWIRED)

`packages/editor/src/components/IconBrowser/`:

- `IconBrowser.tsx` — searchable grid (all/online/local/favourites), card
  previews, details panel, insert callback, keyboard grid navigation. **Not
  imported anywhere outside its own directory** — dead code.
- `iconStorage.ts` — IndexedDB cache. **Only consumer is IconBrowser.**
- `iconDownloadManager.ts` — download jobs with sanitize → store pipeline.
  **Only consumer is IconBrowser.**
- `useIconSearch.ts` — debounced provider search. **Only consumer is
  IconBrowser.**

## 4. Audit findings against the unified brief

### Consistency & semantics

- No semantic registry: feature code uses raw Lucide/Phosphor names. Same
  concept is rendered by different names across surfaces (e.g. `Trash2`
  vs `Trash`, `Settings` vs `Gear`, `SearchCode` vs `MagnifyingGlass`).
- `TOOL_ICONS` vs `SOLID_TOOL_ICONS` disagree on semantics (union/subtract
  use arrows, not Boolean-union glyphs) — outline and filled families do not
  always map to the same concept.
- Sizes are scattered (`14`, `16`, `18`, `20`, `1em`, `0.85em`) with no size
  tokens.
- No RTL mirroring support anywhere.

### Accessibility

- `<Icon>`/`<SolidIcon>` enforce the label/aria-hidden contract — good.
- `IconBrowser` cards: `aria-label="${name} icon"` on buttons — acceptable
  but duplicates the visible tooltip; `role="listbox"` with buttons (should
  be options or a grid; minor).
- The insert button in IconBrowser is disabled until SVG is downloaded but
  provides no loading/error status for failures (download failures are
  silent — `handleDownload` ignores errors).
- No focus-visible issues found in the primitives; menus/toolbars are covered
  by the concurrent Menubar focus work.

### Themes

- All UI icons use `currentColor` through Lucide/Phosphor wrappers — light/
  dark/high-contrast safe. The `applyCurrentColor` sanitizer helper exists
  for imported SVGs but is not used on the insertion path.
- IconBrowser previews render **raw sanitized SVG via
  `dangerouslySetInnerHTML`** — safe only because sanitization runs first;
  the sanitize step is not enforced at the preview boundary (a caller could
  feed an unsanitized local record).

### Import/export

- Insertion path exists only inside IconBrowser's `onInsert` callback; no
  surface passes real documents. No document icon asset model wiring.
- `iconExport.ts` exists but has no UI; `iconAudit.ts` exists but has no
  panel.
- `@varve/import` SVG parser is the right conversion path (used by
  paste/import flows) and produces scene nodes + documents; sanitization is
  **not** applied by the import pipeline itself — only the icon download
  manager sanitizes.

### Security

- Sanitizer is solid and tested. Gaps vs. brief: `style` attribute is kept
  verbatim (no CSS property filtering — `url(...)` in `fill: url(#g)` is
  common and fine, but `url(http://…)` in style is not stripped); `<use>`
  with `data:` URLs is rejected, external `href` in gradients is *kept*
  (gradient href to remote is a fetch risk — mitigated in practice by no
  remote render, but should be stripped for consistency); entity-expansion
  and recursive-`<use>` depth are bounded by the parser structure but
  recursion through `use → symbol → use` cycles is not explicitly detected.
- CSP: provider SVGs are rendered only after sanitization into local DOM
  (innerHTML of sanitized content); no `img-src`/`connect-src` widening
  found. Iconify API calls use `fetch` from the renderer (needs
  `connect-src https://api.iconify.design` in production CSP — verify).

### Licensing

- `iconLicence.ts` has a model + attribution report; the IconBrowser shows a
  licence string. But: `IconifyProvider.parseLicense` hard-codes
  `commercial: true` and `attributionRequired: true` for every set — wrong
  per-collection (MIT sets need no attribution). No licence filter in the
  browser. No export-time attribution warning.

### Storage & caching

- IndexedDB cache is unbounded (no max size, no eviction, no pinned packs).
- Favourites stored in `localStorage` (small — acceptable, but not durable
  across clearing).
- No offline icon packs (pack-level download/update/repair).
- Tauri storage path not used for icons (IndexedDB only — acceptable for
  browser, but native users get no app-dir cache).

### Performance

- `useIconSearch` debounces at 300 ms and aborts stale requests — good.
- IconBrowser renders every result card with inline SVG (`innerHTML`) — no
  virtualization; the Iconify API caps at 50 results per query, so current
  DOM cost is bounded, but local store growth (thousands of cached icons) is
  unbounded.
- No workers; sanitization of a large pack would block the main thread.
- `localStorage` favourites parse on every mount.

### Broken/missing icons, emoji, fonts, CSS images

- Zero emoji as functional icons (audited `SOLID_CHROME_ICONS`/`TOOL_ICONS`
  usage); one decorative `&#9654;` triangle in Menubar submenu arrows (CSS
  glyph, not an icon — acceptable, non-semantic).
- No icon fonts, no CSS background-image icons.
- No dynamic icon loading; all static imports (bundle-size risk at 14k
  icons in `lucide-react` — mitigated by tree-shaking through the wrapper).

## 5. Recommended package boundaries (unchanged from ADR-0006, refined)

| Package | Responsibility | Changes this milestone |
|---|---|---|
| `@varve/ui` | Icon primitives + semantic registry + size tokens | add `semantic.ts` (registry, validation, mirror, sizes) |
| `@varve/engine` | sanitize, providers, licence, audit, export, variants | keep; fix parseLicense conservatism; add style-URL stripping |
| `@varve/scene` | document icon asset model | wire `Document.iconAssets` + `NodeBase.iconAssetId` + codec validation |
| `@varve/import` | SVG conversion | unchanged (reused by insertion) |
| `@varve/editor` | browser UI, insertion, inspector, audit panel | wire IconBrowser, insertion hook, inspector section |

## 6. Migration strategy

1. **Semantic layer first** (no visual change): add `SemanticIconName`
   registry + `SemanticIcon` component; keep `<Icon>`/`<SolidIcon>` intact;
   migrate surfaces incrementally (toolbars → panels → dialogs).
2. **Document model second** (no UI change): `Document.iconAssets` +
   `NodeBase.iconAssetId` + codec validation, so documents can carry icon
   provenance with zero render impact.
3. **Insertion/editing third**: icon browser dialog → insert (embedded
   sanitized SVG), inspector controls (replace/detach/licence), persistence.
4. **Later milestones** (deferred, documented): online pack manager, icon
   creation workspace, audit panel UI, export dialog, provider settings,
   virtualized browser, worker-based sanitization.

## 7. High-contention files (concurrent work observed 2026-08-02)

| File | Who/What | Rule for this milestone |
|---|---|---|
| `packages/editor/src/Menubar.tsx` | concurrent focus-management work | read-only |
| `packages/editor/src/Shell.tsx` | hub file, import budget enforced | read-only; new surfaces mount from non-hub components |
| `packages/editor/src/context.tsx` | complexity ceiling 833/847 | add facade entries + one hook call only; logic in `context/useIconAssets.ts` |
| `packages/ui/package.json` | concurrent export additions | read-only |
| ColorPicker / strata-print files | staged + unstaged changes | read-only |

## 8. Verification baseline (2026-08-02, pre-change)

- `@varve/ui` tests: 38 files / 368 tests — pass.
- `@varve/engine` tests: 1034 suites / 0 failures in clean run (2 flaky
  WASM-load failures in backgroundRemoval seen once; unrelated to icons).
- `packages/engine/src/icon` targeted: 6 files / 74 tests — pass.
- Working tree carried concurrent staged + unstaged changes (color picker,
  print, Menubar focus) — untouched by this work.

## 9. Implementation outcomes (2026-08-02, post-change)

Commits (all on `master`, pushed-able):

| Commit | Scope |
|---|---|
| `5a6a7a77` | This audit note |
| `dc8282b0` | Semantic icon registry (`@varve/ui/icons/semantic.tsx`) — 96 concepts × outline/filled, validation, RTL mirror, size tokens; `SolidIconName` union extended with 14 verified Phosphor names |
| `5d9a7f35` | `Document.iconAssets` + `NodeBase.iconAssetId` + codec validation/pruning/closure; 9 tests |
| `8745f323` | Editor insertion pipeline: `useIconAssets` (insert/replace/detach), `IconBrowserDialog`, Layers-panel trigger, clipboard icon-asset provenance, IconBrowser download fix |
| `4c3e5619` | Restore scene icon model after concurrent `feat(logo)` commit clobbered it |
| `d8c74335` (concurrent) | Inspector `Icon` section + registry/ownership entries landed inside the concurrent canvas-fix commit (index race) |

Verification after implementation:

- `@varve/ui`: 385 tests pass (incl. 26 icon tests).
- `@varve/scene`: 1799 pass, 1 skipped (incl. 9 icon-asset tests).
- `@varve/editor`: 4221 pass. Remaining failures are concurrent-agent WIP
  (`Menubar.test` — focus work, `workspaceMode.test` — logo mode label,
  `FloatingTextBar.test` — color work) plus two perf tests that pass in
  isolation (load noise).
- `packages/engine/src/icon`: 74/74 pass.
- pre-commit hooks (biome, audit-emoji, audit-health) pass on every commit.

### Known limitations (honest status)

- IconBrowser is not yet virtualized (Iconify caps at 50 results/query, so
  current DOM cost is bounded; local-store growth is unbounded).
- No pack-level download/update/repair UI; cache has no eviction policy yet.
- `IconifyProvider` still reports `commercial: true` +
  `attributionRequired: true` for every collection (conservative, not
  per-collection accurate); no licence filter in the browser yet.
- `iconExport`/`iconAudit` engine modules have no UI surfaces yet.
- The sanitizer keeps inline `style` values verbatim and does not strip
  external gradient `href`s — flagged for a follow-up.
- Icon creation workspace, provider settings, export dialog, and semantic
  search remain deferred (Phase 4).
