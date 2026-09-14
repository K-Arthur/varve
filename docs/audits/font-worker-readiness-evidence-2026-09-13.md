# Font worker readiness evidence — 2026-09-13

The render pipeline had two worker-admission branches. Dirty-region pruning
already waited for worker font adoption, but the later worker-render dispatch
could still pass its own readiness checks while a dynamic/project face was
pending or had failed adoption. That allowed a substituted worker bitmap to be
presented even though the main-thread path had the exact face.

The shared `workerHasFontsForDocument` predicate now gates both branches. It
returns false synchronously while the current face-set acknowledgement is
pending, when a used declared family is unavailable, or when the worker host is
missing. This preserves the existing family-scoped behavior for documents that
use only adopted families while preventing an asynchronous refusal after a
bitmap has already been chosen.

## Validation

```text
./node_modules/.bin/biome check --write packages/editor/src/render/workerFonts.ts packages/editor/src/render/workerFonts.test.ts packages/editor/src/canvas/renderPipeline.ts
CI=1 TMPDIR=/home/kevina/varve-tmp ./node_modules/.bin/vitest run --maxWorkers=1 packages/editor/src/render/workerFonts.test.ts packages/editor/src/render/workerHost.fonts.test.ts --reporter=dot
```

Results: Biome completed with no errors. The focused worker font suites passed
**23/23 tests**, including stale acknowledgement handling, failed-face
handling, and the new shared-predicate cases. This is a synchronous admission
regression check; it does not certify real WOFF2 decoding in a worker or the
main/worker pixel oracle. Those remain platform and fixture work in acceptance
scenarios 1 and 11.
