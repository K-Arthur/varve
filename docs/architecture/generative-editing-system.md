# Generative editing system

Status: current-state contract, 2026-09-12. See [ADR-0232](../adr/0232-generative-editing-semantics.md).

Varve's generative editing surface is a non-destructive layer over the
existing scene, selection, raster-mask, asset, inference, history, and export
systems. The feature is deliberately provider-neutral: model execution may be
local native, local worker/WASM, or a future explicitly consented remote
provider, while the document semantics remain the same.

## Current capability boundary

The verified local pipeline currently supports mask-guided Fill and Remove, and
promptless Expand:

```text
selection / painted mask / confirmed Object Selection candidate
  → source-image-pixel mask (0 preserve, 255 edit)
  → bounded context with aspect-preserving coordinates
  → PatchMatch (offline) or installed LaMa (local)
  → source-safe composite
  → embedded result asset + generation provenance
  → one editor transaction on accept

expand margins on a retained source rectangle
  → validated full-frame plan (source translated, never rescaled)
  → border coverage mask including corners
  → LaMa (local model) or PatchMatch (offline) on the padded frame
  → authoritative source restored byte-for-byte
  → expanded asset + output-frame geometry + provenance
  → one editor transaction on accept
```

LaMa is an image-conditioned inpainting model. It does not consume natural
language, so the shared prompt control is explicitly advisory in the current
local provider and is not persisted as if it conditioned the result.
Prompt-conditioned Replace and Expand use the same session and job contract but
remain capability-gated until a verified prompt-conditioned model exists.
Promptless Expand is available because its plan, source protection, and real
model output were measured; see
[the expand qualification](../audits/generative-expand-qualification-2026-09-13.md).

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
selection/deletion, cancellation, Edit mask, and Apply are exposed in the same
session. Reopening an accepted edit keeps its result visible; Edit mask returns
to the editable mask without losing the prompt or retained candidates, and a
new generation is required before Apply can mutate the document again. The
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
- variation records, accepted variation id, and compatibility version;
- `parentEditId` when an edit is generated from an earlier accepted edit on the
  same layer, preserving explicit lineage across repeated edits and imports.

Generated pixels live in `Document.assets`. The accepted result remains an
ordinary image asset linked from the original image node and generation record
for full-output providers. Bounded providers retain the immutable source fill
and link a transparent region-overlay asset above it; both assets and the
provenance marker travel together. The original source bytes are retained
separately. Missing models therefore affect regeneration only, not rendering,
restore, or export of an accepted result.

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
memory, and conservative requirement. A model's qualification record is also
bound to the exact helper runtime, target OS, backend, and CPU architecture;
moving the model to another platform or ARM/x86 build requires a fresh masked
qualification. A constrained device is refused before model loading and is directed to the promptless Fast/PatchMatch path. Browser
device-memory hints are advisory only and never imply that a prompt model is
available; WASM/WebGPU providers must still pass their own safe-peak budget.
If a native target does not expose a trustworthy available-memory measurement,
model-backed work is refused rather than treating unknown capacity as unlimited;
the status stays not-ready and the promptless Fast/PatchMatch path remains
available.
The background-removal provider's legacy capability facade projects this same
canonical runtime snapshot, so segmentation, Object Selection, and generative
editing cannot disagree about a 2 GB browser, ChromeOS container, or ARM
WebView's safe local path.

The same native boundary now protects ONNX-backed LaMa, background-removal,
and denoise commands before ONNX Runtime initialization and again immediately
before session checkout. Their reservations use the measured peak RSS recorded
in the native model catalog, plus bounded source-image buffers; graph download
size is not used as a proxy. The native session pool admits one model session
at a time and does not retain sessions whose measured peak exceeds its cache
budget. This is important on 4–8 GB ARM laptops and Crostini containers, where
BiRefNet's 7–8.5 GB native CPU peaks must be refused while the smaller
promptless or lightweight paths remain usable.

Fast/PatchMatch preparation and matching run in a dedicated module worker in
browser-capable runtimes. Cancelling a request terminates that worker, so a
long textured-region search cannot block pointer input or later mutate the
dialog. The synchronous implementation remains only for SSR, tests, and
embedded runtimes without `Worker`; it is never the preferred desktop/web
path.

### Memory-bounded source preparation

The dialog preview is capped at two million pixels. For Fill and Remove, the
preview mask is used to calculate a source-image rectangle around the refined
selection (with source-pixel context padding capped at 256 pixels). Only that
rectangle is decoded into explicit `ImageData`; the source image and mask are
not first expanded into full-resolution JavaScript buffers. The working raster
is aspect-preserving and is capped at 1,048,576 pixels for a constrained tier,
4,000,000 for a standard tier, 8,000,000 for a high tier, and 2,000,000 when a
browser cannot establish a tier. A downsampled working raster keeps its source
rectangle and mask mapping, so the result is never mistaken for a new source
frame.

