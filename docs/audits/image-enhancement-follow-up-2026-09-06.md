# Image enhancement follow-up — 2026-09-06

This follow-up records the live failures and model-backed checks completed
after the 2026-08-22 implementation audit.

## Findings and repairs

- The Enhance dialog could enable Denoise during the asynchronous model
  availability probe. Clicking immediately started a preview/apply that failed
  with “model not downloaded” and left the dialog open. Apply and previews now
  wait for the probe; a missing SCUNet model presents the download action.
- The standalone Real-ESRGAN worker configured its WASM asset path but not the
  single-threaded worker runtime policy. Chromium/headless could leave session
  creation pending indefinitely. It now shares `configureOrtRuntime()` with
  the generic inference worker.
- `Denoise → None` is now preserved through the editor context and planner. It
  skips SCUNet and is disabled as “No change to apply”; it does not require a
  model download.
- Auto mode now presents a qualitative signal label. Its internal score remains
  explicitly uncalibrated and is not shown as a probability.

## Live evidence

- Bundled Real-ESRGAN: Chromium E2E passed through model discovery, worker
  inference, generated AI preview pixels, and final layer insertion.
- SCUNet: the exact manifest graph (3.8 MB) and external sidecar (73.1 MB)
  were installed into an isolated browser IndexedDB store. Chromium E2E
  reported both assets available, ran the worker path, and inserted the
  denoised layer.
- Missing-model behavior: Chromium E2E passed with SCUNet absent; Apply stayed
  disabled and Download model remained available.

JPEG artifact removal remains intentionally unavailable, and the anime model
quality corpus remains a separate pending gate. These checks validate runtime
execution and workflow semantics, not universal visual quality across every
image class.
