# Illustration perspective-guide ownership — 2026-09-29

Owner: primary integration agent for the illustration/concept-art request.
Branch: `master` (user-requested).

## Scope

Add a bounded, view-only two-point perspective construction overlay through the
existing ruler-guide context menu. The vanishing points are session state and
the overlay is excluded from artwork sampling, document pixels, and exports.
Dragging its two handles positions the perspective in world space; the
four-corner image perspective remains the existing destructive-to-view but
non-destructive-to-source image-fill transform and is not reused for this
guide.

## Owned files

- `packages/editor/src/components/GuideOverlay/GuideOverlay.tsx` — show/hide
  action and placement of the session overlay inside the existing guide layer.
- `packages/editor/src/components/GuideOverlay/GuideContextMenu.tsx` and its
  focused tests — accessible context-menu entry.
- New `PerspectiveGuideOverlay.tsx` and focused component tests — bounded
  perspective line geometry, world-space handles, and camera-aware placement.
- New `tests/e2e/paint/two-point-perspective-guide.spec.ts` — real editor
  interaction, drag/visibility, view-only behavior, and inspected captures.
- `docs/architecture/guide-system.md`, the illustration capability matrix,
  and `CHANGELOG.md` — verified behavior and explicit view-only limits.

## Shared-file boundaries

`CanvasArea.tsx`, `CanvasOverlays.tsx`, `context.tsx`, scene document types,
image-fill perspective code, and export/sampling modules currently have other
uncommitted owners. This slice does not edit them. The overlay is integrated
inside `GuideOverlay`, which is already mounted by the existing canvas overlay
host. It changes no persisted document schema or renderer pipeline.
