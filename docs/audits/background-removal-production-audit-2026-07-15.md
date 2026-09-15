# Background Removal Production Audit

**Date:** 2026-07-15
**Scope:** Offline inference, mask/document integration, refinement, rendering, persistence, export, UI access paths, accessibility, tests, and model governance

## Verdict

Strata has a useful background-removal prototype, but it is not production-ready. The largest failures are architectural data-flow failures, not simply model quality: final masks are generated at placed/preview dimensions, image and mask placement use different transforms, cancellation can misroute worker results, refinement ignores transforms, and the image-only mask state is disconnected from Strata's native mask system and several export paths.

The isolated unit suite is green while the real browser workflow is red. That discrepancy is itself a release blocker.

## Evidence Collected

### Focused unit and component suite

```text
Command: pnpm exec vitest run <background-removal focused paths>
Result: 32 test files passed, 288 tests passed
Duration: 19.45 seconds
```

The suite covers providers, model storage, worker helpers, heuristic operations, mask operations, UI controls, model consent, subject picking, and several async error paths. It does not reproduce transferred-buffer detachment, a late worker response after cancellation, natural-pixel reconstruction, transformed brush input, crop/replacement alignment, save/reopen, or major export paths.

### Chromium E2E

```text
Command: npx playwright test tests/e2e/effects/bgRemoval.spec.ts \
  tests/e2e/canvas/background-removal.spec.ts --project=chromium --reporter=list
Result: 0 passed, 6 failed
```

Observed failures:

- Quick removal recorded `background removed (quick)` in the accessibility tree but the expected transparent canvas pixels never appeared.
- Undo/redo mask rendering timed out for the same pixel-level reason.
- One import path produced no layer.
- The AI path used an ambiguous `text=Processing` locator that matched both background-removal progress and unrelated inspector copy.
- Two older tests exhausted their timeout inside fixed `waitForTimeout` calls.

Screenshots confirmed that one route reached the intended Background Removal Inspector and changed document metadata while the displayed pixels stayed inconsistent. Another route remained indefinitely in a processing state. This shows why each access path needs an end-to-end state and pixel assertion.

### Fixture audit

- `test-image.png` is a synthetic 100 by 100 colour-block fixture.
- `subject-photo.png` is untracked and synthetic.
- `flower.jpg` is a 29-byte HTML 404 response, not a JPEG.
- There is no licensed, tracked portrait/hair, product, pet/fur, vehicle, multi-subject, transparent, thin-detail, translucent, panorama, low-contrast, or compressed quality corpus.

## Existing Architecture

### Inference

- Engine facade: `packages/engine/src/backgroundRemoval/index.ts`
- Provider chain: worker ONNX, Tauri native, direct ONNX, optional cloud
- Browser worker/session pool: `worker.ts`, `workerPool.ts`
- Bundled small fallback: U2-Net Light
- Downloadable BiRefNet entries: desktop model manifest
- IndexedDB model cache with resume and checksum support
- Optional feature-gated native ONNX path in `strata-bgremove`

### Document and rendering

- Generated state is an inline PNG data URL on `ShapeNode.backgroundRemoval`.
- Canvas propagation converts it to engine `alphaMask` and composites with `destination-in`.
- JSON save/reload, simple duplication, and ordinary history snapshots preserve the field.
- Existing general masks separately support clip/alpha/luminance, inversion, density, feather, linkage, and independent transforms on containers.

### UI and access paths

- Inspector: method, model download, status, cancel, apply/reapply, reset, show original, refine brush, hair refine, and trimap actions.
- Selection quick bar: Quick removal shortcut.
- Menubar: batch background removal.
- Export dialog: optional pre-export removal.
- Settings: offline model management.

The access paths do not share one complete command/commit service. They exercise different logic and error handling, so one route working does not prove another route works.

## Findings

