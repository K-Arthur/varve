# Generative editing system

Status: current-state contract, 2026-09-12. See [ADR-0232](../adr/0232-generative-editing-semantics.md).

Varve's generative editing surface is a non-destructive layer over the
existing scene, selection, raster-mask, asset, inference, history, and export
systems. The feature is deliberately provider-neutral: model execution may be
local native, local worker/WASM, or a future explicitly consented remote
provider, while the document semantics remain the same.

## Current capability boundary

The verified local pipeline currently supports mask-guided Fill and Remove:

```text
selection / painted mask / confirmed Object Selection candidate
  → source-image-pixel mask (0 preserve, 255 edit)
  → bounded context with aspect-preserving coordinates
  → PatchMatch (offline) or installed LaMa (local)
  → source-safe composite
  → embedded result asset + generation provenance
  → one editor transaction on accept
```

LaMa is an image-conditioned inpainting model. It does not consume natural
language, so the shared prompt control is explicitly advisory in the current
local provider and is not persisted as if it conditioned the result. Replace
and Expand use the same session and job contract, but remain capability-gated
until a verified prompt-conditioned/outpainting provider exists.

## Tool surface and synchronization

Generative Edit is available from all of the image-oriented entry points that
can safely provide one raster source:

- the image inspector's Adjustments section;
- Object → Generative Edit…;
- the command palette, under the same action id, with `generative`,
  `inpainting`, `fill`, `remove object`, and `heal` search terms.

The action requires exactly one image layer. It changes the inspector to
Adjustments and opens the same dialog, so menu, palette, and inspector entry
points cannot drift into separate workflows. If the selection is mixed or
multi-layer, the action announces the requirement and does not open a modal.

The dialog accepts five mask sources: a painted source mask, the current
document pixel selection, the selected image's raster layer mask, the source
image alpha channel, or a ready candidate from the shared Object Selection
session. Object Selection remains a suggestion until the user confirms a
candidate; CAF then copies that candidate into its own editable mask, so later
brush edits cannot mutate the transient segmentation session. All five sources
are normalized into source-image pixel space before inference. Alpha-derived
coverage remains soft at semitransparent edges instead of being thresholded into
a binary selection. Invert, Clear
Paint, Show Mask Overlay, brush size, add/subtract/intersect mask operations,
mask grow/shrink, feather, context padding, quality/model choice, prompt (when
a ready provider can consume it), Fit, 1:1, Original/Result, variation
selection/deletion, cancellation, and Apply are exposed in the same session. The
last retained candidate cannot be deleted. Changing
the source, mask, or generation settings invalidates the preview rather than
silently applying a candidate made for an earlier state.

On Apply, the source is revalidated, the accepted result and mask assets are
embedded, and the existing image node is updated in one editor transaction.
Its id, ordering, transforms, effects, relationships, and selection are
preserved. The immutable source snapshot and `Document.generativeEdits` record
are retained for Restore Original, auditability, and later regeneration. The
Layers panel, inspector, selection state, undo/redo, save/reopen, clipboard,
and export therefore see the same accepted result. Reopening the Generative
Edit dialog rehydrates the accepted mode, recipe, mask, output frame, and
retained candidates from document data; it never invokes inference merely to
restore the editing session. Undo and redo replay document data; they never
invoke inference.

## Document model

`Document.generativeEdits` is keyed by stable edit id. An edit records:

- source node and source asset id;
- source revision and placement fingerprint;
- a source-pixel mask asset and its dimensions;
- operation (`fill`, `remove`, `replace`, or `expand`);
- optional provider-consumed prompt, negative prompt, seed, quality, context
  padding, and mask refinement settings. Prompt text is persisted only when
  the recorded provider actually consumed it;
- provider/model/runtime provenance and creation time;
- variation records, accepted variation id, and compatibility version.

Generated pixels live in `Document.assets`. The accepted result remains an
ordinary image asset linked from the original image node and generation record;
the original source bytes are retained separately. Missing models therefore
affect regeneration only, not rendering, restore, or export of an accepted
result.

