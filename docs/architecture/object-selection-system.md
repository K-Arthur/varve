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

## Interaction contract

- A click creates one positive point.
- Shift-click creates one negative point.
- A drag creates a box prompt and does not inject a point at the drag origin.
- Prompt edits remain transient until Apply as mask.
- Escape cancels the session; stale async generations cannot replace a newer
  result.
- The preview displays candidate confidence but does not describe it as a
  semantic understanding score.

The current backend is promptable segmentation. It can answer “which pixels
belong to the region indicated by these prompts”; that is not the same as
semantic subject detection. Select Subject and Select Background remain
separate product workflows until a measured proposal/ranking path is available.

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
memory, and cross-platform evidence. See ADR-0220 and the dated audit for the
required benchmark matrix.

## Known limitations

- Candidate cycling is represented in the session but not yet exposed as a
  dedicated Inspector control.
- The current SAM2 graph is promptable, not a semantic subject detector.
- Hair, fur, glass, smoke, and other fractional-transparency cases need the
  existing matting/refinement tools and visual review.
- A fresh model download and real-model parity run remain release validation
  gates; no claim of “instant” or “pixel-perfect” selection is made.
