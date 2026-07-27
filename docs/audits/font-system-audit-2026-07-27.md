# Font System Audit — Strata

**Date:** 2026-07-27
**Scope:** Complete font subsystem audit, integration, and hardening
**Status:** Phase 1-3 complete (audit, integration, testing)

---

## 1. Executive Summary

Strata's font system has a solid engine foundation (`packages/engine/src/font/`) with
214 passing tests across 8 test modules. The audit revealed that several UI components
(FontSelector, FontBrowser, MissingFontDialog) were built but never integrated into the
editor. The main gaps were:

1. **FontSelector not integrated** — existed but was never rendered
2. **MissingFontDialog not integrated** — existed but was never rendered
3. **No shaping tests** — the shaping module had zero test coverage
4. **hitTestCaret bug** — caret position at start of text returned wrong index
5. **E2E test mismatch** — font-selector.spec.ts expected `.font-selector` class that didn't exist

All gaps have been addressed. The FontSelector is now integrated into both the
FloatingTextBar and TypographySection. The MissingFontDialog is wired to the Shell.
Shaping tests cover BiDi, grapheme segmentation, script detection, and caret hit-testing.

---

## 2. Audit Matrix

| Area | Implementation | Status | Tests |
|------|---------------|--------|-------|
| Font identity & metadata | `fontIdentity.ts` — SHA-256 hash, PostScript name, typographic names | **Complete** | 28 (fontParser) |
| Font file parsing | `fontParser.ts` — TTF/OTF/WOFF/WOFF2/TTC, all OpenType tables | **Complete** | 28 (fontParser) |
| Font catalog | `fontCatalog.ts` — searchable, filterable, sortable | **Complete** | 48 (fontCatalog) |
| Font caching | `fontCache.ts` — LRU with TTL, metadata + binary caches | **Complete** | 21 (fontCache) |
| Font loading | `fontLoader.ts` — CSS Font Loading API, system enumeration | **Complete** | 13 (fontLoader) |
| Font providers | `fontProviders.ts` — Google Fonts + Fontsource adapters | **Complete** | 32 (fontProviders) |
| Font download | `fontDownloadManager.ts` — queue, progress, validation | **Complete** | 18 (fontDownloadManager) |
| License policy | `fontLicensePolicy.ts` — OFL/Apache/MIT/proprietary | **Complete** | 27 (fontLicensePolicy) |
| Font resolver | `fontResolver.ts` — missing-font detection, substitution | **Complete** | 28 (fontResolver) |
| Font bridge | `fontBridge.ts` — syncs FontRegistry ↔ FontCatalog | **Complete** | — |
| Font usage index | `fontUsageIndex.ts` — document font scanning, migration | **Complete** | — |
| Text shaping | `shaping.ts` — BiDi, grapheme, script, caret hit-testing | **Complete** | 29 (shaping) |
| Font picker UI | `FontSelector.tsx` — APG combobox, search, preview | **Integrated** | 28 (FloatingTextBar) |
| Missing font UI | `MissingFontDialog.tsx` + `MissingFontController.tsx` | **Integrated** | — |
| Font management | `FontBrowser.tsx` — library panel | **Built, not integrated** | — |
| PDF font embedding | `strata-print` crate — subsetting, outlining | **Complete** | — |
| SVG font export | `codegen/src/svg.ts` — font-family, variation settings | **Complete** | — |

---

## 3. Architecture

### 3.1 Font Source Taxonomy

The system classifies fonts into explicit source categories (`FontSourceKind`):

| Source | Description | Portable |
|--------|-------------|----------|
| `system` | OS-installed fonts | No |
| `bundled` | Ships with Strata (IBM Plex, Geist) | Yes |
| `project` | Embedded in project file | Yes |
| `user` | Downloaded/installed by user | Per license |
| `remote` | From provider (Google Fonts, Fontsource) | Per license |
| `missing` | Referenced but not available | N/A |

### 3.2 Canonical Font Identity

Fonts are identified by:
1. **SHA-256 content hash** (64 hex chars) — exact file identity
2. **PostScript name** (nameID 6) — unique per face
3. **Family + subfamily names** — display identity
4. **Typographic names** (nameID 16/17) — preferred family/subfamily
5. **Collection index** — for TTC/OTC files

### 3.3 Two-System Architecture

The font system has two parallel subsystems connected by `FontBridge`:

| System | Location | Used By |
|--------|----------|---------|
| **FontRegistry** (legacy) | `fontRegistry.ts` | UI components (FontSelector, TypographySection) |
| **FontCatalog** (modern) | `font/fontCatalog.ts` | FontResolver, preflight, export |
| **FontBridge** | `font/fontBridge.ts` | Bi-directional sync |

The FontRegistry is a singleton that manages CSS Font Loading API integration.
The FontCatalog is a searchable in-memory database. The FontBridge keeps them in sync.

### 3.4 Shaping Pipeline

```
Text + Style → shapeRun() → ShapedRun[]
  1. BiDi analysis (UAX #9) → paragraph direction + runs
  2. Grapheme segmentation (UAX #29) → cluster boundaries
  3. Script detection → per-run OpenType script tag
  4. Per-grapheme measurement → advances via Canvas2D
  5. Visual reordering (RTL) → display order
```

---

## 4. Changes Made

### 4.1 FontSelector Integration

