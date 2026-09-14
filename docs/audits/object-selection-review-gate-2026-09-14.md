# Object Selection review gate — 2026-09-14

## Decision

The automatic `Select subject` workflow is review-first. A foreground estimate
does not mutate the document's pixel selection when inference completes. The
Inspector presents the returned candidates, clicking a candidate renders its
highlighted pixels for review, and `Use selected candidate` or `Apply as mask`
is required before the candidate is accepted by a downstream operation.

This is a correctness and interaction gate, not a claim that an automatic
foreground model understands the user's semantic intent. A photographic scene
can contain several valid foreground objects; prompted Object Selection remains
the appropriate path when the user needs one particular object.

## Implementation

- `SelectionSourcesPanel` no longer applies the top-ranked foreground proposal
  as a selection after `proposeSubjects` resolves.
- Candidate buttons set the review candidate and render its source-mapped
  coverage. They do not silently replace an existing selection.
- `Use selected candidate` performs the explicit source-mask-to-area-selection
  conversion. `Apply as mask` remains the explicit document mutation path.
- Source/document identity checks remain in force while the proposal is
  running, so a result for a replaced image is discarded.
- `object-selection-system.md` records the review and acceptance contract.

## Evidence

Commands run for this slice:

```text
./node_modules/.pnpm/@biomejs+biome@2.5.7/node_modules/@biomejs/biome/bin/biome check packages/editor/src/components/Inspector/SelectionSourcesPanel.tsx packages/editor/src/components/Inspector/SelectionSourcesPanel.subject.test.tsx tests/e2e/canvas/select-subject.spec.ts
timeout --signal=INT --kill-after=10s 240s ./node_modules/.bin/vitest run packages/editor/src/components/Inspector/SelectionSourcesPanel.subject.test.tsx --reporter=dot
VARVE_E2E_PORT=1622 VARVE_E2E_WORKERS=1 VARVE_HEAVY_TASK_PARALLELISM=0 ./node_modules/.bin/playwright test tests/e2e/canvas/select-subject.spec.ts --project=chromium --workers=1 --reporter=list
```

Results:

- Biome: passed, three files checked.
- Vitest: passed, 5 tests.
- Playwright: passed, 3 tests, including the real licensed still-life
  photograph, the bounded local-model fixture, and the uniform-image negative
  case.
- Visual review: inspected the real-photo and synthetic candidate screenshots;
  the real-photo candidate boundary follows the flower arrangement and its
  visible foreground objects, while the uniform image produces no proposal.

Artifacts from the real-photo run are retained under the ignored
`test-results/run-1922508-1622/` directory. This evidence validates the
review/acceptance interaction and one real photograph; it does not qualify
automatic foreground quality across the full corpus. The broader SAM2 and
MobileSAM quality gates remain separate and must continue to report their
category failures rather than being hidden by this interaction gate.
