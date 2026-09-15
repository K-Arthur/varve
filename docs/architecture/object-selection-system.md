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

`Select subject` in the Selection Sources panel is an automatic foreground
capability, separate from prompted Object Selection and never presented as
semantic recognition. Two implementation families produce its candidates:

- **Model-backed proposals** reuse the background-removal models Varve already
  ships, through the shared model catalog, provider chain, and memory
  preflight: `u2netp` (bundled, the default Fast level), `isnet-general-use`
  (Balanced when installed), and `birefnet-general-lite` (High quality when
  installed and admissible). The routing decision
  (`@varve/engine/subjectProposal`) records the model that ran, any step-down,
  and every rejected alternative; an explicit model request is never silently
  substituted, and an optional model is only downloaded after an explicit
  confirmation that shows its size. Model candidates keep the soft coverage
  the provider produced for mask output, and derive per-region binary
  alternatives from significant connected components.
- **The model-free estimator** (`@varve/engine/foregroundSelect`) remains the
  no-model fallback: a border flood through colour-continuous pixels plus a
  centre flood, ranked by `0.55·coverage + 0.25·centrality + 0.20·edgeAlignment`,
  analysed on a plane capped at 1024 px on the long edge. It is used only when
  no model can run (nothing installed and no download chosen, or the working
  set does not fit this device), and the panel says so.

The panel never applies the top-ranked proposal automatically. Estimation only
publishes reviewable candidates; clicking a candidate previews its highlighted
pixels, and an explicit "Use selected candidate" or "Apply as mask" action is
required before another selection-dependent procedure can consume it. The mask
action commits the active candidate (soft alpha when the provider produced one)
as an ordinary document mask. A model-backed estimate never mixes confidence
semantics: candidate labels report coverage, and the provider/platform is
stated in words rather than as a probability.

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

Prompt normalization is fail-closed. Every include/exclude point must map to a
visible source-image pixel, and all four corners of a box hint must map before
the source-space box is constructed. If a point or corner falls outside the
visible image, the request stops before model inference with a retryable
out-of-bounds message; it is never silently dropped or replaced with a box
made from the remaining corners. This keeps a partial gesture from becoming a
different object-selection request.

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

Automatic subject estimates request one specific model explicitly. A request
that cannot run its model reports that outcome (with the model's download size
when installing it is the answer) instead of substituting another model, and
the browser preflight assesses the requested model's working set rather than a
single conservative default.

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
- Automatic subject estimates are foreground proposals. The model-backed
  levels are substantially stronger than the model-free heuristic on
  photographic subjects, but they still fail on cluttered or low-contrast
  scenes, and no level identifies *which* object the user intends.
- The model-free estimator is weakest on landscape or texture scenes and is
  used only when no model runs; the panel always names the source.
- Hair, fur, glass, smoke, and other fractional-transparency cases need the
  existing matting/refinement tools and visual review.
- A fresh model download and frontend integration run is recorded in the
  quality methodology, while the corpus-wide real-model parity run remains a
  release validation gate; no claim of “instant” or “pixel-perfect” selection
  is made.
