# Color Management, CMYK, Bleed & Physical Document Model — Architecture Audit

**Scope:** Comprehensive review of color management, CMYK workflow, bleed/trim systems, physical measurement units, document model architecture, export pipelines, and preflight validation.

**Date:** 2026-07-03

---

## 1. Current-State Audit

### 1.1 Document Architecture

| Component | Status | Evidence |
|---|---|---|
| Document model | Built, pixel-only | `@/packages/scene/src/document.ts:32-60` — `Document` interface has `canvasWidth`/`canvasHeight` in CSS px, no unit metadata, no physical dimensions |
| Node types | Shape, Text, Group, Frame, Image | `@/packages/scene/src/types.ts:248-410` — all transforms in px, no color space metadata |
| Coordinate system | World-space px, 96 DPI assumed | `@/packages/scene/src/document.ts:44-47` — `canvasWidth`/`canvasHeight` are "px (artboard/frame size)" |
| Frame presets | Screen + paper, all in px | `@/packages/editor/src/framePresets.ts:69-77` — A4 is 794x1123 px (96 DPI conversion), no physical unit stored |
| New file dialog | Has unit + colorMode + bleed fields | `@/packages/home/src/NewFileDialog.tsx:29-60` — presets carry `unit: 'mm'`, `colorMode: 'cmyk'`, `bleed: 3`, but these are **not persisted into the Document** |
| Version/migration | v1.0, single migration from 0.9 | `@/packages/scene/src/version.ts:1-22` — no color/bleed fields in migration |
| Guides | Horizontal/vertical, position in px | `@/packages/scene/src/types.ts:43-49` |

**Critical finding:** The `NewFileDialog` collects `unit`, `colorMode`, and `bleed` from the user, but the `Document` interface has **no fields** for these. They are discarded at creation time. The document is always pixel-only with no color mode, no physical unit, and no bleed.

### 1.2 Color Systems

| Component | Status | Evidence |
|---|---|---|
| Color type | `[r, g, b, a]` — u8 array, sRGB only | `@/packages/engine` `Color = readonly [number, number, number, number]` |
| Color picker | HSV/RGB/HEX, sRGB only | `@/packages/ui/src/components/ColorPicker/color-utils.ts:1-124` — no CMYK, no Lab, no spot colors |
| Fill model | Solid/gradient/image/pattern, all RGBA | `@/packages/scene/src/types.ts:180-191` — `Fill.color` is `Color` (RGBA only) |
| Color storage | Inline u8 RGBA on every node | `@/packages/scene/src/types.ts:205` — `NodeBase.fill: Color` |
| Color rendering | Canvas2D `fillStyle = rgba(...)` | `@/packages/engine/src/replay.ts` — direct RGBA to canvas |
| Export color | RGB only for raster; CMYK conversion in Rust | `@/crates/strata-print/src/cmyk.rs:21-40` — naive `rgb_to_cmyk()` + ICC-aware `rgb_to_cmyk_icc()` |
| Color profiles | 3 print profiles in Rust (Fogra39, GRACoL, SWOP) | `@/crates/strata-print/src/profiles.rs:14-21` — no RGB profile management, no display profile |
| ICC validation | Structural header check only | `@/crates/strata-print/src/profiles.rs:182-218` — checks magic bytes, no actual profile parsing |
| 3D LUT interpolation | Tetrahedral, implemented but unused | `@/crates/strata-print/src/profiles.rs:54-173` — no LUT data bundled, no pipeline integration |

**Critical findings:**
- Color is always 8-bit RGBA. No 16-bit, no float, no CMYK storage in the document model.
- No ICC profile assignment at document or node level. Profiles exist only in the Rust export crate.
- No soft proofing. No display profile management. No color-managed preview.
- The `rgb_to_cmyk_icc()` function is a mathematical approximation, not a true ICC-profile-based conversion. It uses fixed matrices, not profile data.
- No spot color support. No Pantone/RAL/NCS libraries. No named color system.
- No global color swatches. Colors are inline per-node. `ColorStyle` exists in types but has no CMYK or spot color representation.

### 1.3 Print Systems

