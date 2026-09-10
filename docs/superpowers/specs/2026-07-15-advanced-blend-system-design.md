# Advanced Blend and Adaptive Contrast System Design

**Status:** Approved for implementation on 2026-07-15  
**Scope:** Scene schema, Canvas2D reference rendering, WebGPU routing, native/WASM
wire parity, groups and frames, masks and effects, adaptive text contrast,
Inspector UX, persistence, clipboard, SVG/PDF/raster export, and conformance tests.

## 1. Goals

Strata will provide predictable, non-destructive compositing for text, images,
vectors, raster layers, frames, groups, fills, strokes, and effects. Preview,
save/reload, clipboard, and export must preserve the same appearance or report an
explicit compatibility action. No renderer or exporter may silently replace an
unsupported blend mode with Normal.

The supported standard set is:

- Normal
- Darken, Multiply, Color Burn
- Lighten, Screen, Color Dodge
- Overlay, Soft Light, Hard Light
- Difference, Exclusion
- Hue, Saturation, Color, Luminosity

Pass Through is a group compositing policy, not a pixel blend formula. Plus
Lighter is supported for raster preview/export through an explicit composite
operator. Plus Darker remains readable as a legacy value but is hidden from
normal editing surfaces until every active preview path has an exact supported
implementation. Unsupported legacy values are preserved for recovery, surfaced
as compatibility issues, and never executed as Normal without notice.

## 2. Research and Compatibility Basis

The mathematical authority is W3C Compositing and Blending Level 1. Its blend
functions operate on straight color values, followed by Porter-Duff compositing
in premultiplied form. Group behavior follows group invariance and isolated-group
backdrop rules.

Product semantics follow the common intersection of Photoshop, Illustrator,
Affinity, Figma, and Sketch:

- groups default to Pass Through;
- changing a group to Normal or a creative mode establishes a compositing
  boundary;
- layer, fill, stroke, and supported effect blends are independent properties;
- previews are live and modes are grouped by visual purpose;
- isolation is explicit and inspectable.

Primary references:

- <https://www.w3.org/TR/compositing-1/>
- <https://html.spec.whatwg.org/multipage/canvas.html#compositing>
- <https://gpuweb.github.io/gpuweb/#color-space-conversions>
- <https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.4.pdf>
- <https://helpx.adobe.com/uk/photoshop/using/layer-opacity-blending.html>
- <https://helpx.adobe.com/illustrator/using/transparency-blending-modes-alt.html>
- <https://help.figma.com/hc/en-us/articles/360040667874-Use-blend-modes-to-create-unique-effects>
- <https://affinity.help/photo2ipad/en-US.lproj/pages/Layers/layerBlendModes.html>
- <https://www.sketch.com/blog/blend-modes/>

Canva has no public authoritative contract for general layer blend modes, so it
is not treated as a conformance target.

## 3. Audit Findings and Root Causes

The existing system contains useful pieces but not a coherent compositing
contract:

1. `blendModes.ts` and `compositeCanvas.ts` duplicate blend formulas. Both omit
   the `alphaSource * (1 - alphaBackdrop) * sourceColor` contribution for
   partially transparent backdrops. Opaque swatch tests therefore pass while
   antialiased and translucent edges are wrong.
2. Raster brush compositing has a third formula implementation with source-over
   errors, incorrect Dodge/Burn equations, and inconsistent mode naming.
3. Normal and Pass Through groups currently share behavior, so child blends can
   escape a Normal group.
4. WebGPU eligibility checks geometry only. The GPU path ignores artistic blend
   modes and much of appearance state, can reorder mixed GPU/Canvas content, and
   has no real hardware pixel conformance coverage.
5. The Canvas2D raster-layer compositor accepts a mode argument but ignores it.
6. Native/WASM Rust fields and enum values do not consistently serialize to the
   TypeScript camelCase contract, causing modes to default, disappear, or reject
   a batch.
7. Strokes inherit fill alpha/blend state; several blur, shadow, and glow paths
   apply opacity twice or composite behind the whole prior scene.
