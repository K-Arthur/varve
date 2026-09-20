# Layer Effects

**Date:** 2026-09-13 | **Status:** Verified in the Canvas2D/editor and structured export paths

Layer Effects are non-destructive appearance effects owned by the scene node
that produces the pixels. They are distinct from Object Filters (adjustment
operations) and from Effect Studio recipes. The scene model, inspector,
transfer helpers, worker replay, structural replay, and export planning all
read the same `Effect[]` contract.

## Eligible owners

| Owner | Layer Effects | Coverage source |
| --- | --- | --- |
| Shape, path, component instance | Yes | Vector fills and strokes |
| Text | Yes | Shaped glyph alpha, decorations, and strokes |
| Group and frame | Yes | Composited child surface |
| Table | Yes | Composited table surface |
| Raster layer | Yes | Sparse tile surface and true tile alpha |
| Image-filled vector | Yes | Placed image alpha, crop, and background-removal mask |
| Adjustment layer | No | Its scope is the adjustment/filter pipeline, not a drawable silhouette |

Raster layers created by current code always receive `effects: []`. Document
normalization materializes that array for older files before editing. A
capability check still recognizes a legacy raster layer before normalization,
so adding an effect cannot silently do nothing.

## Execution order and editing order

The authored array preserves entry identity and masks. Rendering uses stable
execution stages. Live Canvas2D group replay and structured export replay
share their content/backdrop implementation in
`packages/editor/src/render/groupEffectStages.ts`; preview and export therefore
do not silently choose different group-effect semantics.

1. **Backdrop:** Background Blur and Glass Material backdrop acquisition.
2. **Content:** fills/strokes followed by Layer Blur, Depth Blur, Chromatic
   Aberration, and Glitch.
3. **Appearance:** Drop Shadow, Inner Shadow, Outer Glow, and Inner Glow.
4. **Material highlight and post-processing:** Glass edge highlight and any
   required final compositing.

The inspector exposes one compact list, but its move controls are stage-aware:
an entry can move only to the nearest entry in the same execution stage. A
cross-stage move is disabled because it would not change pixels. Within a
stage, differently coloured shadows/glows retain meaningful authored order.
The serialized array is not silently sorted behind the user.

## Coverage and spread

Geometric replay is used only when it is equivalent to the painted coverage.
Text, raster layers, image fills, gradients, patterns, translucent fills,
compound paths, and stroke-only paths use an alpha-silhouette source. Raster
and image sources therefore preserve transparent holes, sparse tiles, crop
placement, and mask alpha; path fill rules preserve authored vector holes. A
missing offscreen buffer skips the optional effect rather than painting a
rectangular fallback over editable content.

Positive and negative spread are applied as bounded alpha dilation/erosion in
the alpha-aware path. Spread is not folded into `shadowBlur`; blur remains a
softness radius. Bounds include absolute spread, directional offsets, depth
blur, chromatic offsets, and glitch displacement conservatively.

Backdrop caches are scoped to a single replay. A new document revision or
underlying-content change therefore cannot reuse a stale backdrop merely
because the camera and effect geometry are unchanged.

## Identity, masks, and history

Every authored effect has a stable ID. Legacy IDs are deterministic during
normalization. Duplicate and transfer operations deep-clone nested parameters
and mint independent IDs. Effect masks are resolved by effect ID, not array
position; reset retains the mask while remove, duplicate, reorder, and transfer
keep mask ownership attached to the correct entry. Mask edits use one editor
transaction and validate scene-node/vector/raster sources and cycles.

Mixed selection uses the first non-empty compatible stack as the display
reference, aligns other owners by ID and then by same-stage/type ordinal, and
marks missing rows rather than showing an unrelated effect at the same array
index. Editing an absent row leaves that owner unchanged. Add appends a valid
default to every eligible owner, including empty and legacy raster stacks.

## Persistence and export

The canonical scene field is `effects`; raster-layer canonical ordering and
document normalization include it. Native/Rust interchange transports the
effect variants, but Canvas2D/software replay remains authoritative for
effects that a target cannot reproduce natively. SVG/PDF/export consumers must
rasterize the smallest affected compositing region when a target lacks the
required blur, backdrop, alpha, mask, or procedural semantics. Text, vector
geometry, and source raster assets remain editable in the document. The
structured raster replay applies group-owned backdrop, content, and appearance
effects to the flattened group surface before that region is emitted, including
background blur, glass, depth/spatial blur, chromatic aberration, glitch, and
multiple layer-blur entries. A raster region in a portable export is explicitly
appearance-only.

For pass-level details, see
[Effect Rendering Architecture](effect-rendering.md). The marketing website
has a matching user-facing Layer Effects feature page.

## Inspector UI Architecture (2026-09-16 Redesign)

The Layer Effects section (`EffectsSection.tsx`, 269-line orchestrator) in the
Design tab coordinates individual effect cards and anchored parameter popovers.
It is modularized under
`packages/editor/src/components/Inspector/sections/effects/`:

1. **Card-Style Effect Row (`EffectRow.tsx`)**:
   - Distinct card container with hover highlight, visibility switch, swatch
     trigger where the effect exposes a colour, type icon, and name.
   - **One disclosure control per row.** The card previously carried both an
     expand chevron and a duplicate "Configure" button that toggled the same
     state; the single trigger now owns `aria-expanded`, `aria-controls`, and
     `aria-haspopup="dialog"`.
   - **Direct in-row blur scrubber**: Single-parameter effects (`layerBlur`,
     `backgroundBlur`) expose an inline number input (`[ 4 px ]`) so blur radius
     can be adjusted immediately without opening any dialog.
   - **Popover anchor invariant**: the parameter popover anchors to the
     disclosure *trigger*, never to the row card. A ref to an ancestor host
     node is still `null` when a descendant's layout effect runs (React attaches
     refs post-order), and `FloatingPortal` resolves its anchor on mount — so
     the anchor must be an element committed before the portal. Anchoring to
     the row card leaves the popover latched in the hidden measuring state.
   - **Random access per row**: the actions menu holds reset, duplicate,
     reorder, and remove; destructive actions stay separated.

2. **Unified Shadow Popover (`ShadowParams.tsx`)**:
   - **Header stage badge**: the effect stage (`backdrop` / `content` /
     `appearance`) renders in the popover header beside the title instead of
     taking a body row.
   - **Live Preview Tile (`EffectPreviewTile.tsx`)**: a compact real-time
     rendering of the contour directly inside the popover.
   - **1-Click Elevation Presets**: Standardized modern elevation chips
     (`Subtle / E1`, `Medium / E2`, `Raised / E3`, `Dramatic / E4`, `Ambient`,
     `Graphic`) instantly setting X, Y, Blur, Spread, and Opacity. The active
     chip is detected from the live values.
   - **Direction block**: the 2D light pad (`EffectLightPad.tsx`) and its polar
     Angle/Distance fields share one surface, so the same vector is not
     presented as three disconnected groups. The pad keeps cartesian X/Y and
     polar angle/distance synchronized, with compass snaps (Down 90°, 45°,
     135°, Center 0) and arrow-key steering.
   - **Boxed quad grid** (`X`, `Y`, `Blur`, `Spread`) with icon-prefixed fields
     and an integrated Colour & Opacity row plus Blend select.

3. **Glow / Blur / Material / Distortion Editors**:
   - `GlowParams.tsx` pairs Spread+Choke and Contour+Origin (inner glow only)
     in two-up groups and folds Opacity into the colour row.
   - `BlurParams.tsx` keeps the radius chips and exposes the spatial-blur
     gallery and depth-blur geometry.
   - `DistortionParams.tsx` puts Chromatic Aberration's Intensity, Opacity, and
     Mix on one row; glitch internals stay behind the existing Advanced
     disclosure.
   - `GlassMaterialParams.tsx` keeps the grouped backdrop/tint/edge layout.

4. **Effect Mask Authoring (`EffectMaskControl`)**:
   - The source select is always visible for content-stage effects.
   - Once a mask is bound, the secondary controls (type, density, feather,
     invert, coordinate space) live behind a compact "Mask settings"
     disclosure instead of adding five permanent rows.
   - Effect types whose renderers ignore masks show a quiet one-line note
     (`role="note"`) rather than a filled callout box.

5. **Categorized Effect Discovery (`EffectTypes.ts`)**:
   - Groups the 16 effects into semantic categories: *Shadows & Glows*,
     *Surface & Blur*, *Photographic (Blur Gallery)*, and *Stylistic & Distortion*,
     with recognizable icons and clear labels; the shared `Menu` primitive
     renders category labels and separators.

### 2026-09-20 — One-step add, shared parameter vocabulary, full preview coverage

Evidence and competitive failure analysis:
`docs/research/effect-panel-competitive-2026-09-20.md`.

- **One-step add.** Choosing a type in the header picker adds it immediately;
  the former "select a type, then press Add" confirm step was removed. The
  picker matches the Fill ("Add fill") and Object Filters ("Add Object Filter")
  controls. Repeated adds build the stack; same-type repetition with tuned
  values stays available through each row's Duplicate action. A disabled
  Depth Blur entry states its blocker (needs a DepthMap from the image
  workflow) instead of dead-ending.
- **Inline stack actions.** Move up/down chevrons and Remove live on the row;
  only Reset and Duplicate remain in the row menu. Move chevrons are secondary
  to the drag handle (revealed on hover/focus for fine pointers, always
  visible for touch).
- **Row-click editor access.** Clicking the card body (name, type icon, stage
  chip, empty space) toggles the parameter editor. Interactive children keep
  their own behaviour, and the labelled chevron remains the keyboard/AT
  disclosure trigger; the card is registered as an inside region so a click
  toggles instead of dismiss-and-reopen.