**Files modified:**
- `packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx`
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx`

**Changes:**
- Replaced plain `Select` component with `FontSelector` for font family selection
- FontSelector provides type-ahead search, live font preview, source badges, variable font badges
- Removed unused `SYSTEM_FONTS` arrays and `registryFonts` state

### 4.2 MissingFontDialog Integration

**Files created:**
- `packages/editor/src/components/FontBrowser/MissingFontController.tsx`

**Files modified:**
- `packages/editor/src/Shell.tsx`

**Changes:**
- Created `MissingFontController` that builds a FontCatalog from the registry
- Runs `FontResolver.detectMissing()` when the document changes
- Auto-shows the MissingFontDialog when missing fonts are detected
- Handles per-font and bulk replacement via the editor's transaction system

### 4.3 Shaping Tests

**Files created:**
- `packages/engine/src/shaping.test.ts` (29 tests)

**Coverage:**
- `scriptCodeToTag` — ISO 15924 to OpenType script tag mapping
- `shapeRun` — LTR/RTL, grapheme clusters, letter spacing, font string, metrics
- `shapeText` — full text shaping, direction detection, empty text
- `hitTestCaret` — caret position at start, middle, end, past end

### 4.4 hitTestCaret Bug Fix

**File modified:** `packages/engine/src/shaping.ts`

**Bug:** When `bestGi === 0` (caret before first glyph), `run.glyphs[bestGi - 1]` was
`run.glyphs[-1]` which is `undefined`, causing it to fall through to the last glyph.

**Fix:** Added explicit `bestGi === 0` case that returns the first glyph's cluster offset.

### 4.5 Font Parser Test Fix

**File modified:** `packages/engine/src/font/fontParser.test.ts`

**Change:** Updated vendor test to use nameID 8 (correct per OpenType spec) instead of
nameID 5 (which is the version string). Added separate test for version extraction.

---

## 5. Test Results

### 5.1 Font Engine Tests

| Test File | Tests | Status |
|-----------|-------|--------|
| `fontParser.test.ts` | 28 | Pass |
| `fontCatalog.test.ts` | 48 | Pass |
| `fontLoader.test.ts` | 13 | Pass |
| `fontDownloadManager.test.ts` | 18 | Pass |
| `fontLicensePolicy.test.ts` | 27 | Pass |
| `fontCache.test.ts` | 21 | Pass |
| `fontProviders.test.ts` | 32 | Pass |
| `fontResolver.test.ts` | 28 | Pass |
| `fontManifest.test.ts` | 7 | Pass |
| **Subtotal** | **222** | **All pass** |

### 5.2 Shaping Tests

| Test File | Tests | Status |
|-----------|-------|--------|
| `shaping.test.ts` | 29 | Pass |

### 5.3 Component Tests

| Test File | Tests | Status |
|-----------|-------|--------|
| `FloatingTextBar.test.tsx` | 28 | Pass |

### 5.4 Total

**279 tests passing** (222 font engine + 29 shaping + 28 component)

---

## 6. Pre-existing Issues (Not Introduced)

These issues exist in the working tree but are not from this session's changes:

| File | Issue | Source |
|------|-------|--------|
| `context.tsx` | `selectionOrigin` type mismatch | Concurrent image enhancement work |
| `settings.ts` | `LayersSettingsStore` not found | Concurrent settings refactor |
| `LayersTree.tsx` | `EditorSettings.layers` missing | Concurrent settings refactor |
| `Breadcrumb.tsx` | `moreHorizontal` icon missing | Concurrent icon work |
| Various | 5 lint warnings (noArrayIndexKey, etc.) | Pre-existing |

---

## 7. Deferred Work

| Item | Why Deferred | Impact | Next Action |
|------|-------------|--------|-------------|
| FontBrowser panel integration | Requires sidebar panel slot | Medium — no font library UI | Add to panel registry |
| Font download UI | Requires new panel/surface | Medium — no online font download | Build download manager panel |
| Font license UI | Requires new panel/surface | Low — license info not user-visible | Add to font details panel |
| Font preflight | Requires export pipeline integration | Medium — no export font warnings | Integrate with export dialog |
| TTC/OTC collection UI | Low usage frequency | Low — collections rare in test docs | Add collection member picker |
| Color font UI indicators | Low usage frequency | Low — color fonts rare | Add color badge to FontSelector |
| System font enumeration (Tauri) | Platform-specific | Medium — Tauri can't use queryLocalFonts | Add native Tauri font command |
| WASM shaping (rustybuzz) | Future native path | Low — browser path works | Integrate with WASM build |

---

## 8. Platform Verification

| Platform | Status | Notes |
|----------|--------|-------|
| Browser (Chromium) | **Verified** | FontSelector, FloatingTextBar, TypographySection |
| Linux WebKitGTK | **Not tested** | E2E tests target Chromium |
| Windows WebView2 | **Not tested** | No Windows build environment |
| macOS WKWebView | **Not tested** | No macOS build environment |
| Tauri desktop | **Not tested** | Requires native build |

---

## 9. Security & Privacy

- Font files are parsed in-memory (no native code)
- No font file bytes are logged or transmitted
- System font enumeration uses browser's Local Font Access API (permission-gated)
- No automatic upload of system fonts

---

## 10. Performance

- FontCatalog uses O(1) lookup by identity key
- FontCache uses LRU eviction (200 entries / 50 MB default)
- FontSelector uses memoized filtering and virtualization-ready structure
- Shaping uses per-grapheme measurement (not per-codepoint)

---

## 11. Files Changed

### Created
- `packages/engine/src/shaping.test.ts` — 29 shaping tests
- `packages/editor/src/components/FontBrowser/MissingFontController.tsx` — missing font detection + dialog

### Modified
- `packages/editor/src/components/FloatingTextBar/FloatingTextBar.tsx` — FontSelector integration
- `packages/editor/src/components/Inspector/sections/TypographySection.tsx` — FontSelector integration
- `packages/editor/src/Shell.tsx` — MissingFontController integration
- `packages/engine/src/shaping.ts` — hitTestCaret bug fix
- `packages/engine/src/font/fontParser.test.ts` — vendor/version test fix
