# Inspector Effects Section & Popovers Redesign Audit

**Date:** 2026-09-16
**Status:** Verified — unit, typecheck, and real-world browser scenarios
**Scope:** Design tab → Layer Effects (`sections/effects/`, `EffectsSection.tsx`,
`InspectorFocusedEditor.tsx`)

---

## 1. Context & Motivation

The previous Layer Effects section was a single 2,762-line
`EffectsSection.tsx` with these user-facing problems:

1. **Disjointed colour & geometry**: colour lived on the row card, while
   offsets, blur, spread, opacity, and blend mode were buried in a popover
   anchored to a different button. Tuning a shadow meant moving between two
   surfaces.
2. **Number guessing**: every shadow started from raw X/Y/Blur/Spread numbers;
   there was no notion of a card elevation, a modal shadow, or a hard graphic
   offset.
3. **Detached popover anchoring**: the expansion chevron and the "Configure"
   button toggled the same state, but the popover tracked the button, not the
   row, so the relationship between card and panel was unclear.
4. **Modal overhead for one number**: changing a layer/background blur radius
   required opening a floating dialog for a single field.
5. **No visual light direction**: angle had to be computed mentally or typed as
   degrees; there was no 2D steering affordance.
6. **Uncategorized discovery**: the add menu listed 16 effects flat.
7. **Uncontrolled file growth**: 2,762 lines in one module with a very large
   cyclomatic surface.

---

## 2. Research & Competitive Failure Analysis

The redesign targets failure modes users actually report in shipping tools, not
only "what good looks like":

| Tool / Pattern | Known failure / complaint | Resolution shipped |
| :--- | :--- | :--- |
| **Figma UI3 floating panels** | Floating panels obscure the artwork being edited ("blind design"); subtle 1px shadows are impossible to judge behind a panel. | The inspector rail stays docked; the popover sits beside the rail and includes a compact live preview tile, while single-value blurs are editable directly in the row. |
| **Disjointed colour vs shadow geometry** | Colour is in one place, offsets/blur in another; users bounce between surfaces. | The shadow popover contains presets, light pad, quad grid, colour, opacity, and blend in one surface. |
| **No elevation standards** | Designers hand-roll inconsistent, dated shadows. | Six elevation presets (E1–E4, Ambient, Graphic) set the full geometry and opacity in one click; the active preset is detected from live values. |
| **Angle dial intimidation (Photoshop/Illustrator)** | A static degrees dial plus no numeric fallback. | The light pad keeps polar Angle/Distance numeric fields in the same block, plus compass snaps and arrow-key steering. |
| **Penpot backdrop-blur ergonomics** | Background blur is hard to reason about and easy to misconfigure. | Background blur is a first-class row with an inline radius scrubber and a stage badge ("backdrop stage") in the popover header. |
| **"Configure" vs "expand" ambiguity** | Two controls for one action, and users cannot tell which opens the panel. | Exactly one disclosure trigger per row, with `aria-expanded`/`aria-controls`/`aria-haspopup="dialog"`. |
| **Advanced settings always visible** | Mask and glitch internals permanently expand the panel. | Secondary controls (mask settings, glitch internals, depth-blur geometry) sit behind compact, keyboard-accessible disclosures. |

---

## 3. What Shipped

The monolith is decomposed under
`packages/editor/src/components/Inspector/sections/effects/`:

| Module | Lines | Responsibility |
| :--- | ---: | :--- |
| `EffectsSection.tsx` (orchestrator) | 269 | Row list, add/remove/duplicate/reset/reorder, batch multi-select edits, transactions |
| `EffectTypes.ts` | 356 | Effect union helpers, categorized catalog, elevation presets, blur presets, blend options, row alignment |
| `EffectRow.tsx` | 550 | Card row, visibility switch, swatch, in-row blur input, single disclosure trigger, actions menu, mask control |
| `ShadowParams.tsx` | 352 | Preview, elevation presets, light pad + polar fields, quad grid, colour/opacity/blend |
| `GlowParams.tsx` | 313 | Solid/gradient treatment, colour+opacity, spread+choke, contour+origin, blend |
| `BlurParams.tsx` | 480 | Single blur + spatial gallery + depth blur |
| `DistortionParams.tsx` | 795 | Chromatic aberration (RGB/custom channels) and glitch + advanced |
| `GlassMaterialParams.tsx` | 184 | Backdrop blur, tint/grain, edge specular |
| `EffectLightPad.tsx` | 236 | 2D direction/distance controller with keyboard + snap support |
| `EffectPreviewTile.tsx` | 84 | Compact live preview surface |
| `effects.css` | 399 | All new styles (solid surfaces, no glassmorphism) |

