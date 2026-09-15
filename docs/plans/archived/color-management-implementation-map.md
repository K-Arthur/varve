# Color-Management Implementation Map (2026-08-03)

Audit of the current color architecture, duplicated modules, affected schemas,
and the recommended dependency order for the color-management program.

## 1. Current behavior

| Concern | Current state | Location |
|---|---|---|
| Document mode switch | `switchColorMode(doc, mode)` performs **analytical** formula conversion (0-255 scale `rgbToCmyk`/`cmykToRgb`/luminance) of every node fill, stroke, effect, gradient stop, swatch, and canvas background. No ICC profiles, no assignment/conversion distinction. | `packages/scene/src/colorMode.ts:149` |
| Mode-switch call sites | 3: `context.tsx:6949` (context command), `DocumentPanel.tsx:68` (silent mode buttons), `ColorConversionDialog.tsx:59` (dialog "Convert"). | editor |
| Managed color | Tagged union `RgbColor \| CmykColor \| GrayColor \| SpotColorRef`. All have `a` (bit-depth-scaled, default 0-255), `bitDepth?`, RGB/CMYK/Gray carry `profile?` (id string only — no fingerprint). **No Lab/LCH/registration/unresolved variants.** | `packages/scene/src/colorManagement.ts:164` |
| Spot color ref | `SpotColorRef` keyed by `name` only — no stable ID, no library id, no tint bounds, no link to `SpotColorDef`. | `colorManagement.ts:146` |
| Spot color def | `SpotColorDef { id, name, library, processFallback, lab?, available? }`. Document-level `Document.spotColors?: SpotColorDef[]`. No authoring UI; picker uses a hardcoded 15-color list. | `colorManagement.ts:177`, `document.ts:216`, `ui/.../SpotColorBrowser.tsx` |
| Text run color | `CharacterFormat.color?: readonly [number,number,number,number]` (legacy tuple); `ParagraphFormat.columnRuleColor` same. Authored at `RichTextSpanEditor.tsx:150-159` (ManagedColor → tuple), rendered at `engine/replay.ts:2083-2085` (`rgba(runFormat.color)`), outlines at `scene/textToOutlines/convertTextToPath.ts:176-179`, SVG codegen at `codegen/src/svg.ts`, contrast preflight at `scene/typographyPreflight.ts:185`. | scene types, editor, engine, codegen |
| Conversions (TS) | Analytical: sRGB gamma, linear RGB, XYZ D65/D50 (Bradford), CIE Lab (D50), Oklab, Oklch, RGB↔CMYK, gamut map to sRGB. `managedColorToRgba` is the canonical reducer (bit-depth aware). Shims of scene types duplicated in shared. | `packages/shared/src/colorConversion.ts` |
| Conversions (Rust) | `strata-colour` crate: `IccEngine` (tintbox), bundled profiles, `rgb_to_cmyk_icc` (GCR/TAC), `srgb_buffer_to_cmyk`, profile validation/parsing. WASM bridge at `packages/engine/src/colourWasm.ts` + `colour/colourLoader.ts`. | `crates/strata-colour/src/{icc,profiles,conversions}.rs` |
| Picker | Spaces: RGB / CMYK / Grayscale / Spot only. `GamutWarning` is HSV-threshold heuristic + process allowlist (documented as UX fallback). No Lab/LCH, no soft proofing, no proof profile. | `packages/ui/src/components/ColorPicker/` |
| Migrations | Sequential `DocumentMigration[]` 0.9 → 2.12, `migrateDocument` / `migrateDocumentDetailed`. `CURRENT_DOCUMENT_VERSION = '2.12'`. | `packages/scene/src/version.ts` |
| Undo/redo | `updateDoc` with undo stacks; transaction grouping via `beginTransaction`/`commitTransaction` (`inTransactionRef`). | `packages/editor/src/context.tsx:2391` |
| PDF export | PDF/X-1a and PDF/X-4 via `strata-print` (`cmyk.rs`). No Separation/DeviceN spot support yet. | `crates/strata-print/src/cmyk.rs` |

## 2. Authoritative modules

- Color types + document config: `packages/scene/src/colorManagement.ts`
- Mode switch: `packages/scene/src/colorMode.ts`
- Analytical conversions + ManagedColor reducers: `packages/shared/src/colorConversion.ts`
- Render-time color reduction: `packages/engine/src/replay.ts` (`rgba()`, `managedColorToRgba`)
- ICC conversion: `crates/strata-colour`, `packages/engine/src/colourWasm.ts`
- Migration: `packages/scene/src/version.ts`
- Picker UI: `packages/ui/src/components/ColorPicker/*`

## 3. Duplicated / divergent modules

- `ManagedColorShim` (shared) vs `ManagedColor` (scene) — intentional (circular-dep avoidance) but **must be kept in sync**; every union extension needs both.
- Analytical RGB↔CMYK exists in `colorMode.ts` AND `colorConversion.ts` (shared) AND `strata-colour/conversions.rs` — three copies of the same formula. `colorMode.ts` copy should be deleted in favor of the shared one.
- `GamutWarning` heuristic vs ICC gamut checks — divergent by design today; task requires proof-condition-based gamut status.
- `whiteForMode` (DocumentPanel) hand-builds mode defaults; should use `defaultColorConfig` helpers.

## 4. Affected schemas (serialization-visible)

