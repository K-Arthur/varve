# Object Selection system

Object Selection is Varve's promptable, non-destructive image-selection
workflow. The product surface deliberately avoids exposing the model name:
users select an object, refine the result, and apply an editable mask.

## Runtime boundary

```text
Object Selection tool / Inspector
        │ world → source-image coordinate adapter
        ▼
SegmentationBackend contract (@varve/engine)
        │ load / prepareImage / predict / unload
        ▼
Worker-backed runtime (current adapter: split ONNX encoder + decoder)
        │
        ├── bounded embedding cache (2 entries / 512 MiB)
        └── candidate masks + confidence
        ▼
Transient ObjectSelectionSession
        │ point/box markers, candidate list, preview mask
        ▼ Apply (one document update)
Document Mask.rasterMask → RasterMaskAsset
```

The editor does not import an ONNX session or a tensor type. Backend-specific
preprocessing and execution-provider selection stay in `@varve/engine`.

## Live session lifecycle

`EditorState.objectSelectionSession` is the single transient owner for prompt
geometry, candidate masks, and inference status. A tool press publishes a
`draftPoint` or `draftBox` immediately; pointer-up promotes it to `points` or
`box` and starts preview inference. The session then moves through
`preparing` → `encoding` → `decoding` → `ready`, or to a retryable `error`.
The overlay renders draft prompts even when no model frame exists, so a slow or
unavailable model cannot make a valid user gesture appear to have been lost.

Escape, Clear prompts, tool deactivation, selection changes, and document
changes invalidate the generation and clear the transient preview. Apply and
Enter commit the currently visible candidate directly; they do not rerun the
decoder. A failed commit leaves the prompts and candidate available for retry.

## Interaction contract

- A click creates one positive point.
- Shift-click creates one negative point.
- A drag creates a box prompt and does not inject a point at the drag origin.
- Prompt edits remain transient until Apply as mask.
- Escape cancels the session; stale async generations cannot replace a newer
  result.
- The preview displays candidate confidence but does not describe it as a
  semantic understanding score.
- Candidate cycling changes only the transient candidate pointer; it does not
  modify the document until Apply.

The current backend is promptable segmentation. It can answer “which pixels
belong to the region indicated by these prompts”; that is not the same as
semantic subject detection. The legacy `sam2Segment` command id is retained
for compatibility, while the visible workflow is named Object Selection.
Automatic subject trimming remains a separate bounds proposal/ranking path.

## Automatic trim boundary

`Trim to Subject` is a separate bounds-only workflow. Its optional DETR path
produces object rectangles in source-image pixels; it does not produce a mask
and is never presented as equivalent to Object Selection. Detections are ranked
using confidence plus visible area, centrality, and a small class prior, and
multiple detections remain explicit choices in the Inspector. The selected
rectangle is reviewed before it is mapped through the canonical image
placement (fit, crop, offset, scale, rotation, and flips) and committed as a
non-destructive crop. A failed or ambiguous detection never changes the
document.

## Coordinates

Pointer coordinates follow the canonical path:

```text
screen → camera/world → node-local → image placement/crop/rotation/flip
       → source-image pixels → model-normalized coordinates
```

The same image placement mapping is used by brush mask editing. Prompt
coordinates are never derived from an axis-aligned world bounding box, because
that fails for rotated, cropped, flipped, or nested image nodes.

## Mask persistence

The preview mask is a `Uint8Array` in transient editor state. It is not
serialized, cached in the document, or added to undo history. Apply converts
it to the existing immutable PNG `RasterMaskAsset` and attaches
`Node.mask.rasterMask` through `commitRasterMask`. Documents render after the
model is removed because the committed mask is ordinary document data.

Mask combination is shared through the pure `combineAlphaMasks` service:
`replace`, `add`, `subtract`, and `intersect`. Downstream effects and
adjustment masks must consume the document mask rather than inventing a
selection-specific representation.

## Model lifecycle and privacy

Models load lazily when the feature is used. Downloads require explicit user
action, use HTTPS and checksums, and stay in the shared model manager. The
native startup path migrates valid legacy files from pre-rename app-data model
directories into `dev.varve.desktop/models` without deleting or replacing the
old files. Embeddings are memory-bounded session data and
are never written into Varve documents. Images are not uploaded by this
workflow.

## Runtime decision status

The current implementation retains the existing ONNX worker path because it
already has model lifecycle, execution-provider fallback, cancellation, and
split encoder/decoder support. This is an implementation choice behind the
contract, not a completed runtime benchmark decision. Candle + safetensors is
not accepted merely because it is Rust-native; a replacement requires an
official-predictor parity corpus, quality tolerances, cold/warm latency,
memory, and cross-platform evidence. See ADR-0220, the dated audit, and
`docs/quality/object-selection-parity.md` (corpus, metrics, tolerances, and
the release-gate procedure) for the required benchmark matrix.

## Known limitations

- Candidate masks can be cycled in the Inspector before Apply; the selected
  candidate is the mask committed to the document.
- The current SAM2 graph is promptable, not a semantic subject detector.
- Hair, fur, glass, smoke, and other fractional-transparency cases need the
  existing matting/refinement tools and visual review.
- A fresh model download and real-model parity run remain release validation
  gates; no claim of “instant” or “pixel-perfect” selection is made.
