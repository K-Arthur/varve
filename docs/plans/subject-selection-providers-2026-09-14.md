# Subject-selection providers — implementation plan (2026-09-14)

Companion to the research ledger
`docs/quality/subject-selection-provider-research-2026-09-14.md` and the parity
methodology `docs/quality/object-selection-parity.md`. This plan works on the
existing Object Selection / Background Removal / model-manager stack; it does
not create a second AI-selection subsystem.

## What already exists (baseline audit, 2026-09-14)

- Prompted selection: SAM2-Hiera-Tiny split ONNX encoder/decoder behind the
  worker bridge, transient `EditorState.objectSelectionSession`, reviewed-
  candidate commit path shared by "Apply as mask" and "Use as selection",
  source-fingerprint validation, bounded embedding cache.
- Automatic subject estimate: model-free border/centre flood proposal set
  (`@varve/engine/foregroundSelect`), no download, ranked estimates.
- Foreground-removal models: `u2netp` (bundled), `isnet-general-use`,
  `birefnet-general-lite`/`birefnet-general` through the unified catalog,
  provider chain (worker ONNX → native → direct ONNX → cloud-disabled),
  model install UI, memory preflight, and `removeBackground` returning a
  source-resolution mask without touching any document.
- Quality infrastructure: segmentation corpus, IoU/Dice/boundary-F metrics,
  real-model parity runner, real-model E2E spec, measured SAM2 corpus table.
- Confirmed defect: the browser memory preflight in `removeBackground`
  assessed every AI method with the bundled `u2netp` peak (330 MB) even when
  the resolved model would be IS-Net (1.3 GB) or BiRefNet (multiple GB), so
  the admission gate could under-estimate a run that later aborts the webview.
- Confirmed defect: `getSegmentationModelSpec('u2netp-int8')` fell through to
  the 1024/ImageNet/sigmoid branch while the artifact is a 320x320
  u2netp-family graph.

## Priorities

| Phase | Work | Status in this plan |
| --- | --- | --- |
| P0 | Fix the preflight/model-spec correctness defects; pin reviewed-candidate behaviour with tests | Shipped 2026-09-14 |
| P1 | Model-backed automatic foreground proposals + routing policy + honest UI + mask output | Shipped 2026-09-14 |
| P2 | MobileSAM adapter (smaller-download prompted provider) behind the provider seam, gated on corpus and real-photo evidence | Adapter, pinned artifact, contract tests, and Chromium WASM workflow shipped 2026-09-14; remains explicit experimental and is not in Auto routing |
| P3 | Refinement handoff from proposals (existing refine section is the handoff) | Shipped via selection→refine path |
| P4 | EfficientSAM A-B | Deferred (adapter-only, not shipped) |
| P5 | Text/object discovery (Grounding DINO → promptable segmenter) | Deferred, research only |

### P0/P1 implementation notes (2026-09-14)

- `BackgroundRemovalOptions.modelId` is an explicit, non-substitutable model
  request honored by the worker, direct-ONNX, and native providers; native
  declines when the request is not its own model, and the automatic
  quality-to-balanced dispatch fallback is skipped for explicit requests.
- `removeBackground`'s preflight resolves the model the request will run and
  assesses its catalog working set (5 s bounded probe), and
  `getSegmentationModelSpec` maps `u2netp-int8` to the 320 px u2netp family.
- `@varve/engine/subjectProposal` owns routing, candidate derivation
  (`proposalSetFromAlpha`), execution, and the editor-facing capability
  helpers. `SelectionSourcesPanel` renders quality levels, the provider that
  ran with step-down/skip reasons, explicit install offers with size and
  progress, candidate actions, and "Apply as mask".
- Tests: engine routing/execution unit tests, admission regression tests, RTL
  panel coverage, and the real-photo `subject-proposal` E2E spec.


## Routing policy

One decision function returns the provider, the model id, the reason, and what
was rejected. It consumes capability facts, not marketing tiers:

```text
quality intent (fast | balanced | high)
+ installed models (catalog + loader availability)
+ runtime (browser WASM / Tauri WebView / native-ready)
+ measured model working set (catalog peakMemoryBytes)
+ source dimensions (through the existing resource assessment)
+ whether an accelerated web EP exists (native-only rules)
```

Rules:

- `fast` → `u2netp` (bundled). Never downloads, never silently upgrades to a
  larger installed model.
- `balanced` → `isnet-general-use` when installed and admissible; otherwise
  `u2netp` with the rejection reason recorded and shown.
- `high` → `birefnet-general-lite` when installed and admissible; otherwise
  `isnet-general-use`; otherwise `u2netp`. "Not installed" is a first-class
  outcome: the UI offers the install with its size instead of pretending.
- Model-free fallback: when no model is installed *and the user has not asked
  for a model*, keep the existing heuristic estimate. When a model was
  requested but cannot run, say so; do not silently present the heuristic as
  the model result.
- Never download implicitly. The engine reports `requiresDownload` and
  `downloadBytes`; the editor shows an explicit confirmation.

## Provider matrix (target)

| Intent | Zero-download | Fast | Balanced | High quality | Refinement |
| --- | --- | --- | --- | --- | --- |
| Automatic foreground | model-free heuristic | U²-NetP | IS-Net (installed) | BiRefNet Lite (installed, native-preferred) | existing selection refine + hair/trimap matting |
| Prompted object | — (explicit unavailable state) | — | SAM2-Hiera-Tiny (installed, validated, and within the measured budget) | MobileSAM only when explicitly chosen; the 44.7 MB download still reached ~1.15 GB RSS in the real-photo Node gate, so it is not treated as a low-memory guarantee | existing selection refine |
| Text discovery | — | — | — | — | not shipped |

## Acceptance criteria for this plan

1. The reviewed candidate is the committed candidate for selection, mask, and
   proposal outputs (pinned by tests; no re-inference on commit).
2. A model-backed proposal never substitutes a different model silently; the
   decision record (provider, model, reason, rejected alternatives) is visible
   in diagnostics and reflected in the UI copy.
3. The preflight gate uses the resolved model's working-set estimate.
4. `Select subject` offers fast/balanced/high quality modes with honest labels,
   explicit install affordances and sizes, and preserves the model-free path.
5. Real-model validation: corpus + E2E for the automatic path; MobileSAM
   contract, corpus, and real-photo browser evidence are recorded, but its
   boundary-click ambiguity keeps it out of default routing until a broader
   browser corpus clears the promotion gate.
6. Deterministic selectors (Magic Wand, colour range, luminance, alpha) stay
   model-free.
7. Docs, website copy, and notices match the shipped behaviour.
