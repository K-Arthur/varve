# Figma Import Audit — 2026-08-20

## Executive diagnosis

Varve already had a bounded Figma REST/plugin-JSON importer in
[`packages/import/src/figma/`](../../packages/import/src/figma/), rather than a
blank parser surface. The important pre-existing pieces were the normalized
source IR, native scene conversion, document validation, content-addressed
image assets, and service-level fidelity reports. The main correctness gaps
were at the integration boundaries:

- the unified `ImportService` did not register the Figma parser itself;
- validation reported opaque native `.fig` limitations for every JSON import;
- parser-level degradation was not propagated into the service report;
- boolean/unknown container children could be discarded;
- component/style/variable/prototype resources were lost when the editor
  cloned imported nodes into the active document;
- the existing report component understood only the legacy batch-import shape;
- file-picker imports had no progress, cancellation, or issue-review surface.

Those gaps are now addressed for the supported JSON acquisition path. Native
opaque `.fig` bytes remain explicitly unsupported. This is intentional: the
official Figma interfaces expose file data as JSON and do not document the
local binary layout. Varve does not reverse-engineer or bypass a protected
format.

## Source acquisition capability matrix

| Source | Can read? | Fidelity | Authentication | Offline | Recommendation |
| --- | ---: | --- | --- | ---: | --- |
| User-provided REST file JSON | Yes | High for fields present in JSON | Caller obtains Figma authorization | Yes after export | Recommended for API workflows |
| Plugin-generated JSON envelope | Yes | High when it includes embedded assets and metadata | Plugin permissions may apply | Yes | Recommended for local-first workflows |
| Local opaque `.fig` binary | No | None | N/A | N/A | Export JSON/plugin data instead |
| SVG fallback | Yes | Appearance-focused | No | Yes | Use for isolated visual content |
| PDF fallback | Yes | Appearance/print-focused | No | Yes | Use for print artwork |
| Figma API client inside Varve | No | N/A | Not implemented | No | Deliberately staged separately to avoid token storage/network coupling |

