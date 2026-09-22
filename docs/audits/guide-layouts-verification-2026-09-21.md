# Guide layouts verification — 2026-09-21

## Scope

This audit supersedes the layout-guide portions of
[`grid-system-audit-2026-09-09.md`](grid-system-audit-2026-09-09.md). It
verifies the v2.30 frame/page/master guide-layout contract, lifecycle identity,
transformed snapping, Figma import, and the public workflow documentation.

## Research-informed findings

| Observed industry failure | Practical Varve response |
| --- | --- |
| Guides disappear when a page, master, or canvas scope changes | The dialog snapshots a target and the resolver exposes an explicit source; the overlay scopes to the active surface. |
| A single gutter is reused for rows and columns | Page settings store independent row and column gutters; frame layouts are axis-specific. |
| Rotated frames stop activating or snapping | Geometry resolves finite local segments, then composes the full owner transform; movement uses one 2-D correction. |
| Duplicate/copy/paste or master duplication loses guides | Clone and clipboard paths remap owner and guide ids; removal prunes orphaned entries. |
| Invalid fixed tracks silently stretch or overflow | Canonical resolution returns structured issues and refuses unusable geometry. |
| “Show” and “snap” are coupled | Visibility and snap enablement are independent, including hidden-but-snappable layouts. |

The comparison references the official [Figma layout-guide documentation](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-guides), [Photoshop guide workflow](https://www.adobe.com/learn/photoshop/web/align-objects-guides), [InDesign ruler-guide documentation](https://helpx.adobe.com/indesign/desktop/layout-and-grid-tools/rulers-and-measure-tools/create-ruler-guides.html), and [Sketch canvas documentation](https://www.sketch.com/docs/interface-and-settings/the-mac-app-interface/the-canvas/). Public complaint patterns were cross-checked against the [Figma rotated-guide report](https://forum.figma.com/report-a-problem-6/grid-doesn-t-activate-if-i-turn-the-frame-90-degrees-53107) and [Affinity independent-gutter request](https://forum.affinity.serif.com/index.php?/topic/180957-independent-gutter-sizes-for-rows-and-column-guides/).

## Evidence

- `pnpm exec vitest run packages/scene/src/layoutGuideGeometry.test.ts packages/scene/src/pageLayout.test.ts packages/scene/src/layoutGuideLifecycle.test.ts` — migration, bounded geometry, rows/columns, inheritance, clone and prune.
- `pnpm exec vitest run packages/editor/src/tools/__tests__/snapping.test.ts packages/editor/src/components/PageLayoutOverlay.test.tsx packages/import/src/figma.test.ts packages/editor/src/clipboard.test.ts` — transformed segments, page overlay, Figma entries, and clipboard v3.
- `node_modules/.bin/tsc -p packages/editor/tsconfig.json --noEmit`, `.../scene/...`, and `.../import/...` — affected package type contracts.
- Browser/visual runs are kept through the heavy-task lease and are listed in the final Agent Validation Report. A shared-worktree Vite overlay is recorded if unrelated unresolved imports prevent editor startup; such a run is not claimed as passing evidence.

## Honest remaining limits

There are no linked/cloud layout styles, arbitrary-angle authored grid
patterns, unequal per-track sizing, or conversion of layouts into ruler guides.
Page placement is translational, so page-layout segments do not promise a
rotated publishing page. Large documents use owner-scoped candidate generation;
full-document layout resolution is intentionally not performed per pointer
sample.
