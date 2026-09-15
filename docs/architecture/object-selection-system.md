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

The current editor path calls the generic worker bridge and uses verified
split ONNX encoder/decoder adapters in `@varve/engine`: SAM2 Tiny and MobileSAM
for routed and explicit prompted selection, plus an explicit experimental
EfficientSAM-Ti adapter that automatic routing never selects (measured
quality-equivalent to MobileSAM with a larger peak working set, and its decoder
has no mask-input tensor). Multi-component models are downloaded per component,
verified against pinned revisions and SHA-256 checksums, and executed through
the same worker, admission, cancellation, and embedding-cache lifecycle.
Backend-specific preprocessing and execution-provider selection stay in
`@varve/engine`. The provider-neutral `SegmentationBackend` contract remains
the seam behind these adapters; it is not instantiated directly by the editor.
Grounding DINO Tiny adds a discovery stage that produces reviewed boxes which
then enter the same prompted-segmentation session; detection never commits a
mask on its own.

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

A ready candidate is not implicitly trusted. The Inspector exposes the
highlighted overlay and requires an explicit review confirmation. That
confirmation is keyed to the decoded source fingerprint, current image mapping,
model, candidate-set identity, and candidate index; cycling candidates clears
it. Apply and Enter fail closed when the confirmation is absent, stale, or the
selected image/node changed while the source was being revalidated. The
Generative Edit dialog uses the same key before importing a candidate into its
editable mask, so direct Object Selection, keyboard Apply, and CAF all agree on
which reviewed pixels may flow into the next procedure.

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
publishes reviewable candidates; clicking a candidate opens its highlighted
pixels in the overlay but does not count as review. The user must explicitly
confirm the visible target with the review checkbox, then choose "Use selected
candidate" or "Apply as mask" before another selection-dependent procedure can
consume it. Switching candidates clears that confirmation, and a successful
commit clears the active preview. The mask action commits the active candidate
(soft alpha when the provider produced one) as an ordinary document mask. A
model-backed estimate never mixes confidence semantics: candidate labels report
coverage, and the provider/platform is stated in words rather than as a
probability.

The Selection Sources panel exposes both intents side by side. `Select subject`
is the foreground-estimate path; `Select specific object` activates the same
prompted Object Selection tool used by the Background Removal and Generative
Edit surfaces. The latter requires an include point or box, supports explicit
exclude prompts, keeps competing candidates visible, and still requires review
of the highlighted target before a mask or pixel selection can be consumed.

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

## Text-conditioned discovery

`Find by description` in the Object Selection section runs Grounding DINO Tiny
locally as an optional, explicit download (194 MB INT8, pinned
`onnx-community/grounding-dino-tiny-ONNX` revision). The engine implements the
verified five-feed contract (`pixel_values` plus int64 `input_ids`,
`token_type_ids`, `attention_mask`, `pixel_mask`), a BERT uncased WordPiece
tokenizer parity-checked against the reference token ids, the reference
thresholded phrase extraction with phrase-span attribution, and center/size to
source-pixel box conversion. Near-identical boxes for the same phrase are
deduplicated; overlapping boxes for different phrases are kept, because two
people standing together are two instances.

The detected boxes are reviewable proposals. Choosing one sends its box into
the existing prompted-segmentation candidate path, where the ordinary
review/candidate/Apply gate still applies; detection alone never commits a
mask, never auto-accepts the top score, and never unions every box. The UI
states that scores are model similarity rather than proof the object is
present: a measured control prompted `dog` on an elephant photograph returned a
0.71 box around the elephant, which is the documented early-fusion
false-positive behaviour of open-vocabulary detectors. Descriptions must be
concrete visual language; negation, counting, and relational instructions are
not parsed. Peak working set measured about 2.4 GB in the browser WASM
runtime (2.6 GB budgeted); Node process RSS was ~4 GB, which is not the wasm
heap. Low-memory sessions are refused with an explanation instead of risking a
crash.

## Portrait matting route

