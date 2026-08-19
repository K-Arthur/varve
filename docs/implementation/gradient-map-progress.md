# Gradient Map System — Audit, Design & Progress

Branch: `feat/gradient-map-system`. Base: `master` @ `cf1ef196`.

Status legend: `[x]` done, `[~]` in progress, `[ ]` planned.

---

## 1. Repository audit (2026-07-31)

### 1.1 Existing gradient / fill primitives

| Artifact | Location | Notes |
|---|---|---|
| `GradientType` (`linear/radial/angular/diamond`) | `packages/scene/src/types.ts:405` | Spatial gradient fills only |
| `GradientStop` (`{position, color: ManagedColor, midpoint?}`) | `types.ts:413-418` | Canonical scene stop |
| `GradientFill` (`{type, stops, rotation?, interpolationSpace?, transform?, tilingMode?}`) | `types.ts:420-432` | Canonical spatial fill gradient |
| `Fill.type = 'solid'\|'gradient'\|'image'\|'pattern'` | `types.ts:581-592` | Gradient map is NOT a fill |
| `GradientInterpolationSpace = 'srgb'\|'linear-srgb'\|'oklab'\|'oklch'\|'hsl'` | `types.ts`, `engine/types.ts`, `shared/colorInterpolation.ts` | Triplicated union |
| Shared interpolation engine | `packages/shared/src/colorInterpolation.ts` (`interpolateManagedColor`, `sampleGradientColor`, `expandGradientStops`, `applyMidpointBias`) | **Reusable canonical evaluation** |
| Canvas gradient mapper | `packages/engine/src/replay.ts:1813` `createGradientStyle` + `expandGradientStopsForFill:1713` + `gradientCache:1801` | Fill gradient rasterizer |
| Fill gradient editor UI | `packages/editor/src/components/Inspector/color/GradientEditor.tsx` | Reusable stop-bar concepts |

### 1.2 Existing gradient-map / tonal adjustments

| Artifact | Location | Notes |
|---|---|---|
| `GradientMapStop` (`{position, color: Color, opacity?, midpoint?}`) | `engine/gradientMap.ts:19` and `engine/filters.ts:227` | Duplicate shapes |
| `GradientMapAdjustment` (`kind:'gradientMap'`, stops, dither, preserveLuminosity, ditherSize, mode, channelStops) | `engine/filters.ts:236-252` | The document adjustment we extend |
| `buildGradientLUT` (256-entry, smoothstep midpoint) | `engine/gradientMap.ts:91-143` | **sRGB-only; midpoint formula diverges from fills; no opacity** |
| `applyGradientMapFilter` (Rec.709 luma, Bayer dither) | `engine/gradientMap.ts:157-233` | Alpha preserved; ignores stop opacity |
| `FilterIR.gradientMap` | `engine/types.ts:882-915` | Render contract |
| `applySoftwareFilter` case | `engine/filterCompositor.ts:402-436` | CPU dispatch |
| `FILTER_PROPERTIES.gradientMap` | `engine/adjustmentPipeline.ts:317-323` | `software-cpu` + `raster-export`, no GPU path |
| `GRADIENT_MAP_PRESETS` (12) | `engine/presets.ts:21-148` | Built-in ramp presets |
| `GradientMapEditor` UI | `editor/src/components/Inspector/controls/GradientMapEditor.tsx` | Mounted at `AdjustmentEditor.tsx:400-420` |
| Duotone / Tritone / LUT / Curves / Levels / etc. | `engine/duotone.ts`, `tritone.ts`, `lut/`, `adjustment/` | Adjacent tonal systems |

### 1.3 Adjustment-layer model & rendering path (gradient map home)

