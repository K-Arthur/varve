# Object Selection system

Object Selection is Varve's promptable, non-destructive image-selection
workflow. The product surface deliberately avoids exposing the model name:
users select an object, refine the result, and apply an editable mask.

## Runtime boundary

```text
Object Selection tool / Inspector
        │ world → source-image coordinate adapter
        ▼
Model-independent SegmentationBackend contract (@varve/engine)
        │ load / prepareImage / predict / unload
        ▼
Worker-backed runtime (current adapter: split ONNX encoder + decoder)
        │
        ├── bounded embedding cache (2 entries / 512 MiB)
        └── candidate masks + confidence
        ▼
Transient ObjectSelectionSession
        │ point/box markers, candidate list, preview mask
        ├── Apply as mask (one document update)
        │   Document Mask.rasterMask → RasterMaskAsset
        └── Use as selection
            transient analytical AreaSelection```

The current editor path calls the generic worker bridge and uses the verified
split ONNX encoder/decoder adapter in `@varve/engine`; it does not instantiate
`SegmentationBackend` directly yet. The contract remains the provider-neutral
seam for a future adapter, while backend-specific preprocessing and
execution-provider selection stay in `@varve/engine`. This distinction is
intentional: the current implementation is integrated and tested, but the
provider-neutral interface is not being claimed as a completed runtime
abstraction.

## Live session lifecycle

`EditorState.objectSelectionSession` is the single transient owner for prompt
geometry, candidate masks, and inference status. A tool press publishes a
`draftPoint` or `draftBox` immediately; pointer-up promotes it to `points` or
`box` and starts preview inference. The session then moves through
`preparing` → `encoding` → `decoding` → `ready`, or to a retryable `error`.
The overlay renders draft prompts even when no model frame exists, so a slow or
unavailable model cannot make a valid user gesture appear to have been lost.

Escape, Clear prompts, tool deactivation, selection changes, and document
changes invalidate the generation and clear the transient preview. Apply,
Enter, and Use as selection commit the currently visible candidate directly;
they do not rerun the decoder, and the candidate index is pinned when the
action is invoked so cycling during a pending commit cannot swap the mask.
A failed or stale commit leaves the prompts and candidate available for retry.

## Reviewed-candidate commit path

"Apply as mask" and "Use as selection" share one commit path. Both revalidate
the source fingerprint against the preview before converting, reject an
all-zero candidate with a retryable `empty_result` error, and use the exact
candidate the user inspected. The only difference is the destination: a
document `RasterMaskAsset` or a transient analytical `AreaSelection`. An
empty smart-selection result is never committed silently; the session stays
open so prompts can be corrected.

## Interaction contract

- Point mode creates one positive point per click; Shift-click or the visible
  Exclude polarity control creates a negative point.
- Box hint mode accepts either a drag or two taps for opposite corners and does
  not inject a point at the drag origin. The box is a model hint, not an output
  clipping constraint.
- Tapping an existing include/exclude marker removes that specific prompt
  within a CSS-pixel tolerance; dragging a marker moves it; Backspace/Delete
  removes the last staged prompt. These are all single-pointer operations.
- Prompt polarity and accepted-selection combination are separate concepts:
  Include/Exclude labels model prompts, while Replace/Add/Subtract/Intersect
  applies only when a reviewed candidate becomes an area selection.
- Prompt edits remain transient until an output is chosen.
- Apply as mask creates an editable document mask; Use as selection creates
  an ephemeral pixel-area selection without changing artwork or document
  history. Both consume the reviewed candidate.
- Escape cancels the session; stale async generations cannot replace a newer
  result.
- The preview labels the score according to its provenance: verified decoder
  IoU output is a model score; the single-output fallback is explicitly a
  heuristic score. Neither is a semantic understanding score.
- Candidate cycling changes only the transient candidate pointer; it does not
  modify the document until Apply.

The current backend is promptable segmentation. It can answer “which pixels
belong to the region indicated by these prompts”; that is not the same as
semantic subject detection. The legacy `sam2Segment` command id is retained
for compatibility, while the visible workflow is named Object Selection.
Automatic subject trimming remains a separate bounds proposal/ranking path.

## Automatic subject proposals

`Select subject` in the Selection Sources panel is a separate, model-free
capability. It never claims semantic recognition and never downloads a model:

- The estimator (`@varve/engine/foregroundSelect`, exported as the
  `@varve/engine/foregroundSelect` subpath) proposes candidates from two
  evidence sources: a border flood through colour-continuous pixels
  (background consumed from the edges) and a centre flood through
  colour-similar pixels (a centred subject on a plain or gradient
  background). Near-duplicate proposals are merged, and a subject that touches
  the image border is still proposed by the centre path.
- Candidates are ranked by the documented policy
  `0.55·coverage + 0.25·centrality + 0.20·edgeAlignment` and returned with
  analysis-resolution masks. Analysis runs on a plane capped at 1024 px on the
  long edge, so the working set stays in the low megabytes even for very large
  images; masks are mapped back to source pixels deterministically.
- The top-ranked proposal is applied as an area selection immediately; every
  alternative stays one click away, and "All subjects" unions the proposals.
  Ranking never overrides a deliberate choice: clicking a candidate replaces
  the selection explicitly.
- Enclosed background-coloured regions stay inside a proposal (holes are not
  punched automatically); the existing refinement tools can remove them.
- `Select subject` cannot recognise what an object is. Text prompts, sky,
  hair, or other semantic sub-selections remain separate capabilities; Object
  Selection (prompted) is the path for a specific object.

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

The transient session also stores a fingerprint of the exact decoded RGBA
source pixels. Embedding cache entries are keyed by that fingerprint, and
Apply re-reads the source before committing. A changed image therefore clears
the old candidate instead of attaching a mask produced from different pixels.
Malformed decoder dimensions, lengths, non-finite logits, and invalid IoU
scores are rejected before resizing or persistence.

## Model lifecycle and privacy

Models load lazily when the feature is used. Downloads require explicit user
action, use HTTPS and checksums, and stay in the shared IndexedDB model store
in browser builds. The editor-facing loader and the core `DownloadManager`
accept the same stored-record formats; both can verify an upstream checksum
and apply the pinned SAM2 graph repair before the artifact becomes available.
The native startup path migrates valid legacy files from pre-rename app-data
model directories into `dev.varve.desktop/models` without deleting or replacing
the old files. Embeddings are memory-bounded session data and are never
written into Varve documents. Images are not uploaded by this workflow.

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
- The model-free subject estimate is a foreground heuristic ranked by
  coverage/centrality/edge support. It is weakest on landscape or texture
  scenes and is never labelled as semantic recognition.
- Hair, fur, glass, smoke, and other fractional-transparency cases need the
  existing matting/refinement tools and visual review.
- A fresh model download and frontend integration run is recorded in the
  quality methodology, while the corpus-wide real-model parity run remains a
  release validation gate; no claim of “instant” or “pixel-perfect” selection
  is made.
