# Image geometry and crop architecture

Status: normative architecture contract for the crop and image-transform system.

## Why this contract exists

An image layer contains four different kinds of geometry. Treating any two of
them as interchangeable causes the failures this document is intended to
prevent: crop confirmation stretches pixels, edge resizing changes the wrong
thing, masks drift away from their source, or export disagrees with the canvas.

1. **Object bounds** are the editable vector bounds of the image-bearing shape
   or frame. They are stored in object-local document units.
2. **Source-image transform** maps orientation-normalized source pixels into
   object-local space. Fit policy supplies the base mapping; offset, scale,
   rotation, and flips are per-usage edits layered on that mapping.
3. **Crop window** is an axis-aligned, non-destructive source-pixel rectangle.
   Pixels outside it remain in the immutable source asset. Applying a crop must
   not change the mapping of the pixels that remain.
4. **Object transform** maps the resulting object from local space to its
   parent. Ancestor transforms then map parent to artboard/world space.

Viewport zoom, pan, camera rotation, display scale, and device pixel ratio are
view concerns. They must never be written into any of the four document-space
concepts above.

## Canonical evaluation order

For one image-fill usage, rendering and hit/source mapping use this order:

1. Resolve immutable source bytes and orientation-normalized natural size.
2. Validate finite dimensions and per-usage transform values.
3. Derive the fit-policy base transform from the full source and object bounds.
4. Apply user scale, offset, content rotation, and flips about the content
   centre.
5. Sample the source crop rectangle without remapping that rectangle across the
   object bounds.
6. Apply the identical source sample and source-to-object transform to the
   source alpha/raster mask.
7. Clip to the image-bearing shape, then to enclosing frames and masks.
8. Apply the object and ancestor transforms.
9. Apply the document-to-view transform only for interactive display.

The engine image-placement module is the geometry owner. Canvas replay, crop
interaction, raster masks, source-coordinate tools, SVG, and PDF must consume
its forward/inverse mapping instead of recreating proportional math.

## Document fields

The persisted `ImageFillData` usage record has these responsibilities:

| Field | Coordinate space | Meaning |
| --- | --- | --- |
| `assetId` / `src` | Asset identity | Immutable source pixels |
| `imageWidth`, `imageHeight` | Source pixels | Orientation-normalized natural size |
| `fit` | Policy | Fit, Fill, Crop, Stretch, or Tile base placement |
| `x`, `y` | Object-local units | Content offset after policy placement |
| `scale` | Unitless | User scale multiplying the policy scale |
| `crop` | Source pixels | Non-destructive axis-aligned source sample |
| `rotation` | Degrees | Clockwise content rotation |
| `flipH`, `flipV` | Boolean | Content reflection without negative dimensions |

The shape supplies object bounds and the node affine supplies object transform.
Raster alpha masks use source-image-pixel coordinates and retain an explicit
source identity. Background-removal provenance stays on the node; its mask is
rendered with the same placement, crop, rotation, and flips as the source.

## Fit-policy semantics

- **Fit** derives a uniform contain scale. The whole source is visible and
  letterboxing is allowed.
- **Fill** derives a uniform cover scale. The object bounds are covered and
  source pixels may fall outside the object clip.
- **Crop** uses the persisted manual content scale and offset. It does not mean
  destructive rasterization.
- **Stretch** derives independent X/Y scales from the object bounds. Distortion
  is intentional and must be named as such in UI.
- **Original size** is Crop policy with scale 1 and zero offset in source-pixel
  units.
- **Tile** repeats the transformed source sample from a stable object-local
  anchor.

The user scale multiplies the policy scale. It must not algebraically cancel in
Fit or Fill. Changing policy may derive a new base transform, but must not
silently discard the persisted user crop, rotation, or flips.

## Editing and history

Crop mode owns a draft captured from a specific document identity, node
identity, and source revision. Pointer movement may update that draft many
times, but confirmation creates one history operation. Cancel, pointer
interruption, document switching, or deletion restores/discards the exact
captured draft and cannot target a later node that happens to reuse an id.

The interaction overlay is chrome only: boundary, hidden-region dim, handles,
and controls. Image pixels come from the authoritative canvas renderer. A
second `<img>` or canvas preview path is not an acceptable source of truth.

Standard selection transforms object bounds. Crop handles edit the crop window.
Dragging inside the crop window moves image content. A frame resize changes the
frame, not its image pixels. Destructive crop is a separately named,
undoable asset-producing operation and must never mutate a shared source asset.

Crop-mode input follows the editor command system:

- `C` enters crop for one selected image-bearing shape.
- `Enter` confirms the draft as one history operation; `Escape` discards it.
- Arrow keys move the crop window by one object-local unit; `Shift` uses ten.
- `Alt`/`Option` plus arrows pans image content; `Shift` again uses ten.
- During handle drag, `Shift` preserves the captured aspect ratio and
  `Alt`/`Option` resizes from the centre.
- `F` cycles the implemented placement policies while crop mode is active.

The controls remain keyboard-operable and expose button names through the
accessibility tree. Crop mode rejects multi-selection and non-image shapes.

## Persistence and migration

Every load boundary normalizes image-fill usage data, including both node-local
fills and paint-library fills:

- offsets are finite, otherwise zero;
- scale and source dimensions are finite and positive, otherwise stable
  defaults are used;
- crop rectangles are finite, positive, clamped to the source, and omitted
  when they cover the full source;
- rotation is finite and normalized to `[0, 360)`;
- flips are booleans;
- invalid geometry must retain a renderable source rather than producing a
  blank image.

Optional fields retain backwards-compatible defaults. Format migrations record
representation changes; normalization also runs for documents already stamped
with the current version, because current-version input can still be corrupt.
Save/reopen, autosave recovery, version history, duplication, and clipboard
transfer must preserve the complete per-usage transform and every referenced
immutable image/mask asset.

Clipboard payloads therefore carry the complete node closure plus both
`Document.assets` and `rasterMaskAssets`; paste merges both tables before
inserting the cloned subtree.

## Export contract

Raster export reuses document-space engine replay at the requested output
resolution. SVG and PDF encode the same source sample, source-to-object mapping,
shape clip, object/ancestor transform, opacity, and alpha mask. Unsupported
effects may raster-flatten only the smallest required subtree. Viewport zoom or
display DPR never influences export geometry.

## Current evidence-based limitations

Until import normalizes EXIF orientation into canonical source pixels, crop
coordinates remain vulnerable to decoder differences between Chromium,
WebView2, WebKit, and browser engines. Arbitrary rotated axis-aligned source
crops also require a polygonal or local clip representation for exact
round-tripping. These cases must fail safely and remain documented until their
representation and migrations ship; they must not silently stretch or blank an
image.

The PDF path supports rectangular image objects and embedded RGBA soft masks.
Non-rectangular PDF image clipping still uses the legacy shape path, and an
explicit external raster-mask asset is not yet emitted as a PDF soft mask.
Destructive crop is not currently exposed, so no UI action removes source
pixels or rewrites a shared asset.
