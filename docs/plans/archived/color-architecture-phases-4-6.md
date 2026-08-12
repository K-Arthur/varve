# Color Architecture Overhaul — Phase 4/5/6 Completion Prompt

## Context

You are continuing a document-level color architecture overhaul for **Strata**, a
local-first, cross-platform design suite (Tauri 2 desktop + web). The native Rust
engine renders by IR-replay; the webview replays to Canvas2D/WebGPU.

**Phases 1–3 are COMPLETE and committed on `master`:**

| Commit | What |
|--------|------|
| `6feece77` | `BitDepth` type, `normalizeChannel`/`denormalizeChannel`/`clampChannel`, bit-depth-aware `managedColorToRgba`, `withDefaultBitDepth()` |
| `f4b4e18f` | `ColorConfig.bitDepth` + `ColorConfig.workingSpace`, schema migration 2.3→2.4, `colorConfigWithDefaults()`, linear-light `blend()` path |

**Your job: complete Phases 4, 5, and 6.**

Read `docs/adr/0009-document-color-architecture.md` first — it defines the
architecture decisions you must not violate.

## Critical rules (from AGENTS.md — do not violate)

1. **No circular `workspace:*` dependency chains.** `@varve/shared` is the
   leaf — scene/engine/editor depend on it, never the reverse.
2. **Hub file caps:** `CanvasArea.tsx` (82 imports) and `Shell.tsx` (71 imports)
   must NOT grow. Route new code through `@varve/shared` or adapter modules.
3. **TDD-first.** Write failing tests before implementation.
4. **No emoji anywhere** (zero-tolerance gate).
5. **No hardcoded colors** — trace to CSS custom properties.
6. **BMAD-lite workflow:** Brief → Model → Architecture → Delivery.

## Regression protocol (mandatory after every change)

```bash
pnpm format           # biome format
pnpm typecheck        # tsc --noEmit across packages
pnpm lint             # biome lint
pnpm test             # full vitest suite
pnpm audit:emoji      # zero violations
pnpm audit:tokens     # 120/120 WCAG-AA
```

Failure at any step means a regression. Fix before committing.

## Starting state — key facts

### New types (already in codebase — use these, don't redefine)

```ts
// @varve/shared/src/colorConversion.ts
export type BitDepth = 'uint8' | 'uint16' | 'float16' | 'float32';
export const DEFAULT_BIT_DEPTH: BitDepth = 'uint8';
export function normalizeChannel(value: number, bitDepth: BitDepth): number;
export function denormalizeChannel(value: number, bitDepth: BitDepth): number;
export function clampChannel(value: number, bitDepth: BitDepth): number;
export function channelMax(bitDepth: BitDepth): number;
export function managedColorToRgba(color: ManagedColor): [number, number, number, number];  // bit-depth-aware
export function managedColorToNormalized(color: ManagedColor): [number, number, number, number];  // 0.0–1.0
export function normalizedToCss(rgba: [number, number, number, number]): string;

// @varve/scene/src/colorManagement.ts
export type WorkingSpace = 'srgb' | 'linear';
export const DEFAULT_WORKING_SPACE: WorkingSpace = 'srgb';
export interface ColorConfig {
  mode: ColorMode;
  bitDepth: BitDepth;           // NEW
  workingSpace: WorkingSpace;   // NEW
  rgbProfile: ColorProfileRef;
  cmykProfile: ColorProfileRef;
  displayProfile?: ColorProfileRef;
  outputIntent?: OutputIntentRef;
  blackGeneration: BlackGenerationConfig;
}
export function defaultRgbColorConfig(bitDepth?: BitDepth): ColorConfig;
export function defaultCmykColorConfig(bitDepth?: BitDepth): ColorConfig;
export function defaultColorConfig(mode?: ColorMode, bitDepth?: BitDepth): ColorConfig;
export function colorConfigWithDefaults(config: ColorConfig | undefined): ColorConfig;
export function withDefaultBitDepth<T extends ManagedColor>(color: T, fallback?: BitDepth): T;
// RgbColor/CmykColor/GrayColor now have optional `bitDepth?: BitDepth` field

// @varve/engine/src/blendModes.ts
export function blend(backdrop, source, mode, opacity, linearize?: boolean): [number, number, number, number];
export function blendPixels(backdrop: ImageData, source: ImageData, mode, opacity, linearize?: boolean): ImageData;
```

### Core invariant
> Every color resolves to normalized 0.0–1.0 float through `normalizeChannel`
> or `managedColorToNormalized` at the math boundary. No other module divides
> by 255 or guesses a range.

---

## Phase 4 — Import/Export Fidelity