8. Structured alpha/luminance-mask export invokes the enhanced mask helper with
   an empty content callback, so it does not mask the already rendered content.
9. Frames clip descendants but do not composite opacity, blend, masks, and
   effects over the subtree as one container.
10. SVG/code export drops node opacity, blend, isolation, and stacked-fill
    semantics. PDF correctly rejects some structural cases but the Rust writer
    does not emit the required transparency graphics state for supported cases.
11. Migrations and the document codec do not normalize blend aliases or validate
    domain applicability. Group factories default to Normal despite documented
    pass-through behavior.
12. Inspector surfaces expose inconsistent mode subsets, lack persistent group
    isolation controls, and can display a stored unsupported value as “Mixed.”
13. Clipboard payloads copy nodes but omit referenced Paint records.
14. Automatic Contrast does not exist in schema, rendering, UI, persistence, or
    export.

## 4. Modular Architecture

### 4.1 Blend domain

`@varve/engine` owns a small blend domain with no scene or UI dependencies:

- a canonical catalog containing stable document id, CSS name, PDF name,
  category, and applicability;
- exact separable and non-separable W3C functions;
- straight-to-premultiplied RGBA composition;
- explicit Porter-Duff/Plus Lighter operators;
- validation and capability negotiation;
- shared numeric conformance vectors.

All software consumers, including raster brush compositing and export fallback,
call this domain. Duplicate formulas are removed. Unknown ids return a typed
unsupported result; they do not return Normal.

### 4.2 Scene semantics

`@varve/scene` owns document meaning:

- ordinary objects default to Normal;
- groups default to Pass Through;
- Normal and every creative group mode create an isolated group boundary;
- Pass Through allows children to use the parent backdrop;
- legacy groups are migrated to Pass Through where old Normal represented the
  previous non-isolated behavior;
- aliases such as kebab-case and legacy Rust lowercase values are normalized at
  the document boundary;
- invalid values are retained in compatibility metadata and replaced only after
  an explicit user action.

The existing `isolated` field is normalized with group mode rather than acting as
an independent contradictory switch. The UI presents “Isolate child blending”;
for a Pass Through group, enabling it changes the group to Normal. Creative group
modes are necessarily isolated.

### 4.3 Render graph

The editor builds a backend-neutral render graph containing ordered leaf draws,
bounded isolation scopes, masks, clips, object effects, backdrop reads, and final
composite operations. Canvas2D structured replay is the reference backend.

Backends advertise support for a complete render operation, not merely a
primitive kind. The router keeps stable paint order by partitioning only
contiguous supported runs. WebGPU never receives an item whose fills, strokes,
effects, masks, filters, transform, color space, alpha, or blend semantics it
cannot reproduce. Device loss invalidates GPU resources and resumes through the
reference backend without changing pixels.

## 5. Rendering and Compositing Order

For each object:

1. render visible fills in stack order, applying each fill opacity and mode;
2. render strokes independently with their own opacity and mode;
3. render object-local effects into the bounded object surface;
4. apply clipping and masks to the completed object result;
5. apply object opacity once;
6. blend against only the already rendered backdrop;
7. composite the result into its parent scope.

For isolated groups and frames:

1. begin with transparent black;
2. render children in document paint order;
3. apply container clipping/mask;
4. apply container effects;
5. apply container opacity once;
6. blend the flattened result with the parent backdrop.

Pass Through groups render children directly into the parent scope unless a mask
or effect requires an intermediate. In that case the renderer preserves
non-isolated backdrop semantics instead of treating allocation as implicit
isolation.

Shadows, glows, outside strokes, and filters use object-local surfaces so they
cannot erase or fall behind earlier siblings. Backdrop blur and adaptive contrast
receive an explicit snapshot that excludes the source object. Cache keys include
document/render version, scope, paint-order boundary, transform, effect
parameters, and color space.

## 6. Color and Alpha Policy

Standard design-tool compatibility modes operate in the encoded document RGB
blend space. The first implementation supports explicit sRGB compatibility.
Managed input colors and embedded image profiles are converted to the document
blend space before compositing. The renderer does not mix untagged WebGPU numeric
textures with color-managed Canvas pixels.