The user mask is encoded back into the source-image coordinate frame as a
source-resolution grayscale PNG. `CompressionStream` receives one scanline at
a time, so persistence does not allocate a source-resolution RGBA
`Uint8Array` or `ImageData`; if the runtime lacks that API, the operation fails
with an actionable setup message instead of silently persisting a preview
bitmap. A bounded result is converted into a source-over overlay by solving
the existing premultiplied, linear-light composite equation; unmasked pixels
have zero overlay alpha and remain from the original image. Acceptance stores
that transparent bounded patch above the immutable source fill, so the normal
browser path does not require a full-frame generated PNG. The overlay image
fill is placed by the canonical image-placement transform (fit, crop, uniform
scale, rotation, and flip), while its provenance marker also stores the
source-pixel frame independently of node-local coordinates. Resized or
uniformly fitted images therefore retain exact patch alignment after
save/reopen; tiled, perspective-warped, cropped-out, or non-uniformly
stretched mappings fail closed with an actionable message rather than
producing a plausible but displaced edit. Expand uses its own validated
full-frame plan instead of the bounded-overlay path: the retained rectangle is
translated by the left/top margins with no resampling, the new border including
corners is covered by the generation mask, the model runs on the padded frame,
and the authoritative source is restored byte-for-byte before acceptance. The
accepted expanded asset replaces the image fill and the node geometry grows to
the output frame while `outputFrame` preserves the source's world-space
position, so expanding on the top or left does not move the subject. The review
surface states the effective generation resolution, because the fixed LaMa
graph letterboxes the frame and enlarges its output. When a bounded edit is
repeated, the next bounded context starts from the immutable source plus all
previously accepted overlay patches; the active candidate is excluded only
from the review baseline so it cannot be painted twice.

The renderer reports a best-effort platform family and architecture in the
resource profile. ChromeOS/ARM browser sessions therefore show their
constrained local path and use the smaller working budget when the browser
exposes a two-gigabyte hint. That hint is advisory: browser model providers
must still pass their safe-peak check. Native Linux (including the ChromeOS
Linux container), Windows/Windows-on-ARM, and macOS/Apple Silicon perform the
authoritative available-memory check in the desktop process immediately before
model startup. Refusal is actionable and leaves Quick Cleanup available; no
remote fallback is attempted.
An unsupported or temporarily unmeasurable native memory API is also a refusal
condition for model-backed work, with the platform and architecture included
in the recovery message. This prevents an ARM or embedded build from turning an
unknown budget into an unbounded allocation attempt.

Object Selection follows the same rule before it allocates a full-resolution
canvas and `ImageData`. The SAM2 encoder's measured peak and the source-frame
working set are checked against the browser/WebView safe peak, rather than
checking the model file alone. A 2 GB Chromebook or ARM browser therefore
receives an immediate, actionable refusal for a large photograph and keeps its
prompts intact; the user can paint a mask or use Fast/PatchMatch instead. This
path does not silently downscale a confirmed source mask, because doing so
without carrying the exact source-to-working transform through the decoder
would make the result appear plausible while targeting the wrong pixels. A
Tauri WebView first reuses the native OS/cgroup memory snapshot when available,
so a capable ARM desktop is not confused with a browser that merely omitted
`navigator.deviceMemory`; if that snapshot cannot be obtained, the conservative
WebView safe peak remains in force.

AI background removal applies the same source-aware policy before its preview
downscale. On a browser that exposes an explicit memory hint, the reservation
includes the resident source frame and the temporary preparation copy, so a
large photograph is refused before a second full-resolution canvas can trigger
an allocation failure. Quick Cleanup remains available. An absent browser hint
does not claim a measured low-memory device; the canonical runtime's
conservative safe peak still decides whether source preparation fits, and the
provider's own model/runtime gates remain authoritative for starting AI. When a
native model is installed on desktop, the renderer first sends only the source
dimensions to a native preflight command, before canvas/PNG encoding; the
desktop command checks the measured OS/cgroup budget and repeats the check
before ONNX session checkout. If no native model is ready, a Tauri WebView is
treated as a browser fallback and must pass the conservative WebView source
preflight instead of assuming the host's memory is available to WASM.

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

The promptless LaMa path is separately qualified for expansion on Linux x86_64
CPU: four public-domain photographs covering right/bottom, both-sides, top, and
all-sides margins produced exact protected-pixel equality, non-degenerate
generated borders, and plausible continuation for sky, water, grass, studio
backdrop, and plain print surround. Measured warm latency was 20 to 21 seconds
(58 seconds including the first cold model load). The qualification report
records the evidence hashes, effective-resolution boundary, and declared
content categories. Windows, macOS, ARM, constrained-memory, and browser
model lanes remain to be measured; the browser lane uses PatchMatch texture
continuation rather than the model.

## Non-goals for this slice

- claiming text-conditioned Replace/Expand without a qualified native model;
- silently uploading a document to a cloud provider;
- retaining every full-resolution variation decoded in memory;
- creating a second mask or asset store;
- changing the per-node render/replay hot path.