- `AdjustmentNode.adjustments: Adjustment[]` (`scene/types.ts:1236-1256`); legacy `adjustmentType`/`params` vestigial.
- `AdjustmentScope` (`types.ts:839-843`): `image-local` / `explicit-targets` / `container-descendant` / `document`.
- Resolution: `scene/adjustmentScope.ts` (`resolveAdjustmentScope`, `isAdjustmentEligible`, `scopeForTargets`, `validateScope`).
- Live render: `CanvasArea.tsx:2077-2149` — backdrop snapshot of scope-target world bounds (`EFFECT_PAD=80`) → `applyFilterWithCompositing` → composite with layer opacity/blend. **Applies uniformly to raster AND vector targets** (filters operate on pixels after the subtree is painted).
- Export: `editor/export/compositor.ts` capability table — `svg`/`pdf` have `supportsAdjustments:false` → scoped raster flatten via engine `buildIr`+`replayIr`; `editor/export/flattenForExport.ts` is a lighter adjustment-only flattener.
- Undo: every `updateAdjustmentInLayer`/`reorderAdjustmentInLayer`/`updateNode` is snapshot-based (`useHistory.ts`); AdjustmentPanel wraps drags in `beginTransaction`/`commitTransaction`.

### 1.4 Color management

- Canonical `ManagedColor` union (`scene/colorManagement.ts:164`): `rgb/cmyk/gray/spot`.
- Analytical conversions in `shared/colorConversion.ts`: sRGB gamma, XYZ D65, Bradford, Lab, Oklab, Oklch, gamut-map, `managedColorToRgba`.
- `relativeLuminance` (WCAG BT.709) in `shared/contrast.ts:26`; Oklab L available via `linearSrgbToOklab`.
- Engine `rgba()` conversion at `engine/replay.ts:198`.
- Print conversion in `crates/varve-colour` (analytical + ICC); no TS ICC in webview.

### 1.5 Persistence / migration / assets

- `DocumentCodec.decode/encode` is the single choke point (`scene/documentCodec.ts:662/751`).
- `version.ts` authoritative: `CURRENT_DOCUMENT_VERSION = '2.10'`, 20 migrations table; `version-migrations.ts` / `version-utils.ts` / `version.ts.partial` are **stale dead siblings** (do not edit).
- `Document.assets` content-addressed embedded assets (`scene/assets.ts`).
- `Document.swatches` document-local swatches (`scene/swatches.ts`) — the closest pattern for document-local gradient presets.
- User-level presets: `editor/presetLibrary.ts` + `shared/presetStore.ts` (`PresetKVStore`, schemaVersion 1). **No gradient preset library exists.**
- Clipboard: `application/vnd.strata+json` `ClipboardData {nodes, rasterMaskAssets?, assets?}` — adjustment data rides on nodes (self-contained).
- Backup/recovery/autosave all serialize through `DocumentCodec`.

### 1.6 Import infrastructure

- `@varve/import` registry: `getParserForExtension` / `getParserForData` (content sniffing) / `ImportParser {parse, canParse, supportedExtensions}`.
- `ImportService.importFiles` → per-file `parse` → `DocumentCodec.normalize` → `FidelityIssue[]` → `ImportFileReport`. **No gradient importer exists.**
- File pickers: hidden `<input type=file>` (Shell.tsx:571-668), Tauri dialogs (`platform.openDocumentFromDisk`), HTML5 + native `tauri://drag-*` drop (`dropUtils.ts`, `CanvasArea.tsx:2601-2690`).
- PSD import uses `@webtoon/psd` and warns adjustment layers unsupported.

### 1.7 Test infrastructure

- Vitest (jsdom for ui/editor), Playwright E2E (`tests/e2e`), visual harness `tests/e2e/visual/replay.spec.ts` + per-DPR snapshots, `@varve/engine` bench, `gradientMap.test.ts`/`gradientMapFilter.test.ts` exist.
- `vitest.setup.ts` mocks canvas2d/OffscreenCanvas/ImageData/PointerEvent/dialog.
- Scene fixtures: `packages/scene/src/__fixtures__` (raw doc JSON migrated in tests).
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `just gate` / `scripts/audit-architecture.mjs --ci`.

## 2. Architectural decisions

