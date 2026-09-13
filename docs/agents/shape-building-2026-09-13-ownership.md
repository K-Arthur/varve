# Shape building ownership record

**Task:** shape-building repair, completion, and verification
**Coordinator:** opencode (shape-building session)
**Started:** 2026-09-13
**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve`
**Initial repository base:** `6a5fd8856` (commits continue on `master`)

## Scope

This record continues the shape-building capability audit at
`docs/audits/shape-building-capability-matrix-2026-09-13.md`:

- `packages/scene/src/shapeBuilder.degeneracy.test.ts` — the new degeneracy,
  fill-rule, and action-policy fixture suite (this task).
- `packages/editor/src/components/ShapeBuilderOverlay.tsx` and its new RTL test
  — the explicit stroke-outline recovery action (this task).
- `packages/editor/src/components/CanvasOverlays.tsx` — one prop wire-up for
  that action (no new imports; hub-file budgets unchanged).
- `tests/e2e/canvas/shape-builder.spec.ts` — browser workflow coverage,
  including the stroke recovery path (this task).
- Shape-building architecture/audit docs and the public Shape Builder guide and
  vector-tools feature page (this task).

## Shared-file coordination

| Surface | Owner / status | Coordination rule |
|---|---|---|
| `packages/scene/src/shapeBuilder.ts` | **Concurrent editor active** | Uncommitted placement/style-source edits (`primarySourceId`, `insertIndex`) appeared during this session. They are left untouched and are never staged or committed by this task. |
| `packages/scene/src/shapeBuilder.test.ts` | Shared feature tests | Read-only; this task adds a separate test file. |
| `packages/editor/src/tools/ShapeBuilderTool.ts` | Shared | Read-only; no changes made. |
| `CanvasArea.tsx`, `Shell.tsx`, `context.tsx` | Hub owners / untouched | No imports or responsibilities added. |
| Other agents' staged index entries | Leave alone | Every commit uses an explicit path list and `-o`; unrelated staged files are never restaged or reverted. |

## Verification policy

Scene geometry is verified by the independent oracle fixtures in
`shapeBuilder.degeneracy.test.ts`; editor behavior by RTL tests plus focused
tool tests; the end-to-end workflow by Playwright against the frozen commit in
a detached worktree (`/tmp/varve-sb-verify`) so concurrent agents' dev-server
HMR reloads during this session cannot invalidate the run. A failed Node Edit
step attributable to an unrelated full-page reload is recorded as such and
rerun, not hidden.

## Known remaining gap (recorded, not fixed here)

The product contract says Merge produces “one editable compound output”.
`applyShapeBuilderAction` currently emits one node per selected component for
Merge, which makes Merge and Extract indistinguishable for disconnected
selections. Fixing it requires editing the concurrently-owned
`shapeBuilder.ts`, so it is deliberately deferred with this evidence rather
than conflicting with the in-flight placement work.