**Goal:** supported bit depth, profiles, alpha, and CMYK data survive
import→edit→export round trips. Clear warnings when a target format CANNOT
preserve the document's color model.

### 4a — SVG import (`packages/import/src/svg.ts`)

Current: `parseSvgColor()` handles hex, `rgb()`, 20 named colors. Does NOT handle
`hsl()`, `icc-color()`, `currentColor`, or out-of-gamut values.

Implement:
- Parse `hsl()`/`hsla()` → convert to `RgbColor` (document working space is RGB/CMYK)
- Parse `icc-color(name, ...)` → store `profile` field on the resulting `ManagedColor`
- Reject `currentColor` → `null` (returns transparent, caller handles)
- Return type: `ManagedColor` (scene type) — import the type from `@varve/scene`
- Add `bitDepth` field when the SVG signals HiDPI/high-bitdepth (`colorDepth` attribute, or just default to `'uint8'`)

Tests: `hsl(120, 100%, 50%)` → `{ space: 'rgb', r: 0, g: 255, b: 0, a: 255 }`;
`icc-color(FOGRA39)` → `profile: 'fogra39'`; `currentColor` → `null`.

### 4b — SVG codegen (`packages/codegen/src/svg.ts`)

Current: `rgba(node.fill)` collapses everything to sRGB hex/rgba strings.

Implement:
- When `fill.color.bitDepth` is `'float16'`/`'float32'`, emit `icc-color()`
  references if the document has a profile; otherwise round-trip through `rgb()`
  with a warning comment
- When `fill.color` is CMYK, DON'T convert to RGB — emit the CMYK fallback as
  a comment and use `icc-color()` if the profile is embedded
- Add `CodegenOptions.preserveColorSpace: boolean` (default false for backward compat)

### 4c — PDF print pipeline (`crates/strata-print/src/lib.rs`)

Current: `engine_color_rgba()` uses naive `(1-C)(1-K)` math and annotical
`rgb_to_cmyk()`. The Rust ICC path (`rgb_to_cmyk_icc` in `strata-colour`) exists
but is bypassed.

Implement:
- Wire `engine_color_rgba()` to use `rgb_to_cmyk_icc()` when `PdfOptions.print_profile`
  is set (it already is — just call the ICC path)
- `fill_to_color_string()` must render gradients as PDF **shading dictionaries**
  (Type 2/3), not just the first-stop solid approximation
- Preserve spot color names as PDF `/Separation` color spaces (use
  `EngineColor::Spot.name`)
- Add a `--lossy` flag to `export_pdf` that warns when converting from
  float32/16-bit → 8-bit PDF

Tests: CMYK fixture through ICC path vs analytical — assert ΔEOK > 0
(they differ); gradient shading dictionary emits `FunctionType`/`Coords`;
spot color emits `/Separation`.

### 4d — Import validation (`packages/import/src/validation.ts`)

Implement:
- `validateImportColor()` — checks if the imported color's profile/space/bitDepth
  is compatible with the target document. Returns warnings like:
  - `"Document is uint8 but imported ICC profile requests float32 precision"`
  - `"CMYK import into RGB document will convert colors (rendering intent: relative)"`

---

## Phase 5 — UI Workflows

**Goal:** expose only controls that are genuinely implemented. Prevent
accidental destructive conversions.

### 5a — ColorPicker bit depth selector (`packages/ui/src/components/ColorPicker/`)

Current: `ColorPicker` has RGB/CMYK/Grayscale/Spot tabs but no bit depth selector.

Implement:
- Add a `bitDepth` prop to `ColorPicker` (from `ColorPickerProps`)
- When `documentColorMode` is `'rgb'`, show a segmented control:
  `8-bit` | `16-bit` | `16-bit float` | `32-bit float`
