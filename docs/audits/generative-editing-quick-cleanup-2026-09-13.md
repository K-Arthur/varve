# Quick Cleanup provider audit — 2026-09-13

## Result

Quick Cleanup is now an explicit local provider contract rather than only a
quality label in the Content-Aware Fill dialog. Draft Fill and Remove requests
route through that provider and record `varve-quick-cleanup` in the persisted
edit provenance.

This provider is deliberately non-semantic. It uses the existing bounded
PatchMatch worker and source pixels only; it does not consume prompts, download
weights, or silently stand in for prompt-conditioned generation. Prompted Fill,
Replace, and prompted Expand remain gated by the qualified native diffusion
provider.

## Implementation evidence

- `packages/engine/src/contentAwareFill/quickCleanup.ts` exposes the
  `QUICK_CLEANUP_PROVIDER` descriptor and validates image, mask, origin, and
  empty-selection inputs before dispatch.
- `packages/engine/src/generativeEdit/pipeline.ts` routes draft Fill/Remove
  through `runQuickCleanup`, retains stale-source and cancellation checks, and
  reports the provider identity in the result.
- `packages/engine/src/contentAwareFill/patchMatch.ts` rejects source patches
  intersecting the user mask, including offset masks, so the cleanup cannot
  copy the marked object back into another hole.
- The result starts as an exact source clone and is composited only through the
  effective mask. Pixels outside that mask are byte-for-byte unchanged.

## Validation

Deterministic validation passed:

```text
pnpm exec vitest run \
  packages/engine/src/contentAwareFill/quickCleanup.test.ts \
  packages/engine/src/contentAwareFill/patchMatch.test.ts \
  packages/engine/src/contentAwareFill/contentAwareFill.test.ts \
  packages/engine/src/generativeEdit/generativeEdit.test.ts \
  packages/engine/src/generativeEdit/expandFallback.test.ts --maxWorkers=1
5 files, 52 tests passed
```

The real-photograph browser lane passed with actual pointer painting, Apply,
document inspection, and a screenshot captured from the result preview:

```text
VARVE_E2E_PORT=1954 VARVE_E2E_OUTPUT_DIR=/var/tmp/varve-generative-real-photo-quick-cleanup-2026-09-13c \
VARVE_DISABLE_HMR=1 VARVE_E2E_WORKERS=1 TMPDIR=/var/tmp/varve-quick-cleanup-e2e-tmp-c \
pnpm exec playwright test tests/e2e/caf/caf.spec.ts --project=chromium --workers=1 \
  --grep "applies promptless Fill to a real photograph with substantive output" --reporter=list
1 passed (44.7s)
```

The inspected artifact is
`test-results/var/tmp/varve-generative-real-photo-quick-cleanup-2026-09-13c/caf-caf-Content-Aware-Fill-6d709-aph-with-substantive-output-chromium/real-still-life-fill-result.png`.
It shows the real still-life photograph in the result preview and the Apply
state; no synthetic fixture was used for this lane.

The repository-wide affected planner selected 295 concurrent changes and
escalated to the full gate. `pnpm verify:affected` therefore stopped with its
documented full-gate instruction; that broad escalation is recorded separately
from this provider slice. The direct audits passed: `pnpm audit:docs`,
`pnpm audit:emoji`, and `pnpm audit:tokens` (153 pairs across three themes).

## Boundaries still outstanding

This audit does not qualify a semantic model. The current native diffusion
profile has no certified checksum, and the runtime qualification record remains
explicitly negative until a reviewed real-photograph Fill/Replace/Expand corpus
passes the fixed quality gates. Quick Cleanup is therefore the honest path for
small repairs on low-memory, browser, Chromebook, and ARM devices; it is not a
claim that arbitrary prompted content can be generated there.
