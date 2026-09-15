# Generative editing portability acceptance — 2026-09-14

## Result

The browser Quick Cleanup path passed a real-photograph portability workflow.
This is evidence for the promptless local reconstruction provider, not a
semantic-model qualification. Prompt-conditioned Fill, Replace, and Expand
remain gated by the negative model qualification recorded in the
[runtime qualification audit](generative-editing-runtime-qualification-2026-09-12.md).

## Frozen input and provider

- Photograph: `tests/e2e/fixtures/real-life-landscape.jpg`, documented in
  [`tests/e2e/fixtures/PROVENANCE.md`](../../tests/e2e/fixtures/PROVENANCE.md).
- Interaction: real Chromium pointer drag on the CAF mask canvas, followed by
  promptless Remove & Fill and Apply.
- Provider: `varve-quick-cleanup` using the bounded PatchMatch path; no network
  request or model download was used.
- Output: the existing image layer was updated in place and retained its
  source snapshot, user/inference/composite masks, candidate asset, geometry,
  and edit provenance.

## Browser acceptance

Command:

```text
TMPDIR=/tmp/varve-generative-e2e-20260914 \
VARVE_DISABLE_HMR=1 VARVE_E2E_PORT=19339 \
VARVE_E2E_OUTPUT_DIR=generative-portability-2026-09-14-r3 \
./node_modules/.bin/playwright test \
tests/e2e/caf/generative-portability.spec.ts \
--project=chromium --reporter=list
```

Result: `1 passed` in `1.0m`.

The test asserted the following through the live document and user-facing
controls:

1. Apply records the provider and accepted variation and embeds the source,
   masks, and candidate assets.
2. Save and reopen retain the accepted recipe, source snapshot, all mask
   assets, and candidate asset.
3. Copy and paste create an independent generative edit record with remapped
   source, mask, and candidate references.
4. Export → PNG produces a real PNG download from the accepted composition.
5. Inspector → Restore Original returns the original source asset.
6. Undo restores the accepted edit and redo restores the original state.

## Visual review

The following Chromium captures were inspected at the generated output path.
They are test-owned local artifacts and are intentionally not portable-document
or repository assets:

- `test-results/generative-portability-2026-09-14-r3/caf-generative-portability-8a082-en-and-clipboard-copy-paste-chromium/real-photo-before-save.png`
- `test-results/generative-portability-2026-09-14-r3/caf-generative-portability-8a082-en-and-clipboard-copy-paste-chromium/real-photo-after-reopen.png`
- `test-results/generative-portability-2026-09-14-r3/caf-generative-portability-8a082-en-and-clipboard-copy-paste-chromium/real-photo-exported.png`
- `test-results/generative-portability-2026-09-14-r3/caf-generative-portability-8a082-en-and-clipboard-copy-paste-chromium/real-photo-restored.png`
- `test-results/generative-portability-2026-09-14-r3/caf-generative-portability-8a082-en-and-clipboard-copy-paste-chromium/real-photo-restored-undone.png`

The inspected frames show the real landscape rather than a synthetic fixture,
the accepted image in the normal canvas, the PNG Export panel, and the
Restore Original/history states in the Photo workspace. The output directory
is test-owned and ignored; it is retained locally for review and is not a
portable document dependency.

## Scope boundary

This slice does not establish the remaining release gates: a qualifying
prompt-conditioned model, the 24-photo/32-task three-seed corpus, Windows or
macOS package qualification, ARM/Chromebook native qualification, constrained
4-GB measurements, or the final full validation checkpoint. Those remain
explicitly open in the capability matrix and architecture contract.