Background Removal's `Portrait matting (MODNet)` mode is a portrait-specific
route over the same mask system. The engine implements the official public
checkpoint contract (512-edge aspect-preserving reference size floored to
multiples of 32, `[-1,1]` normalization, single activation applied by the
exported graph, OpenCV `INTER_AREA` resize semantics) and the worker returns a
source-aligned fractional alpha. It is never a fallback for other modes, and a
reviewed coarse constraint fuses with the matte by forcing excluded background
to zero rather than multiplying two soft estimates, which would darken every
edge. Real-photo evidence: three repository portraits produced fractional
hair-edge coverage (7-8% of pixels fractional in the strongest cases), and an
out-of-domain animal photograph also produced a plausible matte, so the mode is
documented as a portrait intent rather than a guarantee about what the model
can see. Fine/low-contrast strands, backlighting, motion blur, and similar
foreground/background colours remain measured limits; portrait video matting is
out of scope.

## Coordinates

Pointer coordinates follow the canonical path:

```text
screen → camera/world → node-local → image placement/crop/rotation/flip
       → source-image pixels → model-normalized coordinates
```

The same image placement mapping is used by brush mask editing. Prompt
coordinates are never derived from an axis-aligned world bounding box, because
that fails for rotated, cropped, flipped, or nested image nodes.

The transient session retains point and box markers in document/world
coordinates because the overlay and prompt-edit gestures use that space. The
inference and commit validators map those markers through the current canonical
image mapper before comparing them with source-image mask pixels; they never
compare world values directly with normalized model coordinates.

Prompt normalization is fail-closed. Every include/exclude point must map to a
visible source-image pixel, and all four corners of a box hint must map before
the source-space box is constructed. If a point or corner falls outside the
visible image, the request stops before model inference with a retryable
out-of-bounds message; it is never silently dropped or replaced with a box
made from the remaining corners. This keeps a partial gesture from becoming a
different object-selection request.

A point-only request must contain at least one include point. Exclude points
are refinements to an identified object, not an object identity by themselves;
an exclude-only request stops before model inference with an actionable error.
When a candidate is applied, the editor recomputes prompt containment from the
candidate's actual source-sized mask and the session's retained prompts. It
does not trust a cached percentage, so a mutated, stale, or mismatched mask
cannot inherit a previous candidate's “prompt match” status.

Candidate target evidence is also calculated after decode and shown beside the
reviewed candidate. Coverage and bounds are measured against the full
source-sized mask; connected-region topology is measured on a bounded,
max-pooled review grid so a 33-megapixel image does not require a second full
resolution label buffer. A region is considered anchored only when it touches
an include point or the box hint. When the prompted target owns at least half
of the hard coverage, a bounded target-anchoring pass removes disconnected
source pixels that have no prompt support and reports that cleanup in the
review warning. Holes and separate parts supported by additional include
points or the box remain available. If unanchored coverage is too large to
identify the target safely, the candidate is rejected and the Inspector asks
for another include point, an exclude point, or paint/refine work rather than
guessing. This evidence is a review aid, not semantic object recognition or a
replacement for the mask overlay at fit and 1:1.

The validator also separates prompt containment from extent evidence. If hard
coverage reaches a source-image edge that no include point or box edge
supports, the candidate remains visible for inspection but is marked
`requiresRefinement`; Apply as mask, Use as selection, and the Generative Edit
handoff are blocked. The user must add an include point on the missing extent
or draw a box reaching that edge. This catches the observed failure where a
single point on an edge-hugging object selected only its upper portion while
still satisfying the point prompt. An edge-reaching box is still a hint, not a
hard crop: adjacent disconnected components are independently checked and
unsupported islands are pruned or rejected.

The same gate checks the local support around every positive point. A point that
lands on or immediately beside the proposed mask boundary can satisfy point
containment while identifying only a fragment of a larger object. On normal
photographic dimensions, a point-only candidate with no sufficiently supported
interior include point remains previewable but is marked `requiresRefinement`;
the user must add an include point deeper inside the object or draw a box. When
several model candidates are available, the default candidate prefers one with
robust point support over a higher-scoring candidate that needs this refinement.
The support percentage is diagnostic evidence, not semantic confidence, and a
box prompt supplies the explicit extent evidence for this particular check.

