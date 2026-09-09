# Generative editing system

Status: current-state contract, 2026-09-09. See [ADR-0232](../adr/0232-generative-editing-semantics.md).

Varve's generative editing surface is a non-destructive layer over the
existing scene, selection, raster-mask, asset, inference, history, and export
systems. The feature is deliberately provider-neutral: model execution may be
local native, local worker/WASM, or a future explicitly consented remote
provider, while the document semantics remain the same.

## Current capability boundary

The verified local pipeline currently supports mask-guided Fill and Remove:

```text
selection / painted mask
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

The dialog accepts three mask sources: a painted source mask, the current
document pixel selection, or the selected image's raster layer mask. All three
are normalized into source-image pixel space before inference. Invert,
Clear Paint, Show Mask Overlay, brush size, mask expansion, feather, context
  padding, quality/model choice, prompt (where the staged mode needs it), Fit, 1:1, Original/Result, variation
selection, cancellation, and Apply are exposed in the same session. Changing
the source, mask, or generation settings invalidates the preview rather than
silently applying a candidate made for an earlier state.

On Apply, the source is revalidated, the accepted result and mask assets are
embedded, and the generated sibling layer plus `Document.generativeEdits`
record are written in one editor transaction. The new layer is selected after
the transaction commits, so the Layers panel, inspector, selection state,
undo/redo, save/reopen, clipboard, and export all see the same accepted
result. Undo and redo replay document data; they never invoke inference.

## Document model

`Document.generativeEdits` is keyed by stable edit id. An edit records:

- source node and source asset id;
- source revision and placement fingerprint;
- a source-pixel mask asset and its dimensions;
- operation (`fill`, `remove`, `replace`, or `expand`);
- optional provider-consumed prompt, negative prompt, seed, quality, context
  padding, and mask refinement settings. The current local provider does not
  consume prompts, so the editor does not persist prompt text for these runs;
- provider/model/runtime provenance and creation time;
- variation records, accepted variation id, and compatibility version.

Generated pixels live in `Document.assets`. The accepted result is an ordinary
image layer linked to the generation record; it is not baked into the original
source. Missing models therefore affect regeneration only, not rendering of an
accepted result.

## Freshness and history

Every job captures document id, target id, source revision, a source-placement
fingerprint, and an edit-session id. Applying a result rechecks all keys synchronously before
starting the editor transaction. A stale, cancelled, deleted-target, or
closed-document result is discarded. Previewing or changing the active
variation is transient. Accepting is one undoable transaction; redo reuses the
embedded result asset.

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
and cancellation behavior. The editor only exposes settings that the selected
provider consumes. Model downloads use the existing verified manifest and
IndexedDB/native storage; binaries do not go to localStorage.

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

## Non-goals for this slice

- claiming text-conditioned Replace/Expand with LaMa;
- silently uploading a document to a cloud provider;
- retaining every full-resolution variation decoded in memory;
- creating a second mask or asset store;
- changing the per-node render/replay hot path.
