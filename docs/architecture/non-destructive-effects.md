# Non-Destructive Effects Architecture

**Status:** current · **Decision:** [ADR-0224](../adr/0224-non-destructive-effect-attachments.md) · **Related:** [Live Effects](live-effects-system.md), [Masking](masking-system.md), [Effect Rendering](effect-rendering.md)

Varve has two deliberately different non-destructive effect attachments. They
share filter parameters and rendering machinery, but not ownership or scope:

| Product term | Persisted owner | Input pixels | Spatial boundary |
| --- | --- | --- | --- |
| **Object Filters** | Any renderable scene node, in `smartFilters` | That node's rendered result | The node's own masks and bounds |
| **Adjustment Layers** | An `AdjustmentNode` in the scene tree | A resolved backdrop target set | The serialised adjustment scope and optional adjustment mask |

`smartFilters` is a compatibility field name. It remains serialised so old
documents and integrations stay readable; user-facing copy calls the feature
**Object Filters**. An adjustment layer is not an object filter attached to a
group: it is a separate scene node because it selects a backdrop rather than
owning a source object.

## 1. One filter definition, two attachments

`Adjustment` is the canonical serialised parameter union. Its kind is drawn
from `ADJUSTMENT_KINDS`, then lowered through `adjustmentToFilter()` to portable
`FilterIR`. `applyFilterWithCompositing()` is the shared CPU reference path;
native and WebGPU providers are optional accelerators, never separate product
semantics.

```text
Adjustment + parameters
        │
        ├── Object Filter: NodeBase.smartFilters → node-local render result
        │
        └── Adjustment Layer: AdjustmentNode.scope → scoped backdrop result
                         │
                         ▼
                  Adjustment → FilterIR → compositor/provider fallback
```

The central kind catalogue is exported by `@varve/engine`. Scene validation
and both editors consume that catalogue rather than keeping parallel string
lists. This is a schema/API consolidation, not a migration: the JSON shape of
existing `Adjustment` and `smartFilters` entries is unchanged.

## 2. Scope, ordering, masks, and bounds

Object Filters run on the node result in stack order. They are local to the
object: filtering a group filters the composed group result, while filtering a
child does not affect siblings. `smartFiltersEnabled` bypasses the whole local
stack without deleting it; individual entries retain their enabled state,
opacity, and blend mode.

An Adjustment Layer resolves one of four serialised scopes:

| Scope | Resolved input |
| --- | --- |
| `image-local` | One eligible node |
| `explicit-targets` | Named eligible nodes, de-duplicated |
| `container-descendant` | Eligible descendants of a container, optionally including nested containers |
| `document` | All eligible nodes |

Resolution drops missing, hidden, duplicate, self-referential, and nested
duplicate targets. In particular, a target that contains the adjustment node
is rejected before rendering: otherwise it would include the adjustment's own
output recursively. The legacy unscoped form remains a deterministic
sibling-below fallback for old documents.

A node mask answers **where a node is visible**. An adjustment mask answers
**where the filtered scoped result is visible**; it does not add targets to
the scope. The adjustment renderer constructs a tightly cropped backdrop in
device pixels, pads it by `totalEffectExpansion()`, applies the filter stack,
then applies the adjustment mask using `destination-in` semantics. Mask
geometry begins in document space, so it is projected through the camera and
translated by the crop origin before replay. The same helper is used by live
canvas replay and structured export replay; this prevents masks from drifting
when a target is away from document origin.

Live preview limits expansion padding to 512 device pixels to bound temporary
surface allocation. Export uses the full requested expansion so spill from
bloom, displacement, and procedural light effects is not clipped by that
interactive safety cap.

## 3. Render and alpha contract

The reference compositor receives RGBA8 `ImageData` with straight-alpha
storage at the kernel boundary. Pointwise colour adjustments preserve alpha
and preserve hidden RGB below fully transparent pixels. Sampling effects use
premultiplied-alpha sampling internally to avoid dark or light edge fringes;
the explicit alpha-cutoff policy is the only supported route that deliberately
changes source alpha.

The renderer retains three separate concepts:

