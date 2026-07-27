# Strata Typography Platform

## Architecture

The typography system spans TypeScript (browser/web) and Rust (native/Tauri) layers.

```
┌─────────────────────────────────────────────────────┐
│                  TypeScript Layer                    │
│                                                      │
│  FontCatalog  FontLoader  FontSelector  FontBrowser  │
│       │           │            │              │      │
│  FontResolver  FontCache  fontStorage(IDB)  Providers │
│       │           │            │              │      │
│  shaping.ts  textOutlines.ts  convertTextToPath()    │
│  (Canvas2D)   (opentype.js)   (rich text + deco)     │
└──────────────────────┬──────────────────────────────┘
                       │ Tauri IPC
┌──────────────────────▼──────────────────────────────┐
│                   Rust Layer                          │
│                                                       │
│  strata-print:                                        │
│    shaper.rs     → rustybuzz native shaping           │
│    outline.rs    → ab_glyph glyph path extraction     │
│    subset.rs     → font-subset font subsetting        │
│    lib.rs        → PDF generation + font embedding    │
│    cmyk.rs       → PDF/X-1a/X-4 export               │
│                                                       │
│  strata-sync: SQLite document storage                 │
│  font.rs        → system font enumeration             │
│  font_storage.rs → filesystem font persistence         │
└──────────────────────────────────────────────────────┘
```

## Capability Matrix

| Feature | Browser Canvas2D | WASM (planned) | Native Rust |
|---------|-----------------|-----------------|-------------|
| Text rendering | ✓ (Canvas2D fillText) | — | PDF operators |
| Text measurement | ✓ (measureText) | — | rustybuzz metrics |
| Glyph IDs | ✗ (always 0) | ✓ (rustybuzz-wasm) | ✓ (rustybuzz) |
| Ligatures | ✓ (browser engine) | ✓ | ✓ |
| Complex scripts | ✓ (browser engine) | ✓ | ✓ |
| OpenType features | ✓ (via Canvas2D) | ✓ | ✓ |
| Variation axes | ✓ | ✓ | ✓ |
| COLR/CPAL detection | ✓ | ✓ | ✓ (raw table check) |
| COLR/CPAL rendering | ✗ (monochrome) | ✗ | ✗ |
| PDF native text | ✗ (raster only) | — | ✓ (WinAnsi + subset) |
| PDF native CJK | ✗ | — | Partial (outline fallback) |
| PDF ToUnicode CMap | — | — | ✓ |
| PDF font subsetting | — | — | ✓ (font-subset) |
| PDF font metrics | — | — | ✓ (from font binary) |
| Text outlining | ✓ (opentype.js) | ✓ | ✓ (ab_glyph) |
| Rich-text outlining | ✓ (per-run) | ✓ | ✓ |
| Decoration outlining | ✓ | ✓ | ✓ |
| Worker outlining | ✓ (Web Worker) | ✓ | ✓ (native thread) |
| System font discovery | ✓ (queryLocalFonts) | — | ✓ (fontconfig/CoreText/DWrite) |
| Downloaded font storage | ✓ (IndexedDB) | — | ✓ (filesystem + IDB) |
| Provider search | ✓ (Google Fonts + Fontsource) | — | — |

## Shaping Contract

The native shaping contract (`crates/strata-print/src/shaper.rs`) provides:

- **Input**: `ShapeRequest` — text, font bytes, face index, size, language, script, direction, OpenType features, variation axes
- **Output**: `ShapedRun` — glyphs with real glyph IDs, advances, offsets, clusters, direction, COLR/CPAL flags, missing-glyph warnings

### Capability Flags (`packages/engine/src/types.ts`)

```typescript
export interface ShapingCapabilities {
  supportsGlyphIds: boolean;       // true for rustybuzz
  supportsComplexScripts: boolean; // true for both paths
  supportsClusters: boolean;
  supportsLigatures: boolean;      // true for both (browser applies GSUB)
  supportsFontFallback: boolean;
  supportsVariationAxes: boolean;
  supportsColorGlyphs: boolean;    // true for rustybuzz (detection)
  supportsOutlines: boolean;       // true for rustybuzz
  backend: 'canvas2d' | 'rustybuzz-native' | 'rustybuzz-wasm' | 'harfbuzz';
}
```

### Tauri IPC

- `enumerate_system_fonts` — enumerate OS-installed fonts
- `store_font_on_filesystem` — persist font to app data directory
- `load_font_from_filesystem` — read font from app data
- `list_filesystem_fonts` — enumerate stored fonts with metadata
- `remove_font_from_filesystem` — delete stored font
- `outline_text` — extract glyph paths as SVG
- `shape_text_command` — native shaping with glyph IDs via rustybuzz
- `export_node_pdf` / `export_pdf_with_options` — PDF export with font data

## Font Storage

### IndexedDB (all environments)
- Database: `strata-fonts`, object store: `fonts`
- Records keyed by family name (lowercased)

### Filesystem (Tauri only)
- Location: `$APPDATA/fonts/<sha256-prefix>/`
- Format: `font.{ttf,otf,woff,woff2}` + `meta.json`
- Atomic writes via temp file + rename
- Deduplication via SHA-256 content hash

## PDF Text Pipeline

```
Rust export_pdf():
  1. For each text node, collect font data from TS (Vec<(String, Vec<u8>)>)
  2. Validate embedding permission (OS/2 fsType)
  3. Subset font to used characters (font-subset crate)
  4. Generate FontDescriptor with metrics from actual font binary
  5. Embed subset font as FontFile2 stream
  6. Generate ToUnicode CMap from cmap table
  7. Emit native PDF text operators (Tj/Tm/Tf) for WinAnsi-encodable text
  8. Fall back to vector outlines for non-Latin scripts
  9. Fall back to raster for unsupported effects
```

## Worker Outlining

- `OutlineWorkerPool` manages 2 concurrent Web Workers
- Chunked processing (5,000 chars per chunk) for large text
- Progress events: `jobProgress`, `jobComplete`, `jobError`, `jobCancelled`
- Cancellation via `AbortController`
- Chunked results merged on completion

## Remaining Limitations

| Limitation | Impact | Timeline |
|------------|--------|----------|
| No rustybuzz WASM build | Browser glyph-ID shaping unavailable | P2 |
| No COLR/CPAL rendering | Colour fonts render monochrome | P3 |
| CIDFont/CJK native PDF text | Non-Latin forced to vector outlines | P4 |
| No `Differences` array in font encoding | Some character mappings may be approximate | P4 |
| PDF/X paths use Helvetica only | No font support in PDF/X export | P4 |
| No per-glyph TJ arrays | Kerning pairs not reflected in PDF text | P4 |
| No E2E tests for PDF output | Visual/text-extraction testing needed | P2 |
