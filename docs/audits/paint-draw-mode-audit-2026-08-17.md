# Paint and Draw Mode Audit

Date: 2026-08-17

## Initial Diagnosis

Varve already had normal `paint`, `eraser`, `smudge`, and `pencil` tools, a
sparse raster tile model, brush preset data, input normalization, predicted
event scaffolding, and a brush worker. The main problem was integration rather
than a missing brush engine. Several declared capabilities were disconnected
or incorrect at their document/tool boundary.

### Highest-risk findings

- Raster tiles were stored as a runtime `Map`, but canonical JSON serialization
  did not call the existing tile serializer. Saved painting could become an
  empty object or fail during rendering after reload.
- Coalesced input omitted the primary event, so the latest confirmed sample
  could be absent from a move batch.
- The eraser used a square constant-alpha region rather than the active brush
  mask.
- Paint and smudge searched only shallow page children and did not reject
  locked or hidden layers.
- Raster samples were passed as world coordinates even for transformed layers.
- Pencil did not check pointer identity and could omit the final pointer-up
  segment.
- Zero spacing could prevent the dab loop from advancing.
- Nonlinear dynamics evaluated y using the sampled x value rather than solving
  for the Bezier parameter.
- The worker existed but was not part of ordinary production painting. Its
  same-stroke request replacement could lose batches if enabled.
- Wet paint and grain state existed without a complete production consumer.

## Architecture Decision

Use both concepts without introducing a competing engine:

- a Draw workspace can make raster/vector drawing controls prominent;
- paint, eraser, smudge, and pencil remain ordinary tools;
- all tools operate on the same document, history, layers, transforms, and
  renderer;
- raster and vector processing branch only after shared input normalization.

## Work Completed In This Milestone

- Wired raster tile encoding/decoding through the canonical document codec.
- Added defensive tile-size/version validation and codec warnings.
- Retained the primary pointer sample after coalesced samples.
- Passed normalized source events from the canvas input pipeline to tools.
- Fixed nonlinear dynamics curve inversion and made stroke progress real.
- Implemented size, opacity, and rotation jitter using the stroke RNG.
- Clamped persisted and runtime spacing to a positive value.
- Moved erasing into the scene brush compositor so the active tip mask is
  shared with painting.
- Added selected/visible/unlocked/active-page raster target resolution.
- Added page/frame-aware layer creation and inverse world-to-local mapping.
- Fixed Pencil pointer identity and final confirmed sample handling.
- Prevented a second touch contact from cancelling an unrelated active stylus
  stroke.
- Stopped the brush worker host from silently deleting pending same-stroke
  requests and made cancellation reject all requests for the cancelled stroke.
- Made the existing tool-options popover open when a drawing tool activates so
  the active raster/vector target and relevant controls are immediately visible.
- Reworked smudge compositing to read an immutable source neighborhood and
  write across tile boundaries without directional seams or source mutation.
- Kept worker-generated dab batches inside the stroke transaction, deferring
  commit until all confirmed batches settle and invalidating late responses on
  cancellation.
- Connected the existing grain sampler to textured brush dabs and added a
  built-in deterministic procedural Textured preset.

## Deferred, Not Falsely Completed

- Wet-paint state, sparse drying scheduler, save/reopen policy, and visible
  wet controls.
- External grain resource resolution, document asset management, and advanced
  grain anchoring controls.
- Runtime profiling and bounded latest-work backpressure for enabling the worker
  on ordinary strokes.
- Full pressure-to-vector-width rendering parity.
- Brush browser/editor lifecycle, import/export format, favorites, and advanced
  dynamics UI.
- Selection coverage, mask-target painting, alpha-lock target UX, symmetry
  parity, clone/heal, and quick-shape workflows.

These remain follow-up milestones because exposing them as finished would make
the UI promise behavior the renderer does not yet provide.

## Validation Record

Targeted tests run during this milestone:

```text
pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/__tests__/inputNormalizer.test.ts packages/scene/src/__tests__/brush.test.ts packages/editor/src/tools/__tests__/PaintTool.test.ts packages/editor/src/tools/__tests__/PencilTool.test.ts
```

Result: 5 files passed, 124 tests passed.

Follow-up milestone validation:

```text
pnpm exec vitest run packages/scene/src/__tests__/brush.test.ts packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/__tests__/PaintTool.test.ts packages/editor/src/components/Inspector/sections/BrushSection.test.tsx
pnpm exec vitest run packages/scene/src/__tests__/rasterLayer.test.ts packages/editor/src/tools/__tests__/PaintTool.test.ts
```

Result: 86 tests passed in the first command and 49 tests passed in the
worker/smudge regression command. Browser validation in this session ran with
isolated output directories. The first combined run passed 6 tests, including
paint-layer creation, brush-size controls, and all four Draw workspace focus
tests; its remaining paint tests stopped at the stale native-select preset
assertion. After updating that assertion for Varve's custom combobox, retries
were blocked by onboarding/browser-context contention, and the final isolated
run failed during dev-server warm-up before tests began. The inspected failure
screenshots showed the brush options popover and the portaled Select boundary;
no new grain screenshot is claimed because the final run did not reach it.

Additional checks:

- `pnpm --filter @varve/scene typecheck` passed.
- `pnpm --filter @varve/editor typecheck` was attempted; it reports existing
  unrelated workspace errors in layout/codegen, settings/onboarding, and
  pre-existing editor files. No new type error was reported in the changed
  paint files before those failures.
- Biome formatting/lint checks passed for the changed source files after
  formatting.
- Playwright visual validation is a required next step for this milestone and
  is recorded only after screenshots are captured and inspected.
