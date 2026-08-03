# Color Picker & Color-Management Workflow Audit

**Date:** 2026-08-02
**Scope:** End-to-end audit of the color-picker and color-management workflow:
picker components, target binding, state synchronization, undo, conversion
contracts, print/ICC behavior, and test coverage.

Companion docs: `docs/architecture/colour-management.md` (canonical model),
`docs/audits/color-management-print-audit.md` (2026-07-03 print/CMYK audit).

---

## 1. Canonical color model (existing, verified)

The document model already has one authoritative color type:

`ManagedColor` in `packages/scene/src/colorManagement.ts` — a tagged union:

- `{ space: 'rgb', r, g, b, a, bitDepth?, profile? }`
- `{ space: 'cmyk', c, m, y, k, a, bitDepth?, profile? }`
- `{ space: 'gray', v, a, bitDepth?, profile? }`
- `{ space: 'spot', name, tint, a, processFallback? }`

`bitDepth` is `'uint8' | 'uint16' | 'float16' | 'float32'` (default `uint8`);
uint8/uint16 channels are integers, float channels are 0–1 (HDR can exceed 1).

The engine mirrors this in `EngineColor` (TS `packages/engine/src/types.ts`,
Rust `crates/strata-core/src/scene.rs`). The renderer converts all spaces to
sRGB `rgba()` via the single chokepoint `managedColorToRgba()`
(`packages/shared/src/colorConversion.ts:492`).

**Assessment:** the model is sound — one canonical type, bit-depth aware,
profile-tagged, spot support, and a single render conversion path. The defects
are in the **picker workflow**, not the storage model.

## 2. Root causes discovered

| # | Root cause | Evidence | Impact |
|---|---|---|---|
| R1 | `emitRgb()` rewrites the stored color's **space** whenever the picker's display space is CMYK, using naive analytical `rgbToCmyk()`. Editing any control (2D area, hue, alpha, fields, swatch, eyedropper) in CMYK display mode silently converts an RGB fill into a CMYK fill and stores approximate values. | `packages/ui/src/components/ColorPicker/ColorPicker.tsx:109-119` | Document color space changes without intent; RGB↔CMYK disagree; profile-unmanaged values stored as authoritative |
| R2 | Draft HSV state (`useState(s/v/h)`) is initialized once and never resynced when `value` changes externally. Undo, selection change, or gradient-stop switch while the picker is open leaves the 2D area and hue slider stale; the next gesture emits from the stale hue. | `ColorPicker.tsx:100-103` | "The picker shows a different color than it edits"; wrong object target after selection change |
| R3 | Alpha assumed 0–255 regardless of `bitDepth`. `value.a / 255` and `Math.round(a * 255)` break float16/float32 documents (alpha≈0 in slider; emission quantizes). | `ColorPicker.tsx:149,235`; `CmykColorFields.tsx:60-63`; `GrayColorFields.tsx:33-36` | Float documents lose alpha; picker shows wrong transparency |
| R4 | Picker `onChange` is not transaction-wrapped at any integration site (solid fill, stroke, gradient stop, effects, text). Every pointer move calls `updateDoc` → one undo entry per event; a hue drag floods history with 50+ entries. | `FillSection.tsx:330-338` (no `onEditStart/onEditEnd` on popover); `GradientEditor.tsx:383-387` (inline picker not wrapped); `context.tsx:2344-2351` | Undo history unusable; undo "skips" through intermediate values |
| R5 | Hex input accepts only `#RRGGBB`; no alpha forms, no 3/4-digit, no validation feedback; malformed input is silently discarded. | `color-utils.ts:107-115`; `ColorFields.tsx:27-48` | Users cannot enter alpha by hex; no error communication |
| R6 | `SwatchPalette` document/recent sections are dead code — `ColorPicker` renders it with no props; `colorCollections.ts` helpers are unused; recent colors are never recorded. | `ColorPicker.tsx:361`; `packages/editor/src/components/Inspector/color/colorCollections.ts` | Missing standard professional workflow |
| R7 | `CmykColorFields`/`GrayColorFields` and the CMYK/gray conversion in `ColorPicker` assume uint8 (÷255), so 16-bit/float values are misread; converted CMYK values are presented as if native. | `CmykColorFields.tsx:11-12`; `ColorPicker.tsx:328-340` | Precision loss; misleading CMYK authoring |
| R8 | Rust duplicate: `strata-print` has a private copy of `engine_color_rgba` identical to `strata-colour::conversions::engine_color_rgba`. | `crates/strata-print/src/lib.rs:101-139` vs `crates/strata-colour/src/conversions.rs:283` | Two sources of truth drift |
| R9 | Gamut warning is a heuristic (HSV thresholds + process-color allowlist), not profile-based; bit-depth-aware warnings pass raw float channels (0–1) into the 0–255 heuristic. | `GamutWarning.tsx:28-56`; `ColorPicker.tsx:299-306` | Approximation acceptable as fallback; must be labeled and not silently wrong |
| R10 | `CharacterFormat.color` (per-run text color) is a legacy RGBA tuple while node-level text fill is `ManagedColor`. | `packages/scene/src/types.ts:773` | Inconsistent text-color model; tuple loses bit depth/profile |

