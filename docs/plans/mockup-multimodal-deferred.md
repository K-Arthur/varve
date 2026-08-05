# Mockup Multimodal Assistance — Deferred Plan (Level 5)

Status: deferred. The typed request contract shipped (Stage A/B); the
model-backed stages below are designed but not implemented.

## Why deferred

- The deterministic Level 1-2 workflow (templates, manual placement, linked
  sources) is complete and testable without any model.
- Surface/plane detection requires a new ONNX model: catalog entry with
  pinned version + SHA-256, size record, consent + download UI (the
  ModelDownloadDialog pattern), memory gating via
  `engine/src/inference/core/RuntimeCapabilities.ts`, worker inference
  registration in `inferenceWorker.ts`, and CSP host verification. That is a
  self-contained project.
- The current `@varve/ai` package is a mock chat + command registry; real
  model infra lives in `@varve/engine/src/inference/` — no second
  model-management system will be added.

## Contract (already shipped)

`packages/scene/src/mockup/multimodal.ts`:

- `MockupRequest` (typed, validated): sourceNodeIds, templateId, targetKind,
  placementMode, preserveSourceLink, requestedVariants, textInstruction.
- `validateMockupRequest` rejects unknown/contradictory values.
- `classifyMockupIntent` maps intent to template categories and a
  deterministic placement mode for 'auto' (flat for phones/tablets/browser/
  desktop; quad for laptop/poster/packaging/signage/print/stationery).
- Reserved modes ('mesh', 'cylindrical') and batch variants produce explicit
  warnings, never silent degradation.

## Pipeline stages (designed)

- Stage A — Gather inputs: selected nodes, current page, imported photo,
  clipboard image, optional text instruction, optional manual quad/mask.
- Stage B — Classify intent: `MockupRequest` + schema validation (shipped).
- Stage C — Analyze target: candidate planar regions, screen-like regions,
  quad corners, foreground occluders, depth, horizon, light direction,
  surface curvature, glare detection. Typed `MockupAnalysisResult` with
  confidence, masks, corners, warnings, model/provider, resolution, timing,
  and a fallback recommendation. No high-confidence geometry from weak
  evidence.
- Stage D — Build a deterministic `MockupPlan` from the analysis; show it
  visually before committing when ambiguous.
- Stage E — Interactive preview: latest-request-wins, cancellation, stale
  rejection, panel-scoped resources, context-loss recovery.
- Stage F — Manual refinement: corner/mesh points, crop, fit, masks,
  occluders, shadow/highlight/reflection, blur/grain/distortion, color,
  background, source content.
- Stage G — Commit through normal editor transactions; dedupe assets;
  reject stale requests; clear errors on deleted sources.
- Stage H — Export re-renders at output resolution (never upscales preview).

## Detection model requirements (whenever a model is chosen)

- Source availability + redistribution terms verified.
- Version pinned with SHA-256; size recorded; download progress +
  cancellation; memory gating; platform compatibility; CPU fallback; tiling
  where needed; model-removal handling; diagnostics; CSP updated only for
  verified model hosts.

## Invariants

- The pipeline never mutates the document from an unvalidated model
  response.
- AI output is inspectable and manually correctable; the original image is
  preserved.
- Relighting/color-matching features are non-destructive and adjustable
  (white balance, brightness/contrast, shadow/highlight tint, local blur,
  grain matching, glare, reflection simulation) — never an opaque generative
  edit.
- No uploads by default; no account; local inference where supported;
  network access is shown for anything that needs it.