| Component | Status | Evidence |
|---|---|---|
| PDF export (screen) | Built, RGB only | `@/crates/strata-print/src/lib.rs:1-220` — `export_pdf()` emits RGB `rg` operators |
| PDF/X-1a export | Built, CMYK conversion | `@/crates/strata-print/src/cmyk.rs:348-349` — `export_pdfx1a()` converts fills to CMYK |
| PDF/X-4 export | Built, RGB permitted | `@/crates/strata-print/src/cmyk.rs:368-369` — `export_pdfx4()` allows RGB content |
| Bleed/trim boxes | Set in PDF/X output | `@/crates/strata-print/src/cmyk.rs:261-289` — MediaBox/BleedBox/TrimBox computed from `bleed_mm` |
| Crop marks | Implemented | `@/crates/strata-print/src/marks.rs:41-70` — 8 L-shaped mark lines |
| Registration marks | Implemented | `@/crates/strata-print/src/marks.rs:76-93` — 5 crosshair positions |
| Color bars | Implemented | `@/crates/strata-print/src/marks.rs:100-121` — swatch rectangles |
| Print options | Defined in TS types | `@/packages/scene/src/export-types.ts:53-64` — `PrintOptions` has `iccProfile`, `renderingIntent`, `bleedMm`, crop/registration marks |
| Print facade | TS bridge to Tauri IPC | `@/packages/print/src/native.ts:22-62` — calls `export_pdf`/`export_pdfx1a`/`export_pdfx4` |
| Bleed in export | Export-time only | `@/packages/print/src/types.ts:12` — `bleedMm` is a parameter to `PdfExportOptions`, not a document property |
| Settings defaults | Hardcoded | `@/packages/editor/src/settings.ts:54-55` — `defaultIccProfile: 'FOGRA39'`, `defaultBleedMm: 3` |

**Critical findings:**
- Bleed is an export-time parameter, not a document property. The user cannot see or design to the bleed area.
- No bleed visualization on canvas. No trim guides. No safe area guides.
- PDF export is single-page. No multi-page document support.
- No facing-page support. No inside/outside bleed distinction.
- The PDF/X output intent is hardcoded to "Fogra39" string, not driven by the actual profile selection.
- No overprint controls in the document model. No rich black handling.
- No slug area. No printer instructions metadata.

### 1.4 Measurement Units

| Component | Status | Evidence |
|---|---|---|
| Unit types | `px`, `pt`, `in`, `mm` in platform types | `@/packages/platform/src/types.ts:112` — `Unit = 'px' | 'pt' | 'in' | 'mm'` |
| Editor display units | `px`, `pt`, `cm`, `mm`, `in`, `%` | `@/packages/editor/src/context.tsx:172` — `unitType` field |
| Conversion utils | px/pt/rem/% only | `@/packages/shared/src/units.ts:1-81` — no mm, cm, in, picas |
| Internal storage | Always px | All node transforms, frame w/h, font sizes stored in CSS px |
| Frame presets | px for screen, px-equivalent for paper | `@/packages/editor/src/framePresets.ts:69-77` — A4 = 794x1123 px (96 DPI) |
| New file dialog | Collects unit but converts to px | `@/packages/home/src/NewFileDialog.tsx:77-80` — unit is UI-only, not stored |

**Critical findings:**
- No `cm` or `pc` (picas) in the `Unit` type despite being in the editor's display list.
- Unit conversion is fragmented: `@varve/shared/units.ts` handles px/pt/rem/%, but the editor context handles px/pt/cm/mm/in/%. No single source of truth.
- No physical dimension storage. All measurements are pixel-based with 96 DPI assumed.
- No DPI awareness. No support for high-DPI print workflows (300+ DPI).
- No precision control. Conversions use floating-point with no rounding strategy.
- No serialization of unit metadata. Documents are always saved in px.

### 1.5 Preflight & Validation

| Component | Status | Evidence |
|---|---|---|
| Typography preflight | Built | `@/packages/scene/src/typographyPreflight.ts:38-50` — checks missing fonts, overflow, broken chains |
| Design governance | Built | `@/packages/scene/src/governance.ts:50-216` — naming conventions, orphan detection, style usage |
| Print preflight | **Missing** | No preflight for color space, bleed, profiles, DPI, or print production issues |
| Live preflight | **Missing** | No continuous validation; typography preflight must be called explicitly |