| Severity | Finding | Impact |
|---|---|---|
| P0 | Final mask uses placed/preview dimensions, not natural source pixels | Export loses detail and cannot meet source-resolution alignment |
| P0 | Worker response routing has no request ID and reuses a still-running cancelled worker | A stale result can resolve and commit as a newer job |
| P0 | Worker transfer detaches the input buffer before later providers reuse it | Fallback providers may receive empty pixel data |
| P0 | Image and alpha mask use different fit/crop mapping | Masks drift under fit, fill, offsets, crop, and some exports |
| P0 | Refinement maps world coordinates directly to mask pixels | Rotation, scaling, flips, nested transforms, zoom, crop, pen, and touch are incorrect |
| P0 | Replacement retains the old mask | Unrelated replacement pixels can be masked by stale data |
| P0 | SVG and PDF paths omit or ignore the isolation mask | Exported output differs from canvas and can expose the background |
| P1 | Generated masks are a second mask system | Controls, copy, rendering, and future selections diverge |
| P1 | Stale checks validate selection only | Document/source/crop changes can accept obsolete results |
| P1 | Direct ONNX inference can run on the main thread | UI can freeze during load/inference |
| P1 | Trimap solver ignores source colour | The advertised matting behavior is misleading and low quality |
| P1 | “Decontaminate” erodes alpha only | It does not suppress foreground edge colour spill |
| P1 | Confidence is not calibrated and low confidence is not surfaced | Unsuitable images can produce misleading masks |
| P1 | Thumbnails ignore masks and cache keys omit mask revision | Layers panel does not represent the document result |
| P1 | Inline mask PNGs are unbounded and repeated through documents/history | Large or malicious documents can amplify memory use |
| P1 | E2E suite is fully red for the audited workflows | Current behavior cannot be released confidently |
| P2 | WebGL precedes WASM and WebGPU is not in production dispatch | Runtime choice is outdated and inconsistent with current ORT guidance |
| P2 | Native AI is excluded from default desktop builds | Desktop capability differs from the advertised architecture |
| P2 | Cloud provider remains in production dispatch | Offline/privacy positioning is less explicit than documentation claims |
| P2 | No calibrated quality corpus or visual-edge metrics | Model claims cannot be independently verified |

## Technical Quality Score

| Dimension | Score | Main reason |
|---|---:|---|
| Accessibility | 3/4 | Strong labels/status foundations; refinement modes and route consistency remain incomplete |
| Performance | 1/4 | Main-thread fallback, duplicate downscales, retained sessions, large models, and unbounded inline masks |
| Theming | 3/4 | Existing Inspector uses Strata components/tokens; dedicated overlays are missing |
| Responsive/input | 1/4 | Mouse identity-transform tests do not validate pen, touch, pressure, zoom, or nested transforms |
| Architecture/anti-patterns | 1/4 | Duplicate mask systems and duplicated access-path logic create systemic drift |
| **Total** | **9/20** | **Poor; architecture correction required before release** |

## Current Model and Runtime Assessment

| Candidate | Decision |
|---|---|
| U2-Net Light | Retain only as small offline fallback/baseline |
| BiRefNet Lite | Primary benchmark candidate; official model has 44.4M parameters and 1024 input, but packaged weight rights and conversion provenance require explicit review |
| BEN2 | High-quality challenger; likely too large for the default browser path |
| BRIA RMBG-2.0 | Exclude without commercial agreement; public weights are non-commercial |
| MODNet | Optional future portrait specialization, not a general solution |
| SAM/MobileSAM | Future promptable object selection; not alpha matting and not a first-release dependency |

For browsers, ONNX Runtime Web's current documentation supports an app-owned Worker with WebGPU when available and WASM as the broad fallback. WebGL is in maintenance mode. For Tauri, a native CPU provider is the dependable baseline on WebKitGTK/macOS webviews, with platform accelerators optional and CPU fallback mandatory.

## Required Architecture Decision

Extend the native `Mask` model with a source-pixel raster-alpha source and document-level immutable mask assets. All removal/refinement entry points must delegate to a single request and commit service. Rendering, tools, thumbnails, crop, replacement, persistence, and export must consume one canonical source-pixel placement transform.

The approved design is documented in `docs/superpowers/specs/2026-07-15-background-removal-subject-isolation-design.md`.

## Release Gate

Do not ship until:

- browser E2E passes for every access path;
- source-resolution and transformed alignment tests pass;
- cancellation and stale-result races are reproduced and fixed;
- masks survive save/reopen, copy, duplicate, crop, and replacement rules;
- thumbnails and PNG/WebP/SVG/PDF/package exports match canvas behavior;
- a licensed fixture corpus produces reviewed full mattes and edge crops;
- performance and peak-memory measurements exist for WebGPU, WASM, and native CPU;
- the mandatory repository regression and architecture-health gates pass.
