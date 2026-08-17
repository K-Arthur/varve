# Figma Import System

Date: 2026-08-17

## Overview

Varve imports Figma documents from official REST API JSON responses or
plugin-export JSON. Opaque native `.fig` binaries are not supported —
Figma's local binary format is undocumented and changes frequently. The
recommended acquisition path is the Figma REST API (`GET /v1/files/:key`)
or a Figma plugin that exports the same JSON structure.

## Acquisition paths

| Source | Supported | Fidelity | Notes |
|--------|----------|----------|-------|
| REST API JSON | Yes | High | Requires Figma access token; export via `GET /v1/files/:key` |
| Plugin export JSON | Yes | High | Plugin must emit the same `{ document, components, styles, variables, images }` envelope |
| Opaque `.fig` binary | No | N/A | Documented in `unsupportedFeatures` report; not reverse-engineered |
| SVG/PDF fallback | Yes | Low | Handled by existing SVG/PDF parsers; not Figma-specific |

## Architecture

```
Figma source JSON
       |
       v
decodeFigmaSource()           -- bounded normalization
       |
       v
FigmaSourceDocument           -- normalized source IR
       |
       v
convertFigmaSource()          -- semantic conversion planner
       |
       v
Document (native Varve)       -- transactional fragment
       |
       v
ImportService / Editor        -- validation, merge, undo
```

### Source normalization (`figma/source.ts`)

- Accepts official REST JSON or a compatible plugin-export envelope.
- Limits: 64 MB, 100k nodes, 256 depth, 2M text length.
- Preserves Figma source IDs as provenance only — never as Varve node IDs.
- Reports unsupported features (boolean operations, missing image bytes,
  unknown effects, slices) without aborting conversion.
- Extracts pages, components, component sets, styles, variables, and
  embedded image data URLs.

### Conversion (`figma/converter.ts`)

Node-type mapping:

| Figma type | Varve node | Strategy |
|------------|-----------|----------|
| CANVAS | Page | Native page |
| FRAME | FrameNode | Native frame with children, clipping, layout |
| GROUP | GroupNode | Native group |
| SECTION | GroupNode | Preserved as non-renderable organizational group |
| COMPONENT | FrameNode + ComponentDefinition | Native master |
| INSTANCE | FrameNode with componentId | Linked instance with property overrides |
| COMPONENT_SET | GroupNode | Container for variants |
| TEXT | TextNode | Editable text with font family/style/weight |
| RECTANGLE | ShapeNode | Parametric rect, preserving corner radii |
| ELLIPSE | ShapeNode | Parametric ellipse |
| LINE | ShapeNode | Line geometry |
| POLYGON | ShapeNode | Parametric polygon |
| STAR | ShapeNode | Parametric star |
| VECTOR | ShapeNode (path) | Bezier path from fillGeometry; bounds fallback when data missing |
| BOOLEAN_OPERATION | GroupNode | Children preserved; native boolean not available |
| SLICE | Skipped | Export metadata only; logged as unsupported |

Auto Layout:

- HORIZONTAL / VERTICAL → `LayoutStyle.mode = 'flex'`
- itemSpacing → gap
- padding → padding tuple
- primaryAxisAlignItems → justifyContent
- counterAxisAlignItems → alignItems
- layoutSizingHorizontal / layoutSizingVertical → layoutSizing per axis
- layoutPositioning → layoutPosition
- layoutGrow → fill sizing
- wrap → wrap

Components and variants:

- COMPONENT nodes create `ComponentDefinition` with empty slots (Figma
  slots don't map 1:1 to Varve slot semantics).
- componentPropertyDefinitions are preserved as typed properties.
- Instance propertyOverrides are captured from componentProperties.
- Component sets become group containers.

Variables and styles:

- Figma variables (color/number/string/boolean) are mapped into
  `VariableStore` collections and modes.
- Variable aliases are preserved as expression-like strings.
- Styles (FILL/TEXT/EFFECT/GRID) are mapped to Varve `Document.styles`.
- Style references are resolved by ID to scene `styleId`.

Prototype interactions:

- ON_CLICK / ON_HOVER / ON_DRAG triggers are mapped to native triggers.
- NAVIGATION / OVERLAY / SCROLL_TO / URL / BACK actions are mapped to
  native actions.
- Destination node IDs are remapped through the source-to-Varve ID table.
- Unresolved destinations produce warnings, not crashes.

Fonts and images:

- Font family and style are preserved on text nodes; availability is
  resolved by Varve's font subsystem after import.
- Image paints with embedded data URLs are stored as content-addressed
  `DocumentAsset` entries and deduplicated.
- Image paints referencing remote Figma `imageRef` without embedded bytes
  produce explicit warnings.

Provenance and identity:

- Figma source IDs are never used as Varve node IDs.
- Fresh IDs are minted via `mintId`.
- Source metadata is not persisted on scene nodes — it lives in the
  import report only.

## Limits and safety

- Maximum 64 MB input JSON.
- Maximum 100,000 normalized nodes.
- Maximum 256 levels of nesting.
- Maximum 2,000,000 characters of text content.
- Path commands beyond M/L/C/Z are detected and produce warnings.
- Boolean operations are preserved as editable children, not native booleans.
- Unknown effect types are logged as unsupported, not silently dropped.

## Fidelity matrix

| Feature | Status | Fallback |
|---------|--------|----------|
| Pages | Native | — |
| Frames | Native | — |
| Auto Layout | Native (flex) | — |
| Components | Native (definition + instance) | Materialized children |
| Variants | Partial (component properties preserved) | — |
| Variables | Native (color/number/string/boolean) | Resolved values |
| Styles | Native (color/text/effect/layout) | Inline properties |
| Text | Native (font family/style/weight/size) | Font substitute |
| Rich text (style overrides) | Approximated (character style overrides) | — |
| Gradients | Native (linear/radial/angular/diamond) | — |
| Effects | Partial (drop/inner shadow, layer/background blur) | — |
| Masks | Native (alpha clip) | — |
| Images | Native (embedded data URL) | Warning for remote refs |
| Prototyping | Approximated (navigate/overlay/URL/back) | Warning for lost destinations |
| Boolean operations | Flattened to children | Warning |
| Vector paths | Native (Bezier from fillGeometry) | Bounds placeholder |
| Sections | Group (non-renderable) | — |
| Constraints | Native (min/max/center/stretch/scale) | — |
| Corner radii | Native (uniform and per-corner) | — |
| Stroke | Native (weight/align/cap/join/dash) | — |
| Blend modes | Native (all standard modes) | — |
| Export slices | Metadata only | Warning |
| Scroll | Not imported | — |
| Layout grids | Not imported | — |

## Testing

Tests are colocated at `packages/import/src/figma.test.ts` and cover:

- Official REST JSON detection vs opaque `.fig` binary rejection
- Page, frame, text, vector, gradient, effect, stroke, corner radius
- Auto Layout direction, gap, padding, alignment, sizing
- Source ID isolation from Varve scene IDs
- Missing image bytes and unsupported boolean semantics
- Excessive nesting rejection
- ImportService integration path

Run with:

```bash
pnpm exec vitest run packages/import/src/figma.test.ts
```

## Known limitations

- No remote image fetching; plugin export must embed image data URLs.
- Rich text style overrides are approximated, not fully resolved.
- No scroll, layout grid, or layout constraint reflow after import.
- Boolean operations are not native Varve nodes; children are preserved.
- Variable alias expressions are stored as placeholder strings, not
  fully evaluated.
- Prototype transitions are simplified to instant/dissolve/smartAnimate.
