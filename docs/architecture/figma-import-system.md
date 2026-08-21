# Figma Import System

Date: 2026-08-20

## Overview

Varve imports Figma documents from user-provided official REST API JSON,
plugin-export JSON, and local native `.fig` archives. JSON remains the richest
documented acquisition path; native archives are decoded locally through the
MIT-licensed `openfig-core` adapter and then enter the same normalized source IR
and native Varve converter. Varve does not embed an API client or persist Figma
credentials.

## Acquisition paths

| Source | Supported | Fidelity | Notes |
|--------|----------|----------|-------|
| REST API JSON | Yes | High | Requires Figma access token; export via `GET /v1/files/:key` |
| Plugin export JSON | Yes | High | Plugin must emit the same `{ document, components, styles, variables, images }` envelope |
| Native `.fig` archive | Yes | Converted/format-version dependent | Parsed locally with `openfig-core`; no Figma credentials or network required |
| SVG/PDF fallback | Yes | Low | Handled by existing SVG/PDF parsers; not Figma-specific |

## Architecture

```
Figma source JSON or native `.fig`
       |
       v
decodeFigmaSource() or native decoder -- bounded normalization
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

### Source acquisition and normalization (`figma/native.ts`, `figma/source.ts`)

- Accepts official REST JSON, a compatible plugin-export envelope, or a native
  `.fig` archive/raw `canvas.fig` payload.
- Native archives are preflighted before decompression: ZIP directory paths,
  entry count, declared uncompressed size, entry size, compression ratio, and
  ZIP64 input are bounded or rejected. Parsed node count and graph depth are
  bounded again after decoding.
- `openfig-core` exposes Figma's decoded flat node graph, child map, paints,
  effects, text fields, images, and vector geometry. This adapter maps those
  source concepts into the same IR; it does not make `FigNode` a live Varve
  document model.
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
| COMPONENT_SET | FrameNode + ComponentDefinition variants | Native container plus structured variants |
| TEXT | TextNode | Editable text with font family/style/weight |
| RECTANGLE | ShapeNode | Parametric rect, preserving corner radii |
| ELLIPSE | ShapeNode | Parametric ellipse |
| LINE | ShapeNode | Line geometry |
| POLYGON | ShapeNode | Parametric polygon |
| STAR | ShapeNode | Parametric star |
| VECTOR | ShapeNode (path) | Native Bezier geometry; multi-region vectors become an editable group of path children |
| BOOLEAN_OPERATION | GroupNode | Children preserved; native boolean not available |
| Unknown container | GroupNode | Children preserved and unsupported type reported |
| SLICE | Skipped | Export metadata only; logged as unsupported |

Auto Layout:

- HORIZONTAL / VERTICAL → `LayoutStyle.mode = 'flex'`
- GRID → `LayoutStyle.mode = 'grid'` with column metadata where available
- itemSpacing → gap
- padding → padding tuple
- primaryAxisAlignItems → justifyContent
- counterAxisAlignItems → alignItems
- layoutSizingHorizontal / layoutSizingVertical → layoutSizing per axis
- layoutPositioning → layoutPosition
- layoutGrow → fill sizing
- wrap → wrap
- layout grids → `Document.gridSettings.layoutGrids`
- export settings → node export presets for supported formats

Components and variants:

- COMPONENT nodes create `ComponentDefinition` with empty slots (Figma
  slots don't map 1:1 to Varve slot semantics).
- componentPropertyDefinitions are preserved as typed properties.
- Instance propertyOverrides are captured from componentProperties.
- Component sets become frame containers with structured component variants.

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

- Font family and style are preserved on text nodes and rich-text runs;
  availability is resolved by Varve's font subsystem after import.
- Missing families open the existing replacement workflow when needed. Ranked
  candidates are applied through one editor transaction across node-level
  text, rich-text runs, and text styles. The document font manifest records
  the original family, replacement family, and substitution status so a save
  and reopen do not erase the provenance.
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
- Malformed or unsupported path commands are bounded and reported; supported
  relative commands and curves use Varve's shared SVG path parser.
- Boolean operations are preserved as editable children, not native booleans.
- Unknown effect types are logged as unsupported, not silently dropped.

## Fidelity matrix

| Feature | Status | Fallback |
|---------|--------|----------|
| Pages | Native | — |
| Frames | Native | — |
| Auto Layout | Native (flex/grid) | Fixed geometry only for unsupported source behavior |
| Components | Native (definition + instance) | Materialized children |
| Variants | Converted (component properties and variant values) | Ordinary frame if master is unavailable |
| Variables | Native (color/number/string/boolean) | Resolved values |
| Styles | Native (color/text/effect/layout) | Inline properties |
| Text | Native (font family/style/weight/size) | Font substitute |
| Rich text (style overrides) | Converted (character style overrides become runs) | Base text style |
| Font availability/replacement | Converted (catalog, ranked suggestions, manifest provenance) | Installed/system fallback; match quality is reported |
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
| Scroll/sticky | Unsupported | Static layout plus report |
| Layout grids | Converted to non-rendering grid metadata | — |
| Export settings | Converted to node export presets | Unsupported formats reported |

## Testing

Tests are colocated at `packages/import/src/figma.test.ts` and cover:

- Official REST JSON detection without misclassifying native `.fig` bytes
- Native `.fig` archive decoding and conversion using the checked-in
  MIT-licensed `OpenFigs.fig` fixture
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

- No remote image fetching; plugin export must embed image data URLs or the
  caller must resolve REST image refs before handing JSON to Varve.
- Rich text style overrides are approximated, not fully shaped across every
  script/font combination.
- Scroll/sticky semantics are not yet native; layout grids are imported as
  non-rendering document metadata.
- Boolean operations are not native Varve nodes; children are preserved.
- Variable alias expressions are stored as placeholder strings, not
  fully evaluated.
- Prototype transitions are simplified to instant/dissolve/smartAnimate.
- Native `.fig` support depends on the source schema versions understood by
  `openfig-core`; Varve reports a safe decode failure and leaves the destination
  document unchanged when an archive is malformed or unsupported.
- Native archives do not expose every REST resource map through the current
  adapter. When styles, variables, library metadata, or prototype data are not
  present in the decoded archive, Varve preserves the resolved node appearance
  and reports the missing semantic dependency rather than inventing one.