- When the selected bitDepth changes, re-emit colors in the new depth via
  `denormalizeChannel` (don't convert color VALUES — just reinterpret precision)
- The ColorPicker's HSL/HSV square continues to work because it always operates
  on normalized 0.0–1.0 floats internally

Tests: selecting `32-bit float` emits `{ bitDepth: 'float32', r: 0.5, g: 0.5, b: 0.5, a: 1 }`;
selecting `16-bit` on a `uint8 128` color emits `{ bitDepth: 'uint16', r: 32768 }`.

### 5b — Document color conversion dialog (`packages/editor/src/components/`)

Implement a `ColorConversionDialog`:
- Trigger: Object menu → "Convert Document Color Space..."
- Shows: current mode + bitDepth + workingSpace, target mode + bitDepth
- Toggle: "Preserve appearance" (ICC conversion) vs "Reassign profile"
- Warning banner when target can't preserve source precision (e.g., float32 → uint8)
- Undoable via `beginTransaction`/`commitTransaction`
- Disabled state when a modal dialog or in-progress interaction is active
  (per invariant #4)

### 5c — Gamut warning in ColorPicker (`packages/ui/src/components/ColorPicker/GamutWarning.tsx`)

Current: only shows for RGB colors. Extend to:
- Show when the selected color is OUT OF CMYK gamut (use `gamutMapToSrgb` to test)
- Show when the color's bitDepth is HIGHER than the document's working bitDepth
  (precision loss on save)

### 5d — New File Dialog (`packages/home/src/NewFileDialog.tsx`)

Current: only RGB and CMYK options. Add:
- Bit depth selector (8/16/32-bit and float options, shown when CMYK or "Print"
  presets are selected)
- Grayscale option (currently missing from the dialog despite being a valid
  `ColorMode`)

---

## Phase 6 — Performance & Testing

### 6a — Memory benchmarks

Create `packages/engine/src/__benchmarks__/colorPrecision.bench.ts`:
- Benchmark `managedColorToRgba` for uint8 vs float32 (expect ~2x cost due to
  normalization, document it)
- Benchmark `blend(linearize=true)` vs `blend(linearize=false)` (expect ~3x cost
  due to sRGB↔linear per channel)
- 10000-node document serialization: uint8 vs float32 (expect 4x size for float32)

### 6b — Save/reload round-trip test

`packages/scene/src/__tests__/colorRoundTrip.test.ts`:
- Create a document with float32 CMYK + spot colors + ICC profile assignment
- Serialize → deserialize via `serializeDocument`/`migrateDocument`
- Assert: bitDepth preserved, profile preserved, CMYK channels within ΔEOK < 0.01
- Test backward compat: a v2.3 fixture (no bitDepth) loads with `bitDepth: 'uint8'`

### 6c — Edge case tests

`packages/shared/src/colorEdgeCases.test.ts`:
- NaN/Infinity/negative values in every bit depth → `clampChannel` returns 0
- Transparent color with non-zero hidden channels (a=0, r=255) → preserved as-is
- Extended-range HDR (r=1.5, g=2.0) in float32 → normalizes/clamps correctly
- Profile assignment (no conversion) vs profile conversion → different results

### 6d — WASM memory ceiling

Document (in `docs/architecture/color-architecture.md` or a new
`docs/perf/color-memory.md`):
- WASM linear memory: 4 GiB ceiling means a single float32 buffer tops out at
  ~1G pixels (4 bytes × RGBA). For a 10000×10000 canvas that's exactly 400 MB —
  document the tile budget.
- Autosave: float32 documents are 4× larger; document the `formatVersion: '2.4'`
  inflation factor and recommend uint8 for web target.

---

## Completion criteria

Do NOT report completion based only of typecheck/unit tests. Completion requires:

- [ ] Existing 8-bit `.strata` files still open correctly (verified by migration test)
- [ ] New documents retain their selected mode AND bitDepth after save/reopen
- [ ] High-precision float32 values survive a serialize→deserialize round trip
- [ ] CMYK is stored as actual CMYK document data (not silently converted to RGB)
- [ ] Rendering with `linearize: true` produces visibly different (correct) output
  vs gamma-space — test this with a Playwright pixel probe
- [ ] SVG import of `hsl()`/`icc-color()` parses correctly
- [ ] PDF export of CMYK documents uses the ICC path (not analytical)
- [ ] Codegen does not collapse CMYK to sRGB hex
- [ ] Memory benchmarks are documented
- [ ] All regression gates pass (format, typecheck, lint, test, emoji, tokens)

Do NOT hide unfinished work behind placeholders, mocked conversions, misleading
UI, or unchecked claims. Document genuine external blockers with evidence.

## Commit protocol

Commit and push coherent milestones (one per phase slice: 4a, 4b, 5a, etc.)
rather than one bulk commit. Before each push:

1. Confirm `pnpm typecheck` passes for touched packages
2. Run `pnpm test` for touched packages
3. Run `pnpm audit:emoji`
4. Verify git history is clean (`git log --oneline -3`)

## Repository state

- Branch: `master`
- Commits ahead of origin: 76 (all committed work is safe)
- `CURRENT_DOCUMENT_VERSION = '2.4'` (already bumped)
- Typecheck baseline: `@varve/editor` has ~259 PRE-EXISTING errors in
  canvas/render/hitTest modules (not your concern)
- Concurrent uncommitted work exists in `packages/engine/src/unicode/` and
  `packages/scene/src/coordinateService.ts` — DO NOT touch these files
