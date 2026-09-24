# Retouch target ownership and sampling — ownership record

**Task:** `photo-retouch-target-sampling-2026-09-13`
**Started:** 2026-09-13
**Working tree:** `/home/kevina/CodingProjects/varve` (shared `master`; no worktree)
**Base HEAD at start:** `530fc67df`
**Audit/evidence:** `docs/audits/photo-retouch-target-sampling-2026-09-13.md`

## Why this record exists

`docs/plans/photo-raw-hdr-retouch-2026-09-13.md` (owner: photo/precision
integration) lists "expose/label sampling scope and report unsupported
source/target combinations" as planned work. This task implemented that
slice — with target-ownership refusals and no-op stroke suppression — while the
plan's owner was working later slices (RAW/HDR/precision). This record names
the exact interfaces so the plan owner can consume them instead of writing a
second implementation, and so neither task overwrites the other.

## Owned paths (single writer during this task)

| Path | Contract |
|---|---|
| `packages/editor/src/tools/retouchSampling.ts` | `SamplingScope`, `rasterSamplingLayersInPaintOrder`, `layersForSamplingScope`, `composeRetouchSample`, `buildRetouchSampleSource` |
| `packages/editor/src/tools/rasterTarget.ts` | `resolveRetouchTarget`, `retouchTargetFromDocument`, `sourcePointInLayerSpace` (existing exports preserved) |
| `packages/editor/src/tools/retouchOverlayState.ts` | Module-level external store for the clone/heal source marker and cursor |
| `packages/editor/src/tools/CloneStampTool.ts`, `HealingBrushTool.ts`, `SpotHealTool.ts`, `PatchTool.ts` | Retouch destination ownership, scope option, no-op transaction handling, overlay publishing, pointer-up tail stamping |
| `packages/editor/src/components/CanvasOverlays.tsx` | Mounts `PaintOverlay` for the retouch family (source marker + target/refusal badge) |
| `packages/editor/src/components/PaintOverlay/PaintOverlay.css` | Fixed the never-exercised overlay styles (missing `--color-accent` token, badge placement, blocked-state colors) |
| `packages/scene/src/retouchRaster.ts` | `compositeRetouchDab` no-op semantics (same-node return, no idle tile version bumps) |
| `packages/editor/src/components/FloatingToolbar/RetouchToolOptions.tsx` | Sampling scope select |
| `tests/e2e/canvas/retouch-tools.spec.ts` | Target-safety, sampling, and marker E2E |

`packages/editor/src/tools/SmudgeTool.ts` was touched only to move
`rasterSamplingLayersInPaintOrder` into the shared module and re-export it;
Smudge behavior is otherwise unchanged and its own sampling contract is
untouched.

## Interfaces the photo/RAW plan may depend on

- `SamplingScope = 'current' | 'below' | 'allVisible'` replaces the old
  `sampleAllLayers: boolean` on all four retouch tool option objects.
- Merged sampling is target-relative: `below` never samples content above the
  destination, so an adjustment layer above cannot be re-applied to a deposit.
- `resolveRetouchTarget(ctx)` returns `{kind:'raster', nodeId, label}` or
  `{kind:'none', reason}`. It refuses locked/hidden layers and selected
  non-raster objects; it never creates a layer.
- `buildRetouchSampleSource(ctx, target, scope)` returns
  `{tiles, truncated, contributors}` in the target's local pixel space.

## Not owned / follow-ups

- **Persisted sampling-scope preference** (raised in
  `docs/quality/photo-retouch-research-2026-09-13.md`): scope is stable for the
  tool instance/session but is not yet a saved setting. This belongs with the
  photo/precision owner's settings surface.
- **Image-filled-shape source adapter** for retouch sampling: image fills are
  shapes, not raster layers, and remain an explicit boundary; merged sampling
  covers raster layers only.
- **Float/precision retouch target**: byte tiles remain the SDR boundary the
  plan describes; no precision claim is made here.