Blend functions receive straight colors. Source and backdrop alpha are applied
with the W3C equation:

```text
alphaOut = alphaSource + alphaBackdrop * (1 - alphaSource)

alphaOut * colorOut =
  alphaSource * (1 - alphaBackdrop) * colorSource
  + alphaSource * alphaBackdrop * Blend(colorBackdrop, colorSource)
  + (1 - alphaSource) * alphaBackdrop * colorBackdrop
```

Stored intermediates remain premultiplied. Alpha-zero pixels have no meaningful
color and are normalized at readback boundaries. HDR and extended-range values
are retained only in float-capable paths; 8-bit compatibility renderers clamp at
the documented output boundary. No backend-specific “more perceptual” LCh
variant is substituted for the W3C component modes.

WCAG contrast and luminance masks convert encoded sRGB to linear light before
luminance calculation. Blur/filter operations document whether they intentionally
use linear light or compatibility behavior; there is no hidden radius-dependent
switch in color behavior.

## 7. Automatic Contrast Text

Automatic Contrast is a text appearance policy, not a BlendMode.

The initial feature chooses one fill for the complete text object. It samples the
already composed backdrop through the transformed glyph alpha coverage within a
bounded object surface. Transparent samples are composited against the page or
export background policy. Sampling excludes the text’s own fills, strokes, and
effects.

Settings are:

- enabled;
- light and dark managed colors;
- target contrast ratio, default 4.5;
- bias in the range -1 to 1;
- sampling quality (`interactive` or `export`);
- optional minimum-contrast enforcement.

The selector computes linear-light relative luminance and evaluates both
candidates over covered samples. It selects the candidate with the stronger
low-percentile contrast, adjusted by bias, which is more stable than a raw mean
over mixed imagery. A small hysteresis prevents flicker while dragging. Export
uses full deterministic sampling with no temporal hysteresis.

When minimum-contrast enforcement is enabled and neither candidate satisfies the
target over the configured coverage percentile, Strata applies a deterministic,
bounded contrast halo behind the glyphs. The halo is part of the adaptive
appearance result, is included in raster export, and is flattened or outlined in
formats that cannot preserve the policy. It is never represented as Difference.

Backdrop dependencies invalidate when the text, glyph layout, transform,
ancestor transform, paint order, backdrop content, blend space, or page
background changes.

## 8. UI and Accessibility

The Appearance section uses one shared blend catalog. Options are grouped as:
Pass Through (groups only), Normal, Darken, Lighten, Contrast, Comparative, and
Component. Unsupported modes for the selected domain are absent, not disabled
without explanation.

The control provides:

- search and typeahead;
- arrow-key navigation and selection;
- visible category grouping;
- live hover/focus preview with cancel-on-Escape;
- reset to Normal, or Pass Through for groups;
- exact current and mixed states;
- compatibility warning for unknown legacy values;
- compact descriptions derived from the catalog;
- persistent group isolation control;
- Automatic Contrast controls only for text-capable selections.

Preview changes are transient and create no history entry until committed.
Committed changes are one undo step. UI uses existing tokens, works in light,
dark, and high-contrast themes, and respects reduced motion. No hardcoded colors,
spacing, or typography are introduced.

## 9. Persistence, History, and Clipboard

The document version is advanced with a migration that:

- assigns group Pass Through defaults while preserving prior appearance;
- normalizes known aliases;
- records unrecognized values as compatibility issues;
- supplies defaults for Automatic Contrast fields;
- leaves ordinary object defaults at Normal.

The codec validates blend applicability at the boundary. Undo/redo stores the
same immutable document values as other appearance edits. Clipboard payloads
include the transitive closure of referenced Paint records and adaptive
appearance data, remapping ids on paste. Cross-document paste converts managed
colors into the destination document profile or records a conversion warning.

## 10. Export Strategy

### Raster

PNG, WebP, JPEG, thumbnails, and print-flattening use the same structured
reference renderer and deterministic resource readiness. JPEG requires an
explicit background color because it cannot preserve transparency.

### SVG