Generative Edit also checks the effective mask immediately before inference.
Fill, Remove, and Replace warn at 90% coverage and fail closed at 99.5% or
more, because a near-full edit region leaves too little source context to
reconstruct reliably. Expand is exempt because its edit region is the
explicitly generated output padding rather than a request to replace the
source frame. This guard catches accidental over-selection without trimming
disconnected regions or claiming that coverage alone proves object identity.

When the candidate is imported into Generative Edit, generation stays disabled
until the user explicitly reviews the highlighted target and confirms it, or
paints a refinement that changes the mask origin. An ambiguous candidate uses
stronger wording that asks the user to review every highlighted region. This is
an intentional human-in-the-loop gate: prompt geometry and model confidence
cannot establish semantic intent, so no model-derived target flows into Fill,
Remove, or Replace without a visible review action. Legitimate disconnected
subjects remain possible after review.

Positive prompts are also checked against the decoded source alpha before
inference. A click in a fully transparent image hole is rejected because its
RGB values do not identify an object; exclude prompts may still be placed on
transparent pixels while refining an already anchored target.

The canvas review overlay is deliberately not another source-of-truth mask.
It resizes the candidate into a cached preview capped at 1536 px on the long
edge and 2 megapixels, while Apply, the topology checks, and the persisted
raster asset retain the source-resolution coverage. When that candidate is
handed to Generative Edit without brush or compound-mask changes, the same
source-resolution coverage remains authoritative for context bounds, inference
sampling, and persistence; it is not reconstructed from the preview canvas.
This prevents a large photograph from allocating a second full-resolution RGBA
buffer on every overlay redraw and keeps the visible target aligned through the
same crop, rotation, flip, and ancestor transform as the renderer. A brush edit
or compound operation intentionally revokes that exact handoff and makes the
visible editable mask the authority.

Accepted generative edits persist the source mask's non-zero bounds alongside
the PNG asset. Reopening therefore keeps the source-sized mask as a lazy
reference and decodes only the bounded source region needed for the next
generation, rather than rebuilding the selection from the reduced review
canvas. Legacy records without bounds are recovered exactly only within the
source-mask memory ceiling; larger legacy records remain preview-authored and
must be reviewed before use. A malformed bound or dimension mismatch is a
hard mask error, never an inferred selection.

Automatic foreground proposals additionally record the canonical
source-pixel-to-world placement fingerprint used for their review overlay.
Changing the crop, image offset, content rotation, flip, node transform, or an
ancestor transform invalidates that proposal: the overlay is withdrawn and
Apply/Use remain disabled until a fresh estimate is reviewed. A source-pixel
checksum alone is insufficient because identical pixels can occupy a different
place in the document.

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
  candidate is the mask committed to the document. Under-specified clicks are
  genuinely ambiguous (part, whole, or group), which is why alternatives are
  shown instead of an automatic best-guess.
- The current SAM2 graph is promptable, not a semantic subject detector.
- Automatic subject estimates are foreground proposals. The model-backed
  levels are substantially stronger than the model-free heuristic on
  photographic subjects, but they still fail on cluttered or low-contrast
  scenes, and no level identifies *which* object the user intends.
- The model-free estimator is weakest on landscape or texture scenes and is
  used only when no model runs; the panel always names the source.
- Text discovery is open-vocabulary detection, not understanding: it can return
  a confident box for an absent object, does not parse negation/counting/
  relational language, and needs about 3 GB at 1-2K. It is an explicit
  download and never runs automatically.
- EfficientSAM-Ti is an explicit experimental provider only: quality-equivalent
  to MobileSAM in the shared A/B, no mask prompts, int64/WASM-only decoder, and
  a larger measured peak working set.
- Portrait matting (MODNet) is scoped to photographic people. It can include
  more than one person, is not a general segmenter, and remains limited on
  fine/low-contrast strands, backlighting, motion blur, and similar
  foreground/background colours.
- Hair, fur, glass, smoke, and other fractional-transparency cases need the
  existing matting/refinement tools and visual review.
- A fresh model download and frontend integration run is recorded in the
  quality methodology, while the corpus-wide real-model parity run remains a
  release validation gate; no claim of “instant” or “pixel-perfect” selection
  is made.