Variation assets remain compressed in the document, and each newly accepted
candidate also retains a bounded 256-pixel thumbnail. On reopen the dialog
uses thumbnails for inactive candidate cards and does not decode every retained
full-resolution candidate into `ImageData`; only the active candidate uses the
small working representation needed by the session. Selecting a candidate
loads its full asset for review or Apply. This keeps accepted edits usable on
memory-constrained Chromebooks and ARM devices without discarding older
candidates or their provenance. Legacy records without thumbnails remain
readable and fall back to their full asset until the next Apply creates the
thumbnail metadata.

## Freshness and history

Every job captures document id, target id, immutable source asset/hash,
source-placement fingerprint, mask revision, effective-settings fingerprint,
output-frame fingerprint, and an edit-session id. Applying a result rechecks
all source-affecting keys synchronously before starting the editor transaction.
Unrelated document edits do not invalidate a candidate. A stale, cancelled,
deleted-target, or closed-document result is discarded. Previewing or changing
the active variation is transient. Accepting is one undoable transaction; redo
reuses the embedded result asset.

Native cancellation has two coordinated parts. The renderer races the native
invocation against its `AbortSignal`, so the dialog acknowledges cancellation
immediately even if an IPC future has not resolved. The desktop command keeps a
cancellation tombstone, kills the supervised helper, and checks that tombstone
before and after process registration and before reading output. Consequently a
late helper response cannot turn a cancelled request into an accepted candidate.

All heavy local inference also passes through `InferenceAdmission`. It is a
single FIFO lease queue shared by prompt generation, native LaMa, background
removal dispatch, and the generic model worker host. The default policy admits
one heavy request at a time; callers may supply a measured reservation for a
known model and working frame. A queued request is removed immediately when
its signal aborts, and every owner releases its lease in `finally`, including
worker crashes, timeouts, and decode failures. Quick heuristic removal does
not acquire a lease. This keeps a background-removal fallback chain from
competing with generation while allowing unrelated lightweight editor work to
continue.

The native diffusion boundary performs a second resource check immediately
before helper startup. Linux (including a ChromeOS Linux desktop container),
Windows/Windows-on-ARM, and macOS/Apple Silicon use platform memory APIs when
available; the status reports the measured architecture, backend, available
memory, and conservative requirement. A constrained device is refused before
model loading and is directed to the promptless Fast/PatchMatch path. Browser
device-memory hints are advisory only and never imply that a prompt model is
available; WASM/WebGPU providers must still pass their own safe-peak budget.

Fast/PatchMatch preparation and matching run in a dedicated module worker in
browser-capable runtimes. Cancelling a request terminates that worker, so a
long textured-region search cannot block pointer input or later mutate the
dialog. The synchronous implementation remains only for SSR, tests, and
embedded runtimes without `Worker`; it is never the preferred desktop/web
path.

### Memory-bounded source preparation

The dialog preview is capped at four million pixels. For Fill and Remove, the
preview mask is used to calculate a source-image rectangle around the refined
selection (with source-pixel context padding capped at 256 pixels). Only that
rectangle is decoded into explicit `ImageData`; the source image and mask are
not first expanded into full-resolution JavaScript buffers. The working raster
is aspect-preserving and is capped at 1,048,576 pixels for a constrained tier,
4,000,000 for a standard tier, 8,000,000 for a high tier, and 2,000,000 when a
browser cannot establish a tier. A downsampled working raster keeps its source
rectangle and mask mapping, so the result is never mistaken for a new source
frame.

The user mask is encoded back into the source-image coordinate frame without a
full-resolution `Uint8Array`. A bounded result is converted into a
source-over overlay by solving the existing premultiplied, linear-light
composite equation; unmasked pixels have zero overlay alpha and remain from
the original image. One final full-size canvas is still required to produce an
embedded accepted PNG, but inference and intermediate `ImageData` are bounded
to the edit region. Expand retains its explicit full-frame preparation until a
qualified outpainting provider is available; it is currently unavailable, so
this exception cannot be reached through the product UI.