### 1.6 Existing Problems Summary

| Problem | Severity | Evidence |
|---|---|---|
| Color mode/bleed/unit collected but not persisted | P0 | `NewFileDialog` vs `Document` interface mismatch |
| No CMYK color storage in document model | P0 | `Color` is always `[r,g,b,a]` |
| No ICC profile assignment on document or nodes | P0 | No profile fields in `Document` or `NodeBase` |
| Bleed is export-only, not a document concept | P0 | `PrintOptions.bleedMm` vs no `Document.bleed` |
| No bleed/trim/safe-area visualization | P0 | CanvasArea has no bleed rendering |
| No multi-page support | P1 | `Document` has single `canvasWidth`/`canvasHeight` |
| No facing-page or inside/outside bleed | P1 | No page model at all |
| Unit system is fragmented and incomplete | P1 | Two different unit type definitions, no cm/pc in platform |
| No spot color or named color support | P1 | No types, no libraries, no swatch system |
| No soft proofing | P1 | No CMYK preview, no display profile management |
| CMYK conversion is approximation, not ICC-based | P1 | `rgb_to_cmyk_icc()` uses fixed matrices, not profile data |
| No print preflight | P1 | Only typography preflight exists |
| No overprint/rich-black controls | P2 | No fields in node or document types |
| No slug area or printer instructions | P2 | No types |
| No high-DPI export support | P2 | Export uses scale factors, not DPI targets |

---

## 2. Research Findings

### 2.1 Color Management Systems

**Sources:** ICC.1:2010 specification, LittleCMS documentation, Wikipedia color management, PDF Press color management guide, colourmanagement.net.

**Key findings:**

1. **ICC profiles are the industry standard.** Every professional application (Illustrator, InDesign, Photoshop, Affinity) uses ICC profiles for color management. The ICC specification defines device profiles (input/display/output), profile connection spaces (PCS — Lab or XYZ), and rendering intents.

2. **Late binding is the modern approach.** PDF/X-4 workflows keep assets in RGB with ICC profiles and let the RIP handle conversion. This preserves maximum flexibility. Early binding (converting to CMYK in Photoshop) is still used for color-critical work but is declining.

3. **Rendering intents matter.** The four intents (Perceptual, Relative Colorimetric, Absolute Colorimetric, Saturation) produce visibly different results. Professional software lets users choose per-export, not just per-document.

4. **LittleCMS (lcms2) is the de facto open-source CMM.** It's used by GIMP, Inkscape, Scribus, and many other applications. A Rust binding (`lcms2` crate) exists. It provides proper ICC profile parsing, transform pipelines, and gamut checking.

5. **Double conversion is a major pitfall.** Converting RGB to one CMYK profile and then to another causes color drift. The architecture must track the source profile and avoid re-conversion.

6. **Rich black handling is critical.** RGB black (0,0,0) converts to a rich CMYK black (e.g., 75,68,67,90). Small text in rich black is impossible to register on press. Professional software provides "standard black" (0,0,0,100) vs "rich black" controls.

### 2.2 CMYK Workflows

**Sources:** PDF Press, IMG.LY PDF/X guide, Adobe InDesign documentation.

**Key findings:**

1. **PDF/X-1a** enforces CMYK-only + spot colors, flattens transparency, embeds everything. Most compatible.
2. **PDF/X-4** permits live transparency, RGB with ICC profiles, layers. Modern standard, smaller files.
3. **Output Intent** is mandatory in PDF/X. It specifies the target CMYK profile. Current code hardcodes "Fogra39" string instead of using the selected profile.
4. **Mixed RGB/CMYK documents** are standard in modern workflows. PDF/X-4 handles this natively. The document model must support per-node color space tagging.

### 2.3 Bleed and Trim Workflows

**Sources:** Adobe InDesign documentation, Mixam printing guide, Reddit prepress discussions.

**Key findings:**