## 3. Audit matrix

| Consumer | UI entry | Stored repr | Space | Conversion path | Renderer | Undo | Mixed sel | Alpha | Profile | Defects | Sev | Fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fill (solid) | `InspectorColorPopover` (`FillSection.tsx:330`) | `Fill.color: ManagedColor` | native | `managedColorToRgba` | `replayIr` fill | per-call (R4) | index-matched apply-all (`updateSelectedFillAt`) | yes | tagged | R1, R4 | High | R1/R4 fixes |
| Fill (gradient stop) | inline `ColorPicker` (`GradientEditor.tsx:383`) | `GradientStop.color` | native | same | gradient stops | per-call (R4) | n/a | yes | tagged | R2, R4 | High | R4 fix + draft sync |
| Stroke | `InspectorColorPopover` (`StrokeSection.tsx:276`) | `Stroke.color` | native | same | stroke path | per-call (R4) | commonValue | yes | tagged | R1, R4 | High | R1/R4 |
| Text (span) | `InspectorColorPopover` (`RichTextSpanEditor.tsx:150`) | `CharacterFormat.color` tuple (R10) | RGB only | tuple→rgba | text run | per-call | per-span | yes | none | R10 | Med | documented |
| Effects (shadow/glow) | `InspectorColorPopover` (`EffectsSection.tsx:527`) | `Effect.color` | native | same | effect shadow | per-call (R4) | per-node | yes | tagged | R4 | Med | R4 |
| Canvas background | `InspectorColorPopover` (`DocumentPanel.tsx:44`) | `Document.canvasBackground` | native | `rgba()` / css | board fill | per-call | n/a | yes | tagged | R1 | Med | R1 |
| Gradient map / duotone / adjustments | inline `ColorPicker` ×8 | adjustment node params | native | same | LUT pipeline | via adjustment | n/a | yes | tagged | R2, R4 | Med | R4 + draft sync |
| Swatches | `SwatchPalette` (theme only live) | — | RGB tuple | — | — | — | — | yes | none | R6 | Med | wire props |
| Eyedropper | native `EyeDropper` API | sRGBHex→tuple→emit | sRGB | R1 path | — | per-pick | — | no (255) | none | R1 | Med | R1 + document |

## 4. Verification status

- Baseline focused suites green: `packages/ui` ColorPicker (26 tests), shared
  `colorConversion` (49), editor inspector popover tests — all pass.
- No color-picker Playwright E2E spec exists (only glass/effects swatch specs).
- WebKitGTK/Tauri runtime verification not performed in this audit (dev-time
  manual checks only).

## 5. Fix plan (by milestone)

1. **Picker emission + draft sync + bit-depth alpha** (R1/R2/R3/R7).
2. **Undo transaction grouping for picker gestures** (R4) — one undo per gesture.
3. **Full hex input forms + validation** (R5).
4. **Wire document/recent swatches + recent-color recording** (R6).
5. **Dedupe Rust `engine_color_rgba`** (R8).
6. **Document decisions** (R9 gamut-heuristic label, R10 text-color model).
