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
- `Selection Sources` now exposes `Select specific object` beside the
  foreground-only `Select subject` command. It activates the canonical
  prompted tool and announces the include, exclude, box-hint, and review
  sequence so a foreground estimate is not the only visible route when a
  photograph contains multiple possible targets.

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

The specific-target entry was additionally checked on the licensed still-life
photograph with:

```text
TMPDIR=/home/kevina/varve-selection-validation-bXqjQq \
VARVE_E2E_PORT=1501 VARVE_E2E_WORKERS=1 \
VARVE_E2E_OUTPUT_DIR=selection-specific-entry-20260915-visual \
pnpm exec playwright test tests/e2e/canvas/select-subject.spec.ts \
  --project=chromium --grep "specific object" --reporter=list
```

The run passed (1 test, 31.7 s). The inspected capture is
`test-results/selection-specific-entry-20260915-visual/canvas-select-subject-Sele-edeff-object-on-a-real-photograph-chromium/specific-object-selection-entry.png`;
it shows the two distinct entry points, the target-selection guidance, and
the active Object Selection tool after activation.

## Placement-integrity follow-up — 2026-09-15

Automatic foreground proposals now retain the canonical source-pixel-to-world
mapping fingerprint used for their review overlay. A crop, image offset,
content rotation/flip, node transform, or ancestor transform change withdraws
the stale overlay and disables candidate acceptance until `Select subject` is
run again. This closes the gap where the source pixels were unchanged but the
reviewed mask would have been displayed against a new placement.

Focused checks:

```text
TMPDIR=/home/kevina/varve-selection-validation-bXqjQq pnpm exec vitest run packages/editor/src/components/Inspector/SelectionSourcesPanel.subject.test.tsx --reporter=dot
pnpm typecheck:e2e
```

Both passed. The focused Vitest file passed 9 tests, including the transform-
change regression; E2E typechecking passed.

The real SAM2 target gate was also run against the licensed
`real-life-still-life.jpg` photograph with a prompt inside the right-hand
apple. It passed with a 100% prompt-match report, and the inspected preview
and applied captures show the apple isolated from the sunflower, bouquet,
mug, and dark background. The occluded left edge is visibly imperfect, so the
result remains reviewable/refinable rather than being treated as pixel-perfect
evidence:

```text
TMPDIR=/home/kevina/varve-selection-validation-bXqjQq \
VARVE_SAM2_REAL_MODEL=1 \
VARVE_SAM2_PROFILE_DIR=/home/kevina/varve-sam2-selection-profile-apple-fresh-20260915 \
VARVE_E2E_PORT=1523 VARVE_E2E_WORKERS=1 \
VARVE_E2E_OUTPUT_DIR=selection-specific-target-20260915-apple-fresh \
pnpm exec playwright test tests/e2e/canvas/object-selection-real-model.spec.ts \
  --project=chromium --grep "prompted apple" --reporter=list
```

The run passed in 1.7 minutes. Captures are retained under the ignored
`test-results/selection-specific-target-20260915-apple-fresh/` directory.
This is evidence for prompted target selection and placement integrity; it is
not a claim that foreground estimation or every model/provider is semantically
correct on arbitrary photographs.
