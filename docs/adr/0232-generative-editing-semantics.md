# ADR-0232: Non-destructive generative editing semantics

- **Status:** Accepted boundary; Fill/Remove and promptless Expand local slices implemented
- Date: 2026-09-09
- Owners: Varve scene, engine, and editor

## Context

Varve already has an editable selection system, source-pixel raster masks,
content-addressed image assets, local ONNX/native inference, and a small
Content-Aware Fill workflow. The generative-editing slice must extend that
workflow without creating a parallel selection, asset, history, or command
system. Its first verified provider boundary is still mask-guided Fill/Remove;
prompt-conditioned Replace and outpainting Expand need different provider
capabilities.

Generative editing must remain useful offline and must not make a document
depend on a model, a worker, a temporary object URL, or a provider retaining a
response. At the same time, a text-conditioned local model is not currently
part of Varve's verified model catalogue. The product must not label a
promptless LaMa result as prompt-conditioned generation.

## Decision

Add a provider-independent `GenerativeEdit` record to the scene document. It
stores the immutable source asset reference, a source-pixel generation mask,
the context and compositing policy, operation mode, prompt/settings metadata,
provider/model provenance, and lightweight variation records. Generated image
bytes are ordinary embedded document assets. The source image remains intact;
the generated result is represented by a sibling image node that references
the accepted output asset and the edit record.

The four user-facing modes have distinct semantics:

| Mode | Mask meaning | Current verified local behavior |
| --- | --- | --- |
| Fill | Pixels to create inside a selection | PatchMatch offline; LaMa when installed |
| Remove / Generative Subtract | Object/region to reconstruct as background | Same mask-guided providers; never transparency |
| Replace | Region to replace under a text instruction | Contract and UI state only until a prompt-conditioned provider passes parity |
| Expand | Newly exposed canvas/image bounds to synthesize | Promptless local reconstruction through the qualified LaMa path or offline PatchMatch; prompt-conditioned expansion remains gated |

Provider contracts carry the mode and prompt even when a provider does not
support every mode. Capability gating is explicit: a provider must advertise
its supported modes, local/remote data policy, output contract, and model
requirements before the editor enables Generate. No local-to-remote fallback
is implicit. The initial remote provider boundary is intentionally absent;
credentials and uploads will only be added with an explicit consent flow.

Generation is a cancellable job. It captures document id, target id, source
revision, mask revision, and the requested variation. Results are rejected if
any of those freshness keys no longer match. Preview changes do not write
history. Accepting a variation is one ordinary editor transaction; cancel,
reject, and stale results leave the document untouched. Redo reuses embedded
accepted assets and never invokes paid inference again.

Masks are stored in source-image pixel space with `0 = preserve` and
`255 = edit`. The user's analytical selection, model input mask, and final
compositing mask remain separate values. Context padding is aspect-preserving
and bounded; no rectangular selection is stretched to a square. The final
composite copies source pixels outside the final mask exactly, subject to the
document's existing 8-bit raster representation.

The user-facing entry points are intentionally unified. Inspector Adjustments,
Object → Generative Edit…, and the command palette all dispatch the same
single-image action. The dialog can import the current pixel selection or a
layer mask, refine a painted/imported mask with expansion and feather controls,
and tune bounded context padding. Applying a candidate embeds its result and
mask assets, links the result node to the edit record, selects that node after
the transaction, and leaves the source layer untouched. Source, placement,
document-revision, and session checks invalidate candidates before they can
cross the transaction boundary.

## Consequences

Positive:

- Fill and Remove can reuse existing local inference and mask infrastructure.
- Accepted results survive save/reopen, copy/paste, export, and model removal.
- Provider provenance remains inspectable without claiming unsupported model
  capabilities. Prompt text is session-only until a verified provider consumes
  it, avoiding misleading document history.
- Replace has stable document semantics before its provider is available.
  Expand has a verified promptless provider boundary; it is not presented as
  equivalent to text-conditioned outpainting. A model-backed expansion uses one
  shared frame when the measured working budget permits it and ordered border
  stages above that budget, with the limitation recorded in the result warning.
- Source edits, transforms, crops, and rotations can be detected as stale
  rather than silently misapplying a result.

Costs and boundaries:

- Generated assets increase document size; variation previews stay temporary
  until accepted and are byte-budgeted by the editor session.
- LaMa cannot honor a text prompt. Replace/Expand remain visibly unavailable
  in the local provider until a licensed, measured model is integrated.
- Full alpha/color-management parity for non-sRGB inputs follows the existing
  raster pipeline and is not fabricated by the generative layer.

## Release gates

Before marketing prompt-conditioned Replace or Expand as available, Varve needs
a verified provider with deterministic fixtures, model licensing, mask/prompt
parity, bounded memory behavior, cancellation, save/reopen, export, and
browser/native evidence. The current website may market the narrower verified
local boundary: Fill, Remove / Generative Subtract, and promptless Expand. It
must state that LaMa is not language-conditioned and that the generated border
is synthesized at bounded model resolution.