Standard modes map to `mix-blend-mode`; isolated groups map to `isolation`; node
opacity is emitted explicitly. Stacked fills/strokes are represented as grouped
paint elements when semantics are preservable. Automatic Contrast and Plus
Lighter are flattened to bounded raster content unless the user chooses a static
resolved fill. Export analysis reports every flattening.

### PDF

Supported standard modes use ExtGState `/BM`, `/ca`, and `/CA`. Isolated container
content uses PDF transparency group XObjects. Soft masks are used for alpha and
luminance masks. The page/document transparency blend space is explicit. If the
selected PDF standard or print path cannot preserve a construct, preflight offers
bounded flattening or blocks export; it never changes appearance silently.

### Code targets

Targets emit blend/opacity only where the target has equivalent semantics.
Otherwise target analysis reports the unsupported appearance and offers raster
asset substitution. Generated code does not claim support it did not emit.

## 11. Performance

Ordinary Normal and native Canvas2D blend operations do not allocate offscreen
surfaces. Isolation surfaces use transformed subtree bounds plus effect/mask
padding and are pooled by pixel format and size class. Maximum dimensions and
pixel budgets fail into tiled/bounded rendering, never full-scene unbounded
allocation.

Backdrop readers share versioned bounded snapshots. Dirty-region invalidation
propagates only to later objects in the same compositing scope that depend on the
changed backdrop. Performance fixtures cover many overlapping blended layers,
nested isolated groups, photographic content, high DPI, extreme zoom, and rapid
reorder/mode changes.

## 12. Test and Visual-Conformance Plan

TDD milestones add:

- exact formula vectors for every supported mode;
- source/backdrop alpha grids at 0, 0.25, 0.5, and 1;
- transparent-edge and premultiplication halo fixtures;
- browser Canvas differential tests with narrow byte tolerances;
- group Pass Through, Normal, creative mode, opacity, nested isolation, masks,
  clipping, effects, and frames;
- native/WASM camelCase round trips for every mode and appearance domain;
- persistence, migration, undo/redo, copy/paste, and legacy-value tests;
- Automatic Contrast luminance, bias, hysteresis, contrast, movement, and export
  tests;
- PNG/SVG/PDF inspection and rasterized pixel comparisons;
- capability-router tests proving unsupported GPU work remains ordered;
- Playwright workflows and reference screenshots for vectors, text, images,
  gradients, texture, transparency, masks, and nested groups;
- desktop WebDriver/manual Wayland verification and documented Windows/macOS
  build verification;
- performance budgets for isolation allocation, backdrop cache invalidation, and
  many-layer documents.

Visible-pixel comparisons use per-channel tolerances justified by backend format
and color conversion. Broad screenshot-percentage thresholds are not accepted.

## 13. Delivery Milestones

1. Audit record and conformance fixture contract.
2. Canonical blend math and alpha composition.
3. Schema defaults, migrations, validation, history, and clipboard closure.
4. Canvas2D leaf and effect correctness.
5. Group/frame isolation, masks, clipping, and bounded render scopes.
6. Strict renderer capability routing and native/WASM wire parity.
7. Automatic Contrast text.
8. Inspector UX and accessibility.
9. Raster, SVG, PDF, and code-target compatibility.
10. Performance hardening, cross-renderer visual regression, platform builds,
    architecture health checks, and documentation.

Each milestone begins with a failing test, ends with focused and regression
verification, and is committed and pushed independently. Architecture/system
changes run the complete project regression protocol and health triage required
by `AGENTS.md`.

## 14. Genuine Initial Limitations

- Advanced blending initially targets explicit sRGB compatibility; wide-gamut
  document blend spaces require a later profile-aware float pipeline.
- Real WebGPU blend output cannot be declared verified until exercised on a
  hardware-enabled runner or documented physical system.
- Plus Darker remains a legacy compatibility value, not a normally exposed mode.
- Editable Automatic Contrast cannot be represented in SVG/PDF standards and is
  therefore resolved or flattened explicitly at export.
- Platform verification may require available Windows/macOS runners; missing
  infrastructure is reported rather than inferred from Linux success.