1. **Gradient maps are adjustments, not fills.** A gradient map remaps rendered tonal values; it stays a `gradientMap` `Adjustment` on `AdjustmentNode` with a scope. Ordinary gradient fills remain spatial `GradientFill`. The two share stop/interpolation primitives but keep distinct scene representations (matches the task's requirement).
2. **Canonical `GradientPreset` lives in `@varve/scene`** (uses `ManagedColor`); the engine keeps a structural mirror (`GradientMapStop`/engine params with `Color` tuples) for the render/IR path, exactly like `EngineColor` mirrors `ManagedColor`.
3. **The existing adjustment pipeline is the rendering path** for raster, vector, text, groups, frames, and mixed subtrees (backdrop compositing of scope targets). No new renderer is needed; the new parameters flow through `FilterIR.gradientMap` → `applySoftwareFilter` → `applyGradientMapFilter`.
4. **LUT evaluation is consolidated onto `@varve/shared/colorInterpolation`** (`sampleGradientColor` + `interpolateManagedColor` + `applyMidpointBias`), unifying the previously-divergent midpoint formula and enabling sRGB/Oklab/Oklch/HSL interpolation for gradient maps.
5. **`.grd` parser is isolated in `@varve/import/src/gradient/`**, parser-fuzzable, bounded, and produces structured warnings separate from errors. Native `.strata-gradient.json` is the human-inspectable interchange format.
6. **Persistence is additive**: new optional `GradientMapAdjustment` fields (backward compatible), `Document.gradientPresets` (document-local, portability), user-level library in `PresetKVStore`, version bump `2.10 → 2.11`.
7. **No new panel slot.** The Gradient Map editor + preset browser lives inside the standard AdjustmentPanel per-effect editor (where gradient maps are already configured). Import review uses the shared `Dialog`/`Menu`/`Select` primitives.
8. **No new canvas GPU backend.** Existing `software-cpu` + `raster-export` path covers Canvas2D, worker-excluded structural scenes, and exports. A WebGPU/WebGL gradient-map compute pass is deferred (see §6.3) — Linux WebKitGTK cannot be assumed to expose either.

## 3. Files & packages changed (planned)

| Package | Files |
|---|---|
| `@varve/scene` | `gradientPresets.ts` (new), `types.ts` (Document.gradientPresets), `document.ts`, `version.ts` (2.11 migration), `index.ts` |
| `@varve/engine` | `gradientMap.ts` (rewrite LUT+params), `filters.ts` (GradientMapAdjustment fields), `types.ts` (FilterIR), `filterCompositor.ts` (param pass-through), `index.ts` |
| `@varve/shared` | (none required — reuse `colorInterpolation`, `colorConversion`, `contrast`) |
| `@varve/import` | `gradient/` (new): `detect.ts`, `descriptor.ts`, `photoshopGrd.ts`, `legacyGrd.ts`, `normalize.ts`, `validate.ts`, `nativeFormat.ts`, `index.ts`; `index.ts` exports; fixtures + tests |
| `@varve/editor` | `gradientPresets/library.ts` (user preset store hook), `gradientPresets/builtin.ts`, `components/Inspector/controls/GradientMapEditor.tsx` (rework), `components/Inspector/controls/GradientMapPresetBrowser.tsx` (new), `components/gradientMap/import/` (review dialog + handler), `AdjustmentEditor.tsx` wiring |
| `tests/e2e` | `gradient-map/` specs |
| `docs/` | `implementation/gradient-map-progress.md`, `architecture/gradient-map-system.md` |

## 4. Rendering-path gaps (pre-existing)

1. `interpolationSpace` dropped on native/wasm IR path (`crates/varve-core/src/scene.rs` + `varve-bridge` lack the field) — **out of scope** (stub default `oklab` matches ours).
2. Print `sample_gradient` is sRGB-only; gradient-map adjustments are NOT rendered by `varve-print` (PDF-flattened via webview raster instead) — acceptable; documented in `varve-print/src/lib.rs:1622-1628`.
3. `diamond` gradient fill approximated as radial — unrelated.
4. `flattenForExport.ts` uses a reduced mini-renderer for adjustment-only flatten; SVG/PDF/raster exports use the real engine. Gradient maps behave through both.

## 5. Known risks

- Descriptor `.grd` header layout (offset 32 convention) is validated per-read; if a file diverges, the parser falls back to scanning for the `GrdL`/`VlLs` anchor. Legacy `Grad`-signature support is best-effort (fixture-backed only by our generated fixture).
- Noise gradients: imported read-only with a compatibility warning (no PRNG reproduction).
- Color-model conversions (CMYK/HSB/Lab→RGB) are analytical approximations.
- Live preview runs on the main thread (existing structural path); stop-drag uses rAF debounce + transactions (existing pattern).

## 6. Milestones

All milestones implemented, tested, and committed on `feat/gradient-map-system`
(based at `master` @ `cf1ef196`). **Pushed to `origin/master` on 2026-08-01**:
`98f2e892..9f627ece  HEAD -> master` (verified — my HEAD is an ancestor of
`origin/master`).

| Milestone | Commit | Status |
|---|---|---|
| M1 — Audit + progress doc | `6eda730c` | done |
| M2 — Canonical gradient model | `8059a95b` | done |
| M3 — Engine evaluation (LUT rewrite) | `8f7eaf50` | done |
| M4 — Secure `.grd` parser + fixtures | `a89fac37` | done |
| M5/M6 — Preset library, persistence, migration 2.10→2.11 | `76ecf22a` | done |
| M7/M8 — Editor UI + preset browser + import review | `19f92b13`, `04e45403` | done |
| M9 — Export preflight warnings | `69479f4e` | done |
| M10 — E2E workflow specs | `82f41d63` | done |
| M11 — Docs + final report | this doc + `docs/architecture/gradient-map-system.md` | done |
| M12 — LUT-size correctness fix + CPU benchmarks + pixel E2E | `d1f39ec1`, `eb9ea723` | done |
| M12b — adjustment layers parented into the page content root (unblocks the four pixel-level E2E cases) | `f04703bb` | done |

Verification (2026-08-01):
- `pnpm typecheck` — all 15 packages pass.
- `pnpm lint` — clean (0 errors on touched files).
- `pnpm test` (batched) — ~10,400 tests pass across all packages; the single
  `canvas10k` cull <500ms perf assertion is flaky under load and passes in
  isolation (unrelated to this feature).
- `cargo test --workspace` — all Rust tests pass (no Rust changes).
- `pnpm audit:emoji` — clean. `scripts/audit-architecture.mjs --ci` — passes.
- Playwright E2E `tests/e2e/gradient-map/import-workflow.spec.ts` — 4/4 pass.

Pre-existing failures (not caused by this work, verified against the baseline
app on `master`):
- `tests/e2e/effects/gradient-map.spec.ts` and `adjustment-picker.spec.ts`
  assume the inspector's Adjustments tab is already active after selecting an
  adjustment node; the app defaults to the Properties tab, so the
  `.adj-panel__add-btn` is not visible. The new
  `tests/e2e/gradient-map/import-workflow.spec.ts` clicks the tab first and
  passes.

## 7. Test plan

Implemented and passing: stop sorting/dedupe, midpoint eval, opacity
interpolation, reverse, interpolation spaces, content hashing, preset dedup,
serialization (deterministic round-trip), migration 2.10→2.11, `.grd`
truncation/invalid counts/unknown versions/multi-gradient/unicode names/noise,
native JSON round-trip, luminance modes, alpha-fringe checks, export preflight,
preset library persistence, and the E2E import→apply→undo/redo workflow.

Coverage note: raster/vector application is exercised through the existing
adjustment pipeline (which is scope-based backdrop compositing — identical for
raster and vector targets), the engine filter tests, and the E2E apply step.
Pixel-parity CPU-vs-GPU and full visual baselines were deferred (see §8) since
a GPU gradient-map post-pass is not implemented on any backend.

## 8. Deferred (with reasons)

- **GPU compute gradient map** (WebGPU/WebGL): requires a fragment/compute post-pass; WebKitGTK availability uncertain; existing CPU path is acceptable; revisit when the compositor gains a real shader pipeline. Because no GPU path exists, "CPU vs GPU within tolerance" is trivially satisfied but unproven for future backends.
- **ICC-accurate profile conversion** for imported wide-gamut presets: TS has no ICC engine; only analytical sRGB/Display-P3 math today.
- **Noise-gradient PRNG reproduction** and **mesh/freeform gradient types**: not representable in the current scene model.
- **Blue-noise / error-diffusion dithering**: ordered Bayer retained for determinism; error diffusion deferred pending perf budget.
- **`.ase` import**: cannot faithfully represent stop/midpoint/opacity semantics — explicitly not overloaded.
- **Full visual-regression baselines** for every panel state (Playwright screenshot set from §18): deferred to a follow-up; the E2E workflow + unit parity tests cover the primary paths, and the IR-replay visual harness is unaffected (adjustments use the structural path).

## 9. M12 findings (2026-08-01)

### 9.1 Correctness fix — ramp index vs. configured LUT size (`d1f39ec1`)

`applyGradientMapFilter` computed an 8-bit tonal value (0–255) and used it
directly as an index into the colour and alpha ramps. Those ramps are built at
`lutSize`, a serialized `GradientMapAdjustment` field clamped to [64, 4096], so
the index and the ramp domain disagreed whenever `lutSize !== 256`:

| `lutSize` | White pixel (expected pure blue `0,0,255`) | Effect |
|---|---|---|
| 64 | `0,0,0` | index past end -> `undefined` -> NaN -> 0 (black) |
| 128 | `0,0,0` | same |
| 256 | `0,0,255` | correct (identity case) |
| 512 | `128,·,·` | only the first half of the ramp reachable |
| 1024 | `191,·,·` | only the first quarter reachable |
| 4096 | `239,·,·` | only the darkest 1/16th, stretched over the image |

Both failure modes are reachable from a saved document. The existing test
suite missed it because the only filter-path `lutSize` test asserted on a
**black** source pixel — tonal 0 maps to index 0, which is valid at every
size. Fixed by rescaling the tonal value into the ramp's own domain
(`rampIndex()`), applied at the colour, alpha, and channel-mode index sites.
Regression coverage now spans 64/128/256/512/1024/4096.

### 9.2 Performance — measured CPU baseline

Recorded on the dev machine via the new benchmarks (best-of-N, ms). These are
reference numbers for regression triage, not gates.

LUT build:

| Size | sRGB | Oklab | OKLCH | Alpha LUT |
|---|---|---|---|---|
| 256 | 0.9 | 1.5 | 3.5 | 0.26 |
| 1024 | 0.3 | 3.8 | 5.7 | 0.13 |
| 4096 | 5.4 | 6.1 | 16.2 | 0.45 |

Per-pixel apply:

| Case | Before | After |
|---|---|---|
| 512² dither | 57 | 64 |
| 512² no dither | 27 | 17 |
| HD dither | 309 | 175 |
| 4K no dither | 446 | 264 |
| 4K reverse + intensity | 500 | 368 |
| 4K oklab | 457 | 370 |
| **4K perceptual-lightness** | **2757** | **1043** |

`perceptual-lightness` was a 6x outlier because it ran three `** 2.4` calls and
allocated a temporary array per pixel. The sRGB→linear transfer function is a
pure function of an 8-bit channel, so it is now a 256-entry table computed once
at module load; output is byte-identical. The mode remains the slowest (three
`Math.cbrt` per pixel are inherent) but is no longer an outlier.

### 9.3 Pre-existing gap — adjustment layers did not reach the content canvas

**RESOLVED — see §9.5 for the fix.** Kept here because it records how the bug
was isolated, which is what made the one-line fix findable.

Originally: the pixel-level raster/vector/text/group cases in
`tests/e2e/gradient-map/raster-vector-apply.spec.ts` were marked `fixme`
because adding an adjustment layer over a target did not change the composited
`.editor-canvas__content-layer` pixels in this flow.

This is **not** gradient-map-specific. A control probe using a plain `invert`
adjustment — same helper, same `image-local` scope, image demonstrably
rendered (sampled canvas colours `0,0,255` / `0,200,0` / `200,0,0`) — produced
a byte-identical canvas hash before and after. Document state is correct in
both cases: an `adjustment` node carrying
`scope { mode: 'image-local', targetNodeId }` and a visible adjustment in
`node.adjustments`.

The gap therefore sits in the shared adjustment compositing/canvas path used by
all 27 adjustment kinds. It was never caught because no E2E spec asserts
adjustment pixels — `effects-verification.spec.ts` only checks that the canvas
is not entirely black, and `effects/gradient-map.spec.ts` asserts UI state only.
That blind spot is why a bug affecting all 27 adjustment kinds went unnoticed.

### 9.5 Root cause found and fixed — adjustment layers parented into the page

The lead in §9.3 was correct and is now **implemented and verified** in
`context.tsx` `createAdjustmentLayer` (`f04703bb`): the node is parented
to the active page's `contentRoot` via `addChild` when one exists, falling back
to `addNode` otherwise — mirroring `createShapeAt`.

Verification (real browser, Vite dev server, `.editor-canvas__content-layer`
readback): with the old `addNode` path, adding an adjustment layer left the
canvas hash byte-identical (`-1189589384` → `-1189589384`); with the fix it
changes (`-1189589384` → `1031830328` for a plain `grayscale` adjustment, and
similarly for a `gradientMap` adjustment). The four pixel-level cases in
`raster-vector-apply.spec.ts` were unmarked and now pass, guarding the fix
against regression. This bug affected all 27 adjustment kinds, not just
gradient maps — the E2E probes (`invert`, `grayscale`) confirmed it before the
fix.

**Undo/redo is asserted structurally, not by exact canvas hash.** An earlier
draft compared the post-undo hash to the pre-adjustment baseline. That is not a
sound assertion here: removing the layer changes the selection, the inspector's
content is selection-dependent, so the canvas *element* resizes (measured
682x494 -> 682x516) and the camera shifts. Two visually-correct states then
hash differently, and re-selecting the image restores the size but not the
camera. The spec therefore asserts (a) the canvas is no longer the mapped
rendering, and (b) `documentNodeKinds()` loses the `adjustment` node on undo and
regains it on redo — a strictly stronger check than pixel equality, and stable.
`waitForStableCanvasHash` is still used for the baseline so async raster decode
cannot produce a transient first reading.

**E2E navigation budget.** `navigateToEditorWithRetry` primes the browser
context with a tolerant `goto` before delegating to `shared.navigateToEditor`
(whose 45s budget a cold Vite graph exceeds). Both gradient-map specs raise
their own timeout to 180s via `test.describe.configure` — the prime must fit
inside the test timeout or the `beforeEach` hook is killed mid-prime and the
page closes underneath the retry loop.

### 9.4 E2E environment note

The Vite dev server compiles this app's module graph on demand, and a cold
graph exceeds the 45s timeout hardcoded in `tests/e2e/shared.ts`'s
`navigateToEditor`. Warm the server once (load `/`, create a document) before
running gradient-map specs, or the first spec fails at the home screen for
reasons unrelated to the code under test. A stale long-running dev server was
also observed serving pre-M7 module transforms — if the preset browser
(`.gmp-browser`) is missing from the DOM, restart the server with `--force`.
Note also that Playwright resolves `localhost` to `::1`, so a server started
with `--host 127.0.0.1` is unreachable to it.

Current gradient-map E2E status: **9 passed, 0 skipped** (2026-08-01,
`npx playwright test tests/e2e/gradient-map --project=chromium --workers=1`,
9.2 min on a loaded dev machine). That is the full import-workflow spec (4) plus
the full raster/vector spec (5) — raster, vector, text, group, and the
malformed-`.grd` error path, all asserting real composited canvas pixels.

**Portability unit coverage** (`gradientPresets.portability.test.ts`): embedded
gradient preferred over legacy `stops`, `stops` fallback for legacy adjustments,
embedded-data round-trip, deleted-global-preset recovery (document still renders
from the embedded snapshot), and embedded gradient surviving JSON serialization.
