# Generative editing capability matrix

This is the qualification ledger for the local-first generative editing
workflow. “Implemented” means that the code path exists. “Automatically
verified” means a repeatable repository check passed. “Visually reviewed” is
reserved for an inspected output from the production provider; interface
screenshots and mocks do not qualify.

Last updated: 2026-09-12.

## Provider and platform status

The engine-level capability object records `available`, `ready`, supported
parameters, limits, and a stable `reasonCode` for every mode. “Available” means
the selected runtime has an implementation; “ready” additionally requires all
local model prerequisites. This distinction is reflected in the dialog before
the user starts a job.

| Capability | Browser | Desktop Linux CPU | Desktop Vulkan/Metal | Qualification evidence |
|---|---|---|---|---|
| Fill without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Remove without a prompt | Implemented; automatically verified with deterministic tests | Implemented through the shared pipeline | Not separately qualified | `packages/engine/src/generativeEdit/generativeEdit.test.ts`, `tests/e2e/caf/caf.spec.ts` |
| Prompt-conditioned Fill | Unavailable by design; no remote fallback | Candidate adapter exists, but no model is qualified after the 2026-09-12 real-photo run | Not verified | [Runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Replace | Unavailable by design | Candidate adapter exists, but no model is qualified after the 2026-09-12 real-photo run | Not verified | [Runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Prompt-conditioned Expand | Unavailable by design | Contract and candidate adapter exist, but no model is qualified after the 2026-09-12 real-photo run | Not verified | `packages/editor/src/components/ContentAwareFill/expandCanvas.test.ts`; [runtime qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md) |
| Mask editing and refinement | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/components/ContentAwareFill/maskOperations.test.ts`, CAF browser E2E (paint/source controls) |
| Object Selection → Generative Edit mask | Implemented; workflow-wired and automatically verified | Shared implementation; confirmed candidate only | Shared implementation; confirmed candidate only | `tests/e2e/caf/object-selection-mask-source.spec.ts`; SAM2 quality remains a separate real-model gate |
| Native low-memory preflight | Browser hints only; provider safe-peak gate remains required | OS-level available-memory check before helper startup | Windows/ARM and macOS/Apple Silicon code paths compile-targeted; package qualification pending | `apps/desktop/src-tauri/src/generative_resources.rs`; desktop package matrix pending |
| In-place acceptance and Restore Original | Implemented; automatically verified | Shared implementation | Shared implementation | `packages/editor/src/imageOperations.test.ts` and scene persistence tests |
| Save/reopen, clipboard, package export | Implemented paths | Implemented paths | Shared implementation | Document codec, closure, and clipboard tests; generative package evidence pending |

## Pinned desktop model profile

The explicit download profile is Stable Diffusion 1.5 Inpainting Q4_0 from
the `gpustack/stable-diffusion-v1-5-inpainting-GGUF` repository. The artifact is
pinned to the `21491e4` repository revision, is 1,747,219,584 bytes, and has
SHA-256:

```text
d157ce24483f0c999062da140eacebe8f3ed015e652723e31f6d39119b800c16
```

The model card identifies the artifact as CreativeML OpenRAIL-M and warns that
the GGUF is experimental for a patched runtime. Varve therefore performs a
masked production-helper qualification after installation; a matching file
hash alone does not make the provider ready. The pinned candidate failed the
2026-09-12 semantic/runtime inspection and remains unqualified. See the
[model card](https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF),
[stable-diffusion.cpp runtime](https://github.com/leejet/stable-diffusion.cpp),
and [qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).

The pinned Rust binding is `diffusion-rs = 0.1.20`. The helper is supervised in
a separate process, and the webview receives only an opaque qualified handle.
Weights are not stored in the repository or in portable documents.

## Evidence state

- The repository currently contains eleven attributed photographic fixtures:
  [fixture provenance](../../tests/e2e/fixtures/PROVENANCE.md). They are
  used by the browser surface lane for interface and image-path checks, not
  the planned 24-photo/32-task release corpus.
- The downloaded Q4_0 artifact was verified against the pinned hash in a
  temporary test location. A real masked CPU inference run completed, but its
  inspected output failed prompt adherence and photographic plausibility. The
  Vulkan diagnostics likewise failed runtime integrity or semantic quality;
  all retained outputs and hashes are listed in the [qualification report](../audits/generative-editing-runtime-qualification-2026-09-12.md).
  The full task corpus is not yet run, so the prompt modes remain gated for
  release claims.
- Vulkan on Linux/Windows, Metal on macOS, constrained 4-GB behaviour, cold and
  warm timings, cancellation latency, and package-level reopening evidence
  remain outstanding.

The renderer-side cancellation races are covered by the native-provider unit
lane: abort rejects active prompt generation and LaMa requests immediately and
forwards each opaque request id to its desktop cancellation command. The
desktop LaMa command now owns a request-scoped cooperative token and serialized
execution gate; the native helper termination and cross-platform latency
measurements still require native package evidence.

This ledger deliberately records gaps rather than converting an enabled
control or a passing mock into a capability claim.