The renderer reports a best-effort platform family and architecture in the
resource profile. ChromeOS/ARM browser sessions therefore show their
constrained local path and use the smaller working budget when the browser
exposes a two-gigabyte hint. That hint is advisory: browser model providers
must still pass their safe-peak check. Native Linux (including the ChromeOS
Linux container), Windows/Windows-on-ARM, and macOS/Apple Silicon perform the
authoritative available-memory check in the desktop process immediately before
model startup. Refusal is actionable and leaves Quick Cleanup available; no
remote fallback is attempted.

## Mask and coordinate contract

The analytical selection is document-space and camera-aware. The model mask is
source-image pixel space, aligned to the untransformed decoded source. The
final composite mask is derived separately so feathering, expansion, and
provider output cannot alter preserved pixels outside the intended edit
boundary. Image crop, flip, rotation, perspective, and node transforms are
resolved through the existing image-placement mapping before rasterization.

Context extraction clamps to source bounds and retains disconnected components
and holes. Model input uses explicit channel/alpha conventions documented by
the provider adapter. The composite copies source pixels outside the final
mask; transparent source RGB is never treated as meaningful context.

## Provider and privacy contract

Providers declare capabilities, locality (`local` or `remote`), model id and
version, required model bytes, supported operation modes, maximum dimensions,
accepted parameters, readiness, stable reason codes, and cancellation
behavior. The engine exposes this per mode rather than leaving callers to infer
support from a handful of global booleans: a browser reconstruction provider
advertises Fill/Remove with one variation and no prompt parameters, while the
desktop diffusion provider advertises prompt/negative-prompt, seed, strength,
steps, guidance, and up to four variations only for modes it can execute. A
mode can be executable in principle but not ready until its local model has
passed qualification; the UI combines both signals and reports the actual
setup action or blocker.

The native diffusion provider runs in a supervised helper process. The renderer
receives an opaque qualified model handle, never a model filesystem path or
model bytes. Imported safe-format artifacts are hashed and must pass an actual
masked helper run before prompt modes are enabled. The helper validates that
the decoded source and mask dimensions match the declared working frame before
loading weights, so it never guesses at resampling or mask alignment. The
desktop workflow supports an explicit, allowlisted download or user import,
then validation; downloads resume through a native partial file, verify the
pinned SHA-256, and install atomically. There is no silent model download.

Native image adapters validate the returned dimensions against the requested
working frame before decoding or compositing. They also require a finite
non-negative processing time, a non-empty execution backend/model identity,
and string-only warnings. Untrusted IPC metadata therefore cannot create a
candidate with invented geometry or provenance.

There is no silent remote fallback. A future remote provider must request
consent immediately before upload, state the provider and transmitted data,
respect a global remote-inference setting, and never store credentials or raw
image data in the document.

## Export

Accepted results are embedded image assets and therefore participate in the
existing raster compositor, package export, save/reopen, clipboard, PDF, SVG
flattening, and print preflight paths. A document does not need the original
model or provider to render an accepted result. Regeneration may be unavailable
after reload when the model is missing; the accepted result remains available.

## Qualification status and remaining work

The adapter/build integration and deterministic qualification gate are present.
The desktop download profile is Stable Diffusion 1.5 Inpainting Q4_0, pinned to
the upstream revision and SHA-256 recorded in the capability matrix, and is
licensed under CreativeML OpenRAIL-M. A release-quality profile still requires
cross-platform backend qualification, the real-photograph task corpus, and
reviewed Fill/Remove/Replace/Expand results. Until that evidence is recorded,
the product must keep prompt-conditioned modes unavailable and must not use
their interface presence as marketing evidence.

## Non-goals for this slice

- claiming text-conditioned Replace/Expand without a qualified native model;
- silently uploading a document to a cloud provider;
- retaining every full-resolution variation decoded in memory;
- creating a second mask or asset store;
- changing the per-node render/replay hot path.