- `CharacterFormat.color` — tuple → ManagedColor (migration 2.12 → 2.13).
- `ParagraphFormat.columnRuleColor` — tuple → ManagedColor (same migration).
- `ManagedColor` union — new variants `lab` / `lch` / `registration` / `unresolved`; new fields `profileFingerprint?` on process colors; `spotId?`/`library?` on `SpotColorRef`.
- `SpotColorDef` — extended metadata (exportName, libraryId, manufacturer, code, notes, timestamps, provenance, aliases).
- `Document` — optional `spotLibraries?: SpotLibrary[]`; optional `proof?: ProofConfig` (document-persistent proof state).
- `ColorConfig` — `mode` stays; no destructive re-interpretation on assignment.

## 5. Runtime differences

| Capability | Tauri desktop | Browser |
|---|---|---|
| ICC transforms | Rust `IccEngine` (tintbox) via bridge | WASM `strata_colour` (same engine, loaded from `/wasm/`) or analytical fallback |
| Monitor-profile soft proof | Not available either way (canvas API has no monitor profile hook) | Same — documented approximation |
| PDF spot export | Possible future `strata-print` Separation support | Not available |
| Raster ICC conversion | Rust buffer conversion | WASM buffer conversion / analytical |

## 6. Migrations required

1. `2.12 → 2.13`: text-run color tuples → ManagedColor (detect arrays of 4 numbers; object with `space` already migrated → leave; preserve alpha; infer document profile; keep spot refs unchanged). Also migrate `columnRuleColor`. Idempotent; never depends on installed profile set.

## 7. Performance-sensitive paths

- `managedColorToRgba` per node per frame (replay hot path) — new variants must be cheap; cache keyed by profile fingerprint where ICC involved.
- `extractDocumentColors` walks every node at picker-open.
- Raster ICC conversion — tile/bound/checkpoint; never synchronously on the UI thread.
- Proof rendering — cached transform per (profile pair, intent, BPC, proof config).

## 8. Likely risks

- Union extension ripples: exhaustive `switch (color.space)` sites in shared/engine/scene (compiler will find them; `switch` without default fails on new members only if typed exhaustively — many use `default`; **must add tests**).
- `CharacterFormat.color` migration: documents where the tuple is `undefined` vs missing vs mixed old/new runs; font fallback runs created by shaping; clipboard partial rich text.
- Circular deps: shared must not import scene (shims only); engine must not import editor.
- Hub files (`context.tsx`, `CanvasArea`, `Shell`) must not gain imports — new commands go in extracted hooks/services.
- Complexity ceilings — no new complexity in over-ceiling functions; extract.
- Picker drift: switching modes must not round-trip through RGB and accumulate error.

## 9. Test coverage today

- `colorMode.test.ts` (conversion behavior), `colorManagement.test.ts` + bit-depth tests, `colorConversion.test.ts` (shared), `colorEdgeCases.test.ts`, `cssColorParser.test.ts`, `colorInterpolation.test.ts`, `GamutWarning.test.ts`, `ColorPicker.test.tsx`, `CmykColorFields.test.tsx`, `ColorSpaceSelector.test.tsx`, `SpotColorBrowser.test.tsx`, `InspectorColorPopover.test.tsx`, `ColorConversionDialog.test.tsx`.
- Missing: Lab/LCH conversions + picker modes, migration fixtures for legacy tuples, proof state, spot library model, assignment-vs-conversion semantics, gamut-status by proof condition, property-based round-trip tests.

## 10. Recommended dependency order

1. **M1 Canonical model** — extend `ManagedColor` union + shims + validation + invariants (scene, shared, engine reducers).
2. **M2 Text-run migration** — `CharacterFormat.color` → ManagedColor; version 2.13; all consumers (scene, engine, editor, codegen).
3. **M3 Explicit mode commands** — `assignDocumentColorMode` / `convertDocumentColors`; remove ambiguous `switchColorMode` call sites; dialog + panel semantics.
4. **M4 Conversion service** — CIELab/LCH helpers, deterministic rounding, explicit context objects, shared analytical source of truth (delete `colorMode.ts` formula copy).
5. **M5 Lab/LCH picker** — new picker spaces; achromatic hue memory; no drift; spot preview preservation.
6. **M6 Soft proof + gamut warnings** — proof config state, picker proof preview, canvas proof transform, warning overlay.
7. **M7 Spot libraries** — `SpotLibrary` model, ID-based refs, conflict resolution, project-local persistence.
8. **M8 Spot UI + application** — library panel, spot editor, application to fills/strokes/text/gradients/styles; import/export preservation; PDF Separation validation.
9. **M9 Tests + docs** — property tests, migration fixtures, Playwright, visual, export validation, performance budgets; update `docs/architecture/colour-management.md`.

## 11. Terminology (shared across code, UI, tests, docs)

- **Assignment** — reinterpret stored values under a new profile/mode without rewriting them. May change appearance. Non-destructive to values.
- **Conversion** — transform stored values through source → destination profiles. Rewrites color-bearing properties. Explicit, cancellable, undoable.
- **Output conversion** — export-time transform, source document untouched.
- **Soft proofing** — display-only simulation of an output condition. Never mutates colors.
- **Device simulation** — paper/ink simulation subset of proofing.
- **Spot alternate preview** — process-color simulation of a named ink for display; the paint remains the spot ink.
- **Picker mode** — editing representation (RGB/HSL/HSV/CMYK/Lab/LCH); not a document-space change.