1. source pixels and node-local Object Filters;
2. the Adjustment Layer's filtered backdrop, limited by scope and its mask;
3. ordinary node opacity, blend mode, and structural effects.

They must not be collapsed into one property or one filter stack. In
particular, an Object Filter never widens to scene siblings, and an Adjustment
Layer never becomes a destructive edit of an image asset. Full-frame and
cropped-surface replay both use the same `FilterIR` compositor; export takes
the same structural replay path before choosing a supported vector form or
the smallest necessary raster boundary.

## 4. Content behavior matrix

| Content | Object Filter input | Adjustment Layer participation | Mask/export behavior |
| --- | --- | --- | --- |
| Rectangle / ellipse | Rendered fill, stroke, and node result | Eligible | Node and adjustment masks work; vector export rasterises only unsupported effects |
| Path | Rendered path result | Eligible | Same scope/mask rules as shapes |
| Text | Shaped text result | Eligible | Text remains editable; raster fallback is limited to the affected boundary |
| Raster-backed shape / PNG | Decoded, placed image result | Eligible | Original asset remains referenced; crop/transform remain scene data |
| Animated raster frame | Current decoded frame result | Eligible | Frame timing remains media state; effects are replay-time |
| Frame | Composed frame result | Eligible and may scope descendants | Frame clipping intersects with masks |
| Group | Composed group result | Eligible and may scope descendants | Group isolation, opacity, and blend remain structural |
| Nested group | Its own composed subtree | Eligible, but parent target suppresses duplicate child replay | Prevents filtering the same pixels twice |
| Adjustment node | Not eligible | Never a target | Prevents recursive backdrop replay |
| Hidden / deleted node | No input | Excluded | Saved scope remains safe after deletion or visibility change |

## 5. Smart Content decision

An image node already separates an asset reference from placement, crop,
transform, masks, Object Filters, and Adjustment Layers. Editing any of those
properties therefore leaves the source raster untouched and undoable; there
is no destructive resample step to repair with a `SmartObject` abstraction.

Varve does **not** introduce Photoshop-style Smart Objects at this time. That
name would imply capabilities the current document model does not offer:

| Capability | Current state | Decision |
| --- | --- | --- |
| Non-destructive raster placement and effects | Supported by image asset references plus scene nodes | Keep the existing model |
| Nested editable document rendered as one object | Not supported | Add a `ContentSource`/nested-document boundary only when this is a product requirement |
| Linked external file, relink, modification detection | Not supported as a Smart Content workflow | Design explicit link provenance and recovery before shipping it |
| Independent embedded-source edit session | Not supported | Requires ownership, versioning, export, and undo semantics beyond an effect attachment |

A future Smart Content feature must be a real content-source boundary with
asset provenance, nested-document lifecycle, relink policy, cache identity,
and export rules. It must not be introduced merely to rename existing image
layers or Object Filters.

## 6. Compatibility and extension rules

- Keep `smartFilters` and `smartFiltersEnabled` as the persistence/API names;
  expose **Object Filters** in product UI and docs.
- Add a filter kind once: canonical kind catalogue, `Adjustment` parameter
  type/defaults, `FilterIR` lowering, compositor implementation, effect
  contract/expansion metadata, editor, and focused tests.
- Keep Object Filter stacks node-local. Keep Adjustment Layer target selection
  in `AdjustmentScope`; do not infer scene-wide scope from a filter entry.
- Per-entry Object Filter masks are deferred. They need a separately
  serialised coordinate and compositing contract and must reuse the mask
  representation rather than creating an incompatible one-off format.
- A provider failure must fall back to the CPU reference compositor. It may
  not omit the effect or bake pixels into the document.

## 7. Verification focus

Changes in this system require focused coverage for at least the following:

- shared kind catalogue and unknown-kind validation;
- scope resolution, parent/child de-duplication, and recursive-target safety;
- transparent-edge alpha and hidden-RGB behavior in the reference compositor;
- live and export replay of a cropped adjustment mask away from origin;
- an actual-browser canvas test for Object Filters and masked adjustment
  layers, with screenshots retained as review artifacts when behavior changes.