- **Stage legibility.** Every row carries a stage chip (`Backdrop` /
  `Content` / `Appearance`) whose tooltip states what the stage does, and a
  disabled move control's title explains that the effect is already
  first/last in its stage. This is the direct answer to the recurring
  "reordering effects does nothing" complaint in tools whose render order is
  type-derived but whose list order is free.
- **Popover context.** The popover header keeps the effect name, stage badge,
  and Close control on one row. Per-entry descriptions were deliberately
  removed from the add picker and the popover: a description per row made the
  picker taller than the panel. Only the disabled Depth Blur entry states its
  blocker, inline in the label.
- **Blend modes have one resolver.** Every blend selector reads
  `blendModesForDomain` from the engine applicability catalog through
  `BlendModeField` (grouped, searchable, closes on selection), and non-normal
  modes read on the row. The hand-written Fill list that offered the
  non-editable `plusDarker` mode (which made Canvas2D replay throw) is gone.
- **Picker presentation.** Effect and filter pickers carry one icon per kind
  (repeated glyphs made them effectively text-only) and title-case category
  headings; the shared menu-label uppercase idiom is overridden for the
  effect picker, and adjustment/layer-state titles no longer transform to
  uppercase.
- **Shared parameter controls (`EffectControls.tsx`).** `EffectBlendRow`,
  `EffectColourOpacityRow` (colour swatch + percent opacity, "Mixed" value
  text for disagreeing selections), `EffectPercentField` (0..1 model values
  shown as percentages), `EffectChoiceRow` (segmented radiogroup for closed
  sets, mixed-safe), and `EffectToggleRow` (canonical Switch) are the only
  vocabulary the editors use. Blur effects whose model has no `blendMode` do
  not render an empty Blend row.
- **Control order is uniform:** preview, geometry, closed-set quality choices,
  colour, blend. Glow geometry now precedes colour; the colour-treatment
  choice, contour, and origin are segmented controls with icons; chromatic
  aberration and glitch expose opacity/mix/density as percentages.
- **Preview coverage for every family.** `EffectPreviewTile` now renders a
  symbolic preview for all 16 effect types, including the spatial blur
  gallery, Depth Blur, Chromatic Aberration (declared channel colours or
  custom contribution colours), and Glitch. Gradient glows render both
  endpoint colours. The canvas remains authoritative; the tile is labelled
  "Preview of <effect>".
- **Swatch accuracy.** The row colour chip renders the gradient ramp for
  gradient-mode glows instead of the first stop, and glass exposes the
  previously hidden `edgeHighlightOpacity` alongside the edge colour.
- **Boolean consistency.** Glass edge highlight, depth-blur inversion,
  channel-offset linking, and chromatic contribution enablement use the
  canonical `Switch` rather than bespoke pressed buttons.

## Known renderer gaps (verified 2026-09-13)

An executed audit (code inspection + tests, not documentation) found these
fidelity gaps. They are stated here so the staged contract above is not read
as a claim about every renderer:

- **Effect masks are applied to the content pass only.** `dropShadow`,
  `outerGlow`, `innerShadow`, `innerGlow`, `backgroundBlur`, and
  `glassMaterial` ignore `effect.mask` in every renderer. The Inspector hides
  mask authoring for those types (`effectSupportsMask`) and keeps an existing
  authored mask removable; a future implementation needs a declared
  mask-combination contract before enabling the control.
- **Content-stage effect masks are now resolved by live structural replay and
  export/thumbnail replay.** Scene-node, vector, and document-owned raster
  sources share the engine's premultiplied cross-fade, coordinate-space
  projection, feather, inversion, and density semantics. The flat worker path
  remains ineligible for a visible effect mask, and missing sources preserve
  the unmasked evaluated effect as the safe fallback.
- **Effect degradation is declared, not silent.** Engine replay reports typed
  diagnostics (`effect-surface-unavailable`, `effect-mask-unresolved`,
  `effect-mask-budget`, `effect-mask-unsupported`, `effect-depth-missing`) via
  `replayIr`'s `onEffectDiagnostic` sink, and the shared group/frame effect
  stages forward the same diagnostics from their surface, mask, depth, and
  backdrop catches. Structured export maps them into
  `ExportSnapshot.diagnostics` and the export warnings; live replay forwards
  them into a bounded, deduplicated CanvasArea announcement. Export
  rasterization failures additionally report `pixel-budget-exceeded` /
  `surface-unavailable` / `encode-failed`. Remaining blind spots: the
  `filterCompositor` `onDiagnostic` hook still has no production caller, and
  shadow-source null-buffer fallbacks inside `shadowSource.ts` are not yet
  wired to the sink.
- **Frame-owned effects are evaluated on a bounded frame surface** after the
  frame base and descendants are composited, so `layerBlur`, content-stage
  masks, backdrop effects, and supported appearance effects see the same
  frame-owned surface as a group. Allocation refusal falls back to source
  replay; frame masks and appearance-stage effect masks retain the explicit
  unsupported-mask policy above.

Fixing these is tracked in `docs/audits/layer-fidelity-2026-09-13.md`.
