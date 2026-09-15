# Canvas-label isolation audit — 2026-09-08

Status: implementation record for the shared editor-surface scope repair.

## Proven root cause

The renderer already projected a Design Canvas through
`multipageNodeInstances(doc, { designCanvasId })`. The name-label overlay did
not consume that projection. It selected the active publishing page when one
existed and otherwise walked `doc.rootChildren`, which includes every
Design Canvas content root. In a mixed document this made label membership
depend on a legacy root heuristic rather than on the scene that was painted.

The same split existed in the accessibility tree, minimap, and export-region
overlay. A stale selection could also survive a surface change because the
document update and transient-state cleanup were owned by separate callers.

| Producer | Expected scope | Actual scope before repair | Failure mode | Affected consumers |
| --- | --- | --- | --- | --- |
| Main renderer | Active Design Canvas outside Print; all placed publishing pages in Print | `multipageNodeInstances` with a nullable/implicit canvas contract | Correct projection, but its contract was private to the renderer | Pixels, hit-test assumptions |
| `CanvasNameLabels` | Exact rendered occurrences | Active page children + globals, or all `rootChildren` | A/B canvas labels leaked; renderer and labels disagreed | Visible labels, rename affordance |
| `CanvasAccessibilityTree` | Same active occurrence set as visual canvas | `walkNodes(activePageNodes(doc))` | Screen readers could receive inactive-page names | Accessibility |
| Minimap | Same active canvas/publishing policy as the renderer | Rebuilt roots from `scope` and nullable canvas id | Geometry and names could follow another surface | Minimap |
| `ExportRegionOverlay` | Export regions in the current editable surface | `activePageNodes(doc)` | Design Canvas export-region overlays ignored the active canvas | Tool overlay |
| Surface transition | New scope plus compatible transient state in one observable update | Design Canvas panel cleared selection in a second call | Selection/edit state could point at the old surface | Selection, inspector, rename, tools |

## Shared contract

`resolveEditorSceneScope` in `@varve/scene` is the only current-surface
projection for editor-facing consumers. It uses a tagged base surface:

- `designCanvas:<id>` for the active Design Canvas in non-Print workspaces;
- `publishing:allPlacedPages` for Print (the active page is focus metadata,
  not a membership filter);
- `master:<id>` while editing a master source;
- `legacyFlatPasteboard` for pre-page documents with no Design Canvases.

It reuses `multipageNodeInstances`, preserves qualified master occurrence ids,
re-roots isolation for logical depth, applies effective visibility, excludes
metadata-owned content roots, and degrades invalid/cyclic data to a bounded
empty or explicitly allowed scope. Consumers must not recover by traversing
all document roots.

Labels remain derived editor UI. They are not scene nodes and are excluded
from export, serialization, clipboard artwork, thumbnails, and rendered
pixels. Publishing page bands remain a separate Print decoration policy.

## Verification fixture

The durable scene fixture in `packages/scene/src/editorSceneScope.test.ts`
contains two overlapping Design Canvas surfaces with distinct names and a
mixed publishing page. It proves A/B membership, stale-id fallback, Print
exclusion, isolation, and cycle-safe traversal. The editor E2E fixture adds
the same checks at the DOM/screenshot boundary.

## Follow-up boundaries

Collaboration cursors and comments currently remain UI scaffolding without a
transport-level surface key. They must adopt `surfaceKey` before remote
presence becomes persistent; local surface switching must filter their
rendering without deleting shared records.