1. **Standard bleed is 3mm (0.125")** for most commercial print. Large-format may use more.
2. **Bleed is a document property**, not an export option. InDesign stores bleed in the document setup. Users design into the bleed area.
3. **Trim size** is the final cut size. **Bleed size** = trim + bleed on all edges.
4. **Safe area** (also called "live area" or "margin") is typically 5mm inside trim. Critical content must be inside this.
5. **Facing pages** require inside bleed (spine) vs outside bleed (fore-edge). The inside bleed may differ from outside.
6. **Crop marks** indicate trim. **Registration marks** align color separations. **Color bars** verify ink density.
7. **Slug area** is outside the bleed for printer instructions, file info, etc.

### 2.4 Measurement Units

**Sources:** W3C CSS Values and Units Module Level 4, typographic unit references, Skalda typography converter.

**Key findings:**

1. **Points (pt) are the print standard.** 1pt = 1/72 inch. PostScript points are the universal print unit.
2. **Picas (pc)** are used in publishing. 1pc = 12pt. Still relevant in newspaper/magazine layout.
3. **Millimeters** are standard in Europe/Asia. **Inches** in North America.
4. **Internal storage should be in a single canonical unit.** Professional software stores internally in points (InDesign) or pixels (Figma) and converts for display.
5. **96 DPI is the CSS standard.** All CSS px conversions use 96 DPI. Print uses 72 DPI (points) or physical units directly.
6. **Precision matters.** Converting between units introduces floating-point error. Professional software uses fixed-point or high-precision float internally.

### 2.5 Spot Colors

**Sources:** Pantone API documentation, Adobe Substance 3D Designer docs, Bentley color books docs, X-Rite PantoneLIVE.

**Key findings:**

1. **Spot colors are named, premixed inks.** Pantone (PMS), RAL, NCS, HKS are the major systems.
2. **Spot colors are stored as names, not numbers.** A spot color reference is "Pantone 185 C", not a CMYK breakdown.
3. **CMYK simulation of spot colors** depends on the output profile. The same Pantone color has different CMYK values on different papers/presses.
4. **Pantone licensing is required** for distributing color libraries. The Pantone API provides digital access under license.
5. **Open-source alternatives:** RAL and NCS have publicly available color data. Pantone is copyrighted.
6. **Architecture should support spot colors as a type** even if libraries are not bundled initially.

### 2.6 Competitive Analysis

| Feature | InDesign | Illustrator | Affinity Publisher | Affinity Designer | Figma | Sketch | Canva | Strata (current) |
|---|---|---|---|---|---|---|---|---|
| CMYK document mode | Yes | Yes | Yes | Yes | No | No | Limited | No (types only) |
| ICC profile management | Yes (ACE) | Yes (ACE) | Yes | Yes | No | No | No | Stub (Rust only) |
| Per-node color space | Yes | Yes | Yes | Yes | No | No | No | No |
| Bleed as document property | Yes | Yes | Yes | Yes | No | No | Yes (export) | No (export only) |
| Bleed visualization | Yes | Yes | Yes | Yes | No | No | No | No |
| Trim/safe area guides | Yes | Yes | Yes | Yes | No | No | No | No |
| Multi-page | Yes | Artboards | Yes | Artboards | Frames | Artboards | Pages | No |
| Facing pages | Yes | No | Yes | No | No | No | No | No |
| Spot colors | Yes (Pantone) | Yes (Pantone) | Yes | Yes | No | No | Limited | No |
| Global color swatches | Yes | Yes | Yes | Yes | Yes (styles) | Yes | Yes | Partial (ColorStyle) |
| Soft proofing | Yes | Yes | Yes | Yes | No | No | No | No |
| Print preflight | Yes | Limited | Yes | Limited | No | No | No | No (typography only) |
| PDF/X-1a export | Yes | Yes | Yes | Yes | No | No | Yes | Yes (Rust) |
| PDF/X-4 export | Yes | Yes | Yes | Yes | No | No | No | Yes (Rust) |
| Physical units | Yes | Yes | Yes | Yes | px only | px only | px + mm | px only (types only) |
| Crop/registration marks | Yes | Yes | Yes | Yes | No | No | Yes | Yes (Rust) |
| Overprint controls | Yes | Yes | Yes | Yes | No | No | No | No |
| Rich black handling | Yes | Yes | Yes | Yes | No | No | No | No |

---

## 3. Gap Analysis

| Capability | Needed for | Current coverage | Gap severity |
|---|---|---|---|
| Document color mode (RGB/CMYK) | Print workflows | 5% (types only, not persisted) | P0 |
| Document physical unit + dimensions | Print, publishing | 5% (collected, not stored) | P0 |
| Document bleed as first-class property | Print production | 10% (export param only) | P0 |
| Bleed/trim/safe-area visualization | Print UX | 0% | P0 |
| ICC profile assignment (document + node) | Color management | 5% (Rust profiles, no TS) | P0 |
| CMYK color storage in document | CMYK workflows | 0% | P0 |
| Per-node color space tagging | Mixed workflows | 0% | P1 |
| Spot color type + named colors | Brand/packaging | 0% | P1 |
| Global color swatches (RGB+CMYK+spot) | Design systems | 20% (ColorStyle, RGB only) | P1 |
| Soft proofing (CMYK preview) | Print accuracy | 0% | P1 |
| Print preflight (bleed, color, DPI) | Production readiness | 0% | P1 |
| Multi-page document model | Publishing | 0% | P1 |
| Facing pages + inside/outside bleed | Publishing | 0% | P2 |
| Overprint / rich black controls | Print production | 0% | P2 |
| Slug area + printer instructions | Production | 0% | P2 |
| High-DPI export targeting | Print quality | 10% (scale factor only) | P2 |
| Unit system unification (cm, pc) | UX consistency | 40% (px/pt/in/mm, fragmented) | P2 |
| True ICC-profile-based conversion | Color accuracy | 20% (approximation only) | P1 |
| Display profile management | Color accuracy | 0% | P2 |

---

## 4. Architectural Recommendations

### 4.1 Document Model

**Goal:** Make print-production concepts first-class document properties.

```typescript
interface Document {
  // ... existing fields ...
  /** Document color mode — determines default color space for new colors. */
  colorMode: ColorMode;           // 'rgb' | 'cmyk' | 'grayscale'
  /** Document's physical unit for display and serialization. */
  unit: DocumentUnit;             // 'px' | 'pt' | 'mm' | 'cm' | 'in' | 'pc'
  /** Physical dimensions in the document's unit. */
  physicalWidth: number;          // e.g., 210 for A4 in mm
  physicalHeight: number;         // e.g., 297 for A4 in mm
  /** DPI for print resolution (0 = screen/undefined). */
  dpi: number;                    // e.g., 300 for print, 0 for screen
  /** Bleed configuration. */
  bleed: BleedConfig;
  /** Safe area / margin configuration. */
  safeArea: SafeAreaConfig;
  /** ICC profile assignment. */
  colorProfile: ColorProfileRef;
  /** Output intent for print export. */
  outputIntent?: OutputIntentRef;
  /** Pages (for multi-page documents). */
  pages?: Page[];
  /** Facing page configuration. */
  facingPages?: FacingPageConfig;
  /** Slug area configuration. */
  slug?: SlugConfig;
  /** Global color swatches. */
  swatches?: Swatch[];
  /** Spot color definitions. */
  spotColors?: SpotColorDef[];
}
```

### 4.2 Bleed Architecture

```typescript
interface BleedConfig {
  /** Uniform bleed, or per-edge overrides. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Whether all edges are linked (change one = change all). */
  linked: boolean;
  /** Unit for bleed values (typically same as document unit). */
  unit: DocumentUnit;
}

interface SafeAreaConfig {
  top: number;
  right: number;
  bottom: number;
  left: number;
  unit: DocumentUnit;
  /** Whether safe area is active (visible + enforced in preflight). */
  enabled: boolean;
}
```

### 4.3 Color Management

```typescript
type ColorMode = 'rgb' | 'cmyk' | 'grayscale';

type DocumentUnit = 'px' | 'pt' | 'mm' | 'cm' | 'in' | 'pc';

/** A color value that can be RGB, CMYK, grayscale, or spot. */
type ManagedColor =
  | { space: 'rgb'; r: number; g: number; b: number; a: number; profile?: string }
  | { space: 'cmyk'; c: number; m: number; y: number; k: number; a: number; profile?: string }
  | { space: 'gray'; v: number; a: number; profile?: string }
  | { space: 'spot'; name: string; tint: number; a: number; altProcess?: CMYKColor };

interface ColorProfileRef {
  /** Profile identifier (e.g., 'srgb', 'display-p3', 'fogra39', 'gracol2006'). */
  id: string;
  /** Display name. */
  name: string;
  /** Whether the profile is embedded in the document. */
  embedded?: boolean;
  /** Raw ICC profile data (if embedded). */
  data?: Uint8Array;
}

interface OutputIntentRef {
  profile: ColorProfileRef;
  renderingIntent: RenderingIntent;
  blackPointCompensation: boolean;
}
```

### 4.4 Spot Color Architecture

```typescript
interface SpotColorDef {
  id: string;
  name: string;                   // e.g., "Pantone 185 C"
  library: string;                // e.g., "pantone-solid-coated", "ral-classic", "custom"
  /** CMYK fallback for process printing. */
  processFallback: { c: number; m: number; y: number; k: number };
  /** Lab values for color-accurate display. */
  lab?: { l: number; a: number; b: number };
  /** Whether this spot color is available on the output device. */
  available?: boolean;
}
```

### 4.5 Unit System

**Recommendation:** Unify all unit conversion into a single `@varve/shared` module. Store internally in CSS px (current behavior) but add physical unit metadata to the document. Add `cm` and `pc` to the `Unit` type.

```typescript
type DocumentUnit = 'px' | 'pt' | 'mm' | 'cm' | 'in' | 'pc';

const UNIT_TO_PX: Record<DocumentUnit, number> = {
  px: 1,
  pt: 96 / 72,        // 1.333...
  mm: 96 / 25.4,      // 3.779...
  cm: 96 / 2.54,      // 37.795...
  in: 96,             // 96
  pc: 96 / 12,        // 8 (1 pica = 12pt = 1/6 inch)
};

function convertUnit(value: number, from: DocumentUnit, to: DocumentUnit): number {
  const px = value * UNIT_TO_PX[from];
  return px / UNIT_TO_PX[to];
}
```

### 4.6 Print Preflight

```typescript
interface PrintPreflightIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'bleed' | 'color-space' | 'profile' | 'resolution' | 'trim' | 'spot-color' | 'font';
  message: string;
  nodeId?: NodeId;
  pageId?: string;
}

interface PrintPreflightResult {
  issues: PrintPreflightIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  ready: boolean;  // errorCount === 0
}

function runPrintPreflight(doc: Document, options: PrintPreflightOptions): PrintPreflightResult;
```

### 4.7 Export Pipeline

**Recommendation:** The export pipeline should read document-level color mode, bleed, and profile settings rather than requiring them as export parameters. Export options override document defaults, not replace them.

---

## 5. Incremental Implementation Roadmap

### Phase 1: Document Model Foundation (P0)

**Goal:** Persist color mode, unit, physical dimensions, and bleed in the document.

| Task | Deliverable | Tests |
|---|---|---|
| 1.1 Add `DocumentUnit` type + unified conversion | `@varve/shared` unit module with all 6 units | Unit conversion tests (round-trip, precision) |
| 1.2 Add `ColorMode`, `BleedConfig`, `SafeAreaConfig` to Document | Extended `Document` interface + migration | Migration test (v1.0 → v1.1) |
| 1.3 Add physical dimensions (`physicalWidth/Height`, `dpi`) | Document fields + conversion helpers | Physical-to-px conversion tests |
| 1.4 Wire `NewFileDialog` to persist into Document | Connect UI to document creation | Integration test |
| 1.5 Bleed/trim/safe-area canvas visualization | Canvas overlay guides | Visual regression test |

### Phase 2: Color Management Architecture (P1)

**Goal:** Support CMYK colors, ICC profile assignment, and color-managed preview.

| Task | Deliverable | Tests |
|---|---|---|
| 2.1 `ManagedColor` type (RGB/CMYK/gray/spot) | New color type in `@varve/scene` | Type + serialization tests |
| 2.2 `ColorProfileRef` + profile registry | Profile management module | Profile lookup tests |
| 2.3 CMYK color picker | Extended color picker UI | Component tests |
| 2.4 Color space conversion (TS, profile-aware) | Conversion utilities | Conversion accuracy tests |
| 2.5 Soft proofing preview | Canvas CMYK preview mode | Preview tests |
| 2.6 Per-node color space tagging | `NodeBase.colorSpace` field | Serialization + migration tests |
| 2.7 Rich black / standard black controls | Black generation settings | Black conversion tests |

### Phase 3: Spot Colors & Global Swatches (P1)

| Task | Deliverable | Tests |
|---|---|---|
| 3.1 `SpotColorDef` type + document storage | Scene types | Type tests |
| 3.2 RAL/NCS open color libraries | Color book data + lookup | Library tests |
| 3.3 Spot color in color picker | UI for spot color selection | Component tests |
| 3.4 Global swatch system (RGB+CMYK+spot) | `Document.swatches` + swatch panel | Swatch CRUD tests |
| 3.5 Swatch → CMYK/RGB conversion | Process fallback conversion | Conversion tests |

### Phase 4: Print Preflight (P1)

| Task | Deliverable | Tests |
|---|---|---|
| 4.1 `PrintPreflightIssue` types + runner | Preflight module in `@varve/scene` | Preflight logic tests |
| 4.2 Bleed/trim/safe-area checks | Missing bleed, content in bleed | Check tests |
| 4.3 Color space/profile checks | Untagged colors, missing profiles | Check tests |
| 4.4 Resolution/DPI checks | Low-res images for print DPI | Check tests |
| 4.5 Live preflight panel | UI panel with issue list | Component tests |

### Phase 5: Export Pipeline Integration (P2)

| Task | Deliverable | Tests |
|---|---|---|
| 5.1 Export reads document color mode/bleed/profile | Export uses document defaults | Integration tests |
| 5.2 True ICC-profile-based CMYK conversion (lcms2) | Rust lcms2 integration | Conversion accuracy tests |
| 5.3 Overprint controls in document + export | Overprint fields + PDF output | Overprint tests |
| 5.4 High-DPI export targeting | DPI-based raster export | Export dimension tests |

### Phase 6: Multi-Page & Facing Pages (P2)

| Task | Deliverable | Tests |
|---|---|---|
| 6.1 `Page` model + multi-page document | Page types + operations | Page CRUD tests |
| 6.2 Facing page configuration | Inside/outside bleed | Facing page tests |
| 6.3 Page navigation UI | Page tabs/panel | Component tests |
| 6.4 Multi-page PDF export | Per-page PDF output | Export tests |

---

## 6. Test Strategy

- **Unit tests:** Every new type, conversion function, and preflight check gets deterministic tests.
- **Migration tests:** Document version upgrades preserve data and add sensible defaults.
- **Serialization tests:** Round-trip JSON serialization of all new document fields.
- **Conversion accuracy tests:** Unit conversions verified to 6 decimal places. Color conversions verified against known reference values.
- **Preflight tests:** Each check type tested with valid and invalid documents.
- **Gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:emoji`, `pnpm audit:tokens` after every change.

---

## 7. Remaining Risks

- **Pantone licensing:** Distributing Pantone color data requires a license. Architecture supports spot colors but libraries must be user-provided or licensed.
- **lcms2 integration:** Adding a C dependency to the Rust crate increases build complexity. WASM build may need a pure-Rust alternative.
- **Performance:** CMYK preview and soft proofing add per-frame conversion overhead. May need cached color transforms.
- **Backward compatibility:** Adding required fields to `Document` requires migration. All new fields must be optional with sensible defaults.
- **Multi-page refactor:** Adding pages is a significant model change. Must be designed carefully to avoid breaking existing single-document workflows.

---

## 8. Future Opportunities

- **Spectral color management** (iccMAX / ICC.2) for next-generation color accuracy.
- **Cloud color profile sync** for team consistency.
- **AI-driven preflight** for automatic issue resolution suggestions.
- **Package/folding dieline** support for packaging design.
- **Large-format tile** export for wide-format printing.
- **Color-accurate thumbnail** generation using managed rendering.
