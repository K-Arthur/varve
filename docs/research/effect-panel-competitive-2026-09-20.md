# Effect panel competitive research and failure review

**Access date:** 2026-09-20
**Repository:** Varve `master` (working tree already carried unrelated
multi-agent changes; this record describes the Layer Effects inspector surface
at that point).

This record is the evidence base for the Layer Effects inspector design-system
pass: shared parameter controls, full popover preview coverage, execution-stage
visibility, and consistent colour/blend/opacity vocabulary across every effect
editor. It separates documented vendor behaviour from field-reported failures
and states which failures Varve can realistically resolve.

## Primary sources

| Source | Version/date checked | Finding | Decision supported |
|---|---|---|---|
| [Photoshop: Layer style effects and options overview](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html) | current help page, checked 2026-09-20 | Every layer effect exposes Blend Mode and Opacity plus type-specific controls; Drop Shadow/Inner Shadow share Structure (blend, colour, opacity, angle, distance, spread, size) and Quality (contour, noise) groups; "Use Global Light" coordinates shading angle across effects. | Keep per-effect **Blend** and **Opacity** present and identically placed in every editor that supports them; keep geometry before colour; state the render stage rather than inventing a global-light model Varve does not have. |
| [Photoshop: Layer Styles guide (add/remove, contours, global light)](https://www.currypubliclibrary.org/wp-content/uploads/2023/04/PS-3-LAYER_STYLES.pdf) | current documentation, checked 2026-09-20 | Contours control the falloff of shadows and glows through presets and an editable curve; effects are listed under the layer and can be individually shown/hidden; more than one instance of an effect is allowed. | Keep multiple instances per type, per-row bypass, and expose glow contour choice directly instead of hiding it behind a text-only select. |
| [Figma: Apply effects to layers](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers) | current help page, checked 2026-09-20 | Effects stack in a list with drag handles, per-row visibility, and a settings popover; blend modes apply to inner shadows, drop shadows, and noise; render order is **fixed by effect type**, not by list order; reordering is still offered. | Keep drag reorder and move controls, but make the stage constraint visible (the row and popover must say which execution stage the effect belongs to and why a cross-stage move is a no-op). |
| [Figma: Apply blend modes to layers, fills, and effects](https://help.figma.com/hc/en-us/articles/360040667874-Apply-blend-modes-to-layers-fills-and-effects) | current help page, checked 2026-09-20 | Blend mode is available per effect for shadows and noise effects; not every effect type supports it. | Do not fabricate a Blend row for blur types whose model has no `blendMode`; state consistency where the model supports it. |
| [Sketch: Shadows and Inner Shadows](https://www.sketch.com/docs/symbols-and-styles/styling/shadows/) | current docs, checked 2026-09-20 | Shadows and Inner Shadows are separate sections with identical controls (X, Y, blur, spread, colour, blend mode) and support stacking multiple instances of the same kind; context menus convert a shadow to an inner shadow. | Keep shadow/inner-shadow parity (one editor, same vocabulary) and keep duplicate/convert paths available. |
| [Sketch: changelog, blending mode per style component](https://www.sketch.com/changelog/barcelona/) | 2025.2.1 entry, checked 2026-09-20 | `blendingMode` is defined per style component (fill, border, shadow); blur values render with precise decimals; context menus apply to a specific row only when the row is clearly highlighted. | Effect identity must stay legible per row; avoid per-row ambiguity between name, bypass, blend, and remove controls. |
| [Adobe Photoshop community: Layer Styles panel no longer showing live previews](https://community.adobe.com/questions-712/layer-styles-panel-no-longer-showing-live-previews-even-with-the-checkbox-clicked-1548024) | 2026-02 thread, checked 2026-09-20 | Users describe editing effects "blind" when the preview checkbox does not update the canvas. | Every effect popover must keep a visible live preview and the canvas must keep rendering; a preview regression is a blocking defect, not a polish item. |
| [Better UI: Photoshop modal nightmares](http://betterui.blogspot.com/2016/07/photoshop-ui-modal-nightmares.html) | 2016 article, checked 2026-09-20 | The modal Layer Style dialog covers the artwork and forces users to constantly move windows to judge the live result. | Varve keeps an anchored, non-modal popover beside the rail; do not regress to a centered modal, and never let the popover cover the selection. |
| [Photoshop Gurus: Layer Style box obscures the work](https://www.photoshopgurus.com/forum/threads/this-layer-style-box-is-driving-me-crazy.80291/) | 2024-10 thread, checked 2026-09-20 | Reopening the dialog re-centers it over the canvas; users drag it away on every edit. | Preserve the anchored placement contract of `InspectorFocusedEditor` and keep `maxHeight` bounded so the canvas stays visible. |
| [Figma forum: layered box-shadow order reversed in Dev Mode](https://forum.figma.com/ask-the-community-7/layered-box-shadow-order-is-reversed-in-dev-mode-12290) | fixed 2023, checked 2026-09-20 | Exported CSS emitted stacked shadows in reverse authored order, so handoff did not match the design. | Keep one authored order and do not silently re-sort the serialized array; stage-aware editing must not rewrite identity. |
| [Figma forum: auto-layout layer order confusion affecting shadows](https://forum.figma.com/suggest-a-feature-11/first-on-top-layer-order-in-autolayout-35156/index5.html) | long-running thread, checked 2026-09-20 | Users repeatedly report they cannot predict what a shadow will fall on because list order and render order disagree. | Varve's explicit stages plus a visible stage label on the row resolve the same class of confusion without pretending a cross-stage reorder changes pixels. |
| [Sketch forum / Reddit: inner shadow making text disappear](https://www.reddit.com/r/sketchapp/comments/9j1iqr/inner_shadow_makes_text_disappear/) | 2018 thread, checked 2026-09-20 | A rendering regression made text vanish when an inner shadow was active; users could not identify which parameter caused it. | Per-row bypass and per-effect reset must stay one gesture away, and a popover must show the effect type and stage that owns the parameters. |

## Failure modes and Varve resolutions

| Failure reported elsewhere | Why it happens there | Varve resolution in this pass |
|---|---|---|
| "Reordering effects does nothing" (Figma) | Render order is derived from effect type; the list order is not the render order, but nothing says so. | The row shows its execution stage (`backdrop` / `content` / `appearance`) and disabled move controls explain that a move is only meaningful within a stage. |
| "Editing blind" / preview checkbox lies (Photoshop) | A modal dialog detaches from the canvas and preview is a global toggle. | The popover is anchored beside the rail with a live preview tile per effect type and the canvas remains the authority; the preview is never a toggle. |
| "The dialog covers my artwork" (Photoshop) | Centered modal with remembered-but-fragile position. | `InspectorFocusedEditor` stays anchored to the row trigger with bounded height and fallback placements; no centered modal exists in this path. |
| "Which row am I editing?" (Sketch context-menu ambiguity) | Context commands apply to a row that is not visually identified. | One disclosure per row with `aria-expanded`, the row card highlights while its params are open, and the popover header repeats the effect name, type description, and stage. |
| Blend/opacity vocabulary differs per effect | Each editor was written independently. | Shared `EffectBlendRow` / `EffectColourOpacityRow` primitives with percent-based opacity; only effects whose scene model carries the field render them. |
| Contour/origin buried in a two-click select | Text-only select for a small closed set. | `EffectChoiceRow` (segmented control, APG radiogroup) with icons; mixed selections stay representable. |
| "I cannot tell what a blur will do" | Blur names alone do not explain layer vs backdrop. | The popover header renders the effect's catalog description ("Blur elements situated behind this layer"), and every blur family gains a preview tile. |

## What Varve deliberately does not copy

- **Use Global Light** (Photoshop): the scene model has no shared light state;
  inventing a UI-only global would desynchronize documents and export. Local
  angle/distance plus the light pad remain authoritative.
- **Editable contour curves** (Photoshop): Varve's glow contour is a typed
  closed set (`linear` / `smooth` / `sharp`). The UI exposes the set faithfully
  with a shape-preview vocabulary instead of pretending arbitrary curves render.
- **Effect-specific blend for blurs** (Figma also omits it): `layerBlur`,
  `backgroundBlur`, and `depthBlur` carry no `blendMode`; no row is shown.
- **Free-form reordering across render stages**: the serialized array is
  preserved and stage moves are constrained rather than silently rewriting the
  document to satisfy a drag.

## Blend-mode findings (added after review)

| Source | Finding | Resolution |
|---|---|---|
| [Krita Artists: an easier way to find blend modes](https://krita-artists.org/t/an-easier-way-to-find-blend-modes/59637) and [user feedback thread](https://krita-artists.org/t/user-feedback-your-problems-with-selecting-blending-modes/59658) | A long flat blend list is hard to locate; users ask for grouping, search, favourites, and live hover previews; alphabetical ordering is called useless. | The shared `BlendModeField` groups by CSS/PDF family (Darken, Lighten, Contrast, Comparative, Component) and is searchable; row badges show the active mode so a stack is scannable without opening each picker. |
| [Photoshop: blending mode menu stays selected](https://community.adobe.com/questions-712/blending-mode-menu-stays-selected-1089596) and [r/photoshop](https://www.reddit.com/r/photoshop/comments/5tjx28/how_do_i_stop_photoshop_keeping_blend_mode/) | After choosing a mode the dropdown keeps focus, so shortcuts and nudges change the mode by accident until Enter/Escape. | The shared `Select` closes on selection and returns focus to its trigger; the blend field inherits that behaviour. |
| [WHATWG HTML issue 7637](https://github.com/whatwg/html/issues/7637) and [W3C fxtf-drafts 445](https://github.com/w3c/fxtf-drafts/issues/445) | `plus-darker` has no interoperable canvas/CSS implementation; `plus-lighter` maps to `lighter` only. | The engine catalog marks `plusDarker` non-editable with `css: null`, and the Inspector now derives every blend list from `blendModesForDomain`, so a hand-written list can no longer offer a mode the Canvas2D replay throws on. |
| [Color space correctness in alpha blending](https://www.fractolog.com/2024/07/color-space-correctness-in-alpha-blending/) | Browsers composite canvas in the encoded space by default; correct linear blending requires a post-process path. | Documented boundary: Canvas2D replay composites in the encoded space like every peer design tool; the linear-light path is reserved for the blur kernels and the WebGPU backend rather than being claimed for all blending. |

## Picker presentation

- Effect and filter pickers show icons for recognition; every filter kind
  carries its own icon rather than sharing one glyph per family, because
  repetition makes the list effectively text-only.
- Category headings are title case; the shared menu-label uppercase idiom
  reads as shouting in a long chooser and was overridden for this picker.
- No per-entry descriptions in the pickers: a description per row made the
  menu taller than the panel. The only inline qualifier is the disabled
  Depth Blur entry, whose label states the blocker in one line.

## Verification commitments

- Unit tests cover the shared controls, mixed-selection behaviour, and the new
  percent/contour/origin controls.
- The browser workflow spec (`tests/e2e/effects/layer-effects.spec.ts`) adds
  every effect family through the real picker, asserts the popover preview for
  each, and captures screenshots for the visual review.
- `pnpm audit:tokens`, `pnpm audit:inspector-css`, and the emoji/docs gates are
  run for the touched surface.