The official REST file endpoint returns a JSON document tree rooted at
`DOCUMENT`/`CANVAS`, with component/style maps and optional geometry path data;
the nodes endpoint can request deeper trees and `geometry=paths`. Image fills
use the separate image endpoint when their bytes are not embedded. See the
[official file endpoint documentation](https://developers.figma.com/docs/rest-api/file-endpoints/)
and [official file model](https://developers.figma.com/docs/rest-api/files/).
Variables require a separately authorized variables endpoint in supported
Figma plans; see the [official variables endpoint documentation](https://developers.figma.com/docs/rest-api/variables-endpoints/).

## Architecture implemented

```text
REST/plugin JSON or .fig candidate
        |
        v
  bounded decoder and source validation
        |
        v
  FigmaSourceDocument normalized IR
        |
        v
  reference setup + semantic converter
        |
        v
  staged native Varve Document fragment
        |
        v
  ImportService report and editor batch transaction
        |
        v
  cloned nodes + remapped components/styles/variables/interactions/assets
```

The decoder owns source-shaped data and limits. The converter owns mapping
policy and fallbacks. The editor resource adapter in
[`mergeImportedResources.ts`](../../packages/editor/src/import/mergeImportedResources.ts)
remaps resource IDs after node cloning; it does not keep a parallel Figma
scene alive.

Limits currently enforced by the source decoder are 64 MiB input, 100,000
nodes, 256 nesting levels, and 2,000,000 characters per text payload. Numeric
normalization rejects non-finite values. Unknown source types do not abort a
document: children are retained when the structure is container-like and the
conversion is reported.

## Current-state conversion matrix

Statuses mean: `Native` = same editable Varve concept; `Converted` = mapped
semantically into a Varve concept; `Approximated` = editable but not identical;
`Flattened` = editable geometry/children without the source operation;
`Unsupported` = deliberately not claimed as imported.

| Figma feature | Varve mapping | Status | Fallback | Fidelity notes |
| --- | --- | --- | --- | --- |
| Pages/CANVAS | `Document.pages` and page content roots | Native | — | Page IDs are newly minted |
| Frames | `FrameNode` | Native | — | Children, transforms, fills, clipping, layout, constraints |
| Sections | organizational `GroupNode` | Approximated | Preserve label/children | No fake visible artwork |
| Groups | `GroupNode` | Native | — | Hierarchy and transforms retained |
| Rectangle/ellipse/line/polygon/star | Parametric `ShapeNode` | Native | — | Corner radii, point counts and star scale retained |
| Vector paths | editable Varve path | Converted | Bounds placeholder when paths absent | Uses the shared SVG path parser for relative commands and curves |
| Boolean operations | editable group with children | Flattened | Baked/flattened geometry is not attempted | Operation is reported; native boolean node is not present |
| Unknown container types | editable group | Approximated | Preserve children, report type | Future types do not silently erase descendants |
| Fills | Varve fill stack | Converted | Omit unresolved paint | Solid, linear/radial/angular/diamond gradients, image references |
| Gradients | Varve gradient stops/handles | Converted | Rotation approximation | Stop colors/positions retained; color-profile metadata is not |
| Strokes | Varve stroke stack | Converted | Geometry fallback not currently needed | Width, cap, join, dash, miter and paint are mapped |
| Opacity/blend | node opacity/blend mode | Native/Converted | `normal` for unknown mode with issue | Paint opacity remains separate from node opacity |
| Shadows/blur | Varve effects | Converted | Unsupported effects reported | Drop/inner shadow and layer/background blur supported |
| Masks | Varve alpha mask | Converted | Unclipped content if source is invalid | Mask source is hidden rather than rendered as an ordinary layer |
| Frame clipping | `clipContent` | Converted | Source default when absent | Kept distinct from masks and prototype overflow |
| Embedded images | `Document.assets` + image fill | Native | Missing-image issue | Content-addressed asset IDs deduplicate repeated bytes |
| Missing/remote image refs | no fake bytes | Unsupported | Placement omitted, siblings continue | Report points to image-fills acquisition requirement |
| Text | editable `TextNode` | Converted | Font fallback | Family/style/weight/size/line-height/tracking and rich runs retained |
| Rich text ranges | Varve rich text paragraphs/runs | Approximated | Base text style | Character override tables become runs; full shaping parity is not claimed |
| Font availability | Varve font metadata/subsystem | Approximated | Installed/system fallback | Import records family references; interactive replacement UI is follow-up work |
| Auto Layout H/V | Varve flex `LayoutStyle` | Converted | Fixed geometry only for unsupported cases | Gap, padding, alignment, wrap and sizing intent are retained |
| Auto Layout GRID | Varve grid `LayoutStyle` | Converted | Flex-like approximation | Explicit column count is mapped when available |
| Min/max sizing | node min/max fields | Converted | Resolved bounds | Behavior remains editable in Varve layout |
| Absolute children | `layoutPosition: absolute` | Converted | Static position | Child is kept outside flow semantics |
| Constraints | Varve constraints | Converted | Bounds/position | Freeform constraints remain separate from Auto Layout |
| Layout grids | `Document.gridSettings.layoutGrids` | Converted | Non-rendering metadata | Never creates visible artwork |
| Components | `Document.components` + master root | Converted | Materialize if master unavailable | Resource IDs are remapped after clone |
| Instances | `FrameNode.componentId` | Converted | Ordinary frame if master unavailable | Overrides are preserved where target properties exist |
| Component sets/variants | component definition variants/properties | Converted | Named frame/group | Structured property values are retained when present |
| Styles | `Document.styles` and node `styleId` | Converted | Materialized inline fills/text/effects | IDs, not names, define identity |
| Variables/modes | `variableStore` and node bindings | Converted | Resolved values | Alias strings and bindings are remapped; full Figma mode parity is limited |
| Prototype navigation | `Document.interactions` | Converted | Issue for unresolved destination | Node targets are remapped after clone |
| Overlay/back/URL/scroll-to | native interaction actions | Approximated | Report degraded action | Overlay placement and scroll physics are not fully represented |
| Smart Animate | Varve smart-animate transition label | Approximated | Simplified transition | Matching/interpolation semantics are not identical |
| Scrolling/sticky/fixed | no complete target equivalent | Unsupported | Static frame/layout with issue | Not silently represented as geometry |
| Export settings | node export presets | Converted | Unsupported formats reported | PNG/JPG/WebP/SVG/PDF-screen and scale constraints supported |
| Slices | non-rendering metadata only | Unsupported | Omit visible node | Never creates fake visible rectangles |
| Color management | Varve managed colors | Approximated | Managed sRGB values | Source ICC/wide-gamut metadata is not currently acquired |

## Frontend behavior

File-picker import now uses the existing shell and import components:

- progress is shown while multi-file work runs;
- cancellation aborts pending service work and leaves the destination document
  unchanged by the import transaction;
- clean imports do not open a modal report;
- partial/failed/unsupported imports open the existing accessible report dialog;
- report rows include parser warnings, unsupported features, and failure text;
- Escape, close, focus-visible controls, and live announcements are retained.

The legacy batch report shape remains supported for existing callers. Missing
font replacement remains a staged frontend enhancement because Varve's current
font controller is not yet coupled to an import-scoped replacement session.

## Validation performed

Focused tests currently cover:

- official JSON detection and opaque `.fig` rejection;
- ImportService registration and parser-level partial reports;
- page/frame/layout/text/gradient/effect/path conversion;
- source-ID isolation;
- image-missing and boolean degradation;
- resource limits and excessive nesting;
- component-set variants, grid/export metadata, masks, unknown containers;
- import scaling;
- editor import report/progress components;
- post-clone resource/reference remapping;
- editor import insertion and clipboard paths.

The targeted Figma and editor import suites pass, including the browser
workflow in `tests/e2e/canvas/figma-import.spec.ts`. Workspace typecheck
remains blocked by unrelated existing errors in shared color/analytics code
and stale brush-worker tests; those failures are not introduced by the Figma
files. The importer benchmark (`packages/import/src/figma.bench.ts`) also
passes: the Node runner measured approximately 1.14 ms for 100 nodes, 9.52 ms
for 1,000 nodes, and 71.46 ms for 5,000 nodes in this environment. These are
conversion timings, not a claim about full editor import latency or peak
memory.

## Priority backlog

### P0 — safety/correctness

- Add a property-based fuzz harness for malformed JSON/reference cycles and
  make it part of the affected validation plan.
- Add cancellation checkpoints inside very large synchronous conversion phases.
- Add save/reopen and undo/redo assertions for resource-owned imports.

### P1 — semantic fidelity

- Couple import font resolution to a replacement mapping dialog and preserve
  original family/style metadata for later recovery.
- Implement exact component/library dependency materialization when a master is
  not present in the selected page set.
- Preserve Figma image crop/fill mode and richer effect ordering.
- Map prototype overlay geometry, scrolling, fixed/sticky content, and
  Smart Animate interpolation to target-native semantics.

### P2 — source coverage

- Add an authorized, opt-in API acquisition layer with secure platform token
  storage and image endpoint resolution.
- Add current Figma node-type fixtures for newer widget/slides/media/connector
  records and keep unknown-type behavior tolerant.
- Add wider color/profile metadata handling where the source path provides it.

### P3 — product polish

- Add preflight page/dependency selection for very large files.
- Add issue-row location/select actions in the report panel.
- Add source provenance/re-import matching as a separately scoped feature; do
  not treat ordinary repeated import as synchronization.