The row editor is anchored through `InspectorFocusedEditor` (shared control),
which gained a header badge slot for the effect stage.

---

## 4. Clutter-Reduction Pass (2026-09-16 continuation)

Functionality and accessibility were held constant; only duplicated or
always-expanded surface was removed.

| Area | Before | After |
| :--- | :--- | :--- |
| Row controls | chevron **and** a duplicate Configure button toggling the same state | one disclosure trigger; the actions menu remains separate |
| Popover body | a full row for the `appearance/content/backdrop` badge | badge rendered in the popover header beside the title |
| Direction controls | light pad block **and** a separate Angle/Distance row | one direction block: pad + snaps + polar fields on a shared surface |
| Mask editor | source select **plus** 5 always-visible fields once bound, plus a filled callout for unsupported types | source select + "Mask settings" disclosure (type, density, feather, invert, coordinate space); unsupported types show a quiet one-line note |
| Shadow preview | 5.5 rem tile | 4.25 rem compact tile (contour confirmation, not a canvas) |
| Glow editor | 9 stacked rows | 6 rows (colour+opacity paired, spread+choke paired, contour+origin paired) |
| Chromatic aberration | Intensity/Opacity row + full-width Mix row | Intensity/Opacity/Mix on one row |
| Dead CSS | local menu-item styles, unused config-trigger/type-icon/header-title rules | removed |

No control was removed: every value that was editable before is editable
through the same primitives (spinbuttons, selects, switches, colour popovers),
with the same accessible names.

---

## 5. Defects Found During Validation and Fixed

1. **Popover stuck in the hidden "measuring" state.** After any document edit
   while a popover was open, the surface flapped hidden. Root cause:
   `InspectorFocusedEditor` passed a fresh `fallbackPlacements` array literal on
   every render, so the placement effect restarted and reset the surface to
   `visibility: hidden`. Fixed with a module-level constant.
2. **Popover never mounted when anchored to the row card.** A ref to an
   ancestor host node is still `null` when a descendant's layout effect runs
   (React attaches refs post-order) and `FloatingPortal` resolves the anchor
   once on mount, so the surface latched closed. The popover now anchors to the
   disclosure trigger, which is committed before the portal.
3. **`GlowParams` referenced non-existent scene types** (`GlowContour`,
   `InnerGlowOrigin`) and used a `'soft'` contour value that the scene union
   rejects (correct value: `'smooth'`). Fixed with local unions.
4. **`EffectLightPad` accepted unused `x`/`y` props**; removed rather than
   left as a misleading API.
5. **Corner-radius E2E assertion used `getByLabel('TL')`.** The redesigned
   corner fields keep visible short labels but full unit-suffixed accessible
   names ("Top left (px)"). The spec now asserts both the visible label and the
   accessible name.

---

## 6. Verification Results

1. **Unit tests** (`pnpm vitest run` on the two suites):
   - `EffectsSection.test.tsx`: 32/32 passed.
   - `effectsRedesign.test.tsx`: 7/7 passed (elevation preset application, 2D
     light pad + snaps, in-row blur editing, quick radius chips, live preview).
2. **Typecheck**: the effects module and `InspectorFocusedEditor` introduce no
   `tsc` errors. (Workspace-wide `@varve/editor` has pre-existing errors in
   concurrently edited, unrelated modules.)
3. **Real-world browser scenarios** (`tests/e2e/inspector/effects-realworld.spec.ts`,
   Chromium, one worker):
   - UI card elevation workflow: add a drop shadow, apply the Raised (E3)
     preset, verify Y=10 / Blur=20 / Spread=−3 / Opacity=18, steer the light
     pad, and verify the popover is a solid, `backdrop-filter: none` surface.
   - In-row blur: type a radius directly in the row and select a 48px chip in
     the popover; both stay in sync.
   - Multi-effect composition: shadow + blur rows, visibility toggling.
4. **Structural row/quad checks** (`effects-shadow-redesign.spec.ts`): the row
   is a real card with a switch, circular swatch, and the boxed shadow quad;
   the corner-radius quad keeps the same treatment.
5. **Visual evidence**: `docs/screenshots/effects-redesign/`
   (`shadow-studio-popover.png`, `blur-studio-popover.png`,
   `multi-effects-composition.png`).

---

## 7. Known Gaps (honest status)

- Effect masks remain content-stage only (see `layer-effects.md` §Known
  renderer gaps); the inspector hides authoring for types that ignore masks.
- The in-row blur input is intentionally limited to `layerBlur` and
  `backgroundBlur` (the two single-parameter blurs); richer blur types keep
  their parameter popovers.
- The `EffectPreviewTile` is an approximation built from CSS box-shadow/filter;
  the canvas is the authoritative preview. It is labelled as an effect preview,
  not a render.
