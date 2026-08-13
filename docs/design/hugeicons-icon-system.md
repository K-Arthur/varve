# Hugeicons icon system

Varve’s product UI now has a controlled Hugeicons migration at the semantic
icon boundary. Feature code should ask for a concept through `SemanticIcon`
(`Search`, `Workspace`, `Warp`, `Delete`) instead of importing a vendor glyph.
The canonical family is Hugeicons’ free Stroke Rounded pack, rendered through
`@hugeicons/react`; named imports keep the pack tree-shakeable. Lucide and
Phosphor remain dependencies for legacy/document-specific consumers until the
repository-wide audit proves they can be removed safely.

## Discovery audit — 2026-08-13

- Production icon packages were `lucide-react` (outline `Icon`) and
  `@phosphor-icons/react` (filled `SolidIcon`). Both were exposed through
  `packages/ui/src/icons/`; home and editor feature code mostly consumed those
  wrappers and the `TOOL_ICONS`/`SOLID_CHROME_ICONS` maps.
- `semantic.tsx` already provided the right abstraction: semantic names,
  directional metadata, size tokens, and an accessible/decorative contract.
  It was extended rather than replaced.
- The old system had duplicate outline/filled mappings, scattered direct
  glyph names, mixed optical weights, and a few weak tool metaphors. The most
  important example was Warp using a grid glyph even though its implementation
  edits envelope/mesh deformation.
- Tooltip and dialog primitives already portal and manage core keyboard
  behaviour. The home surface had useful tooltip coverage but several actions
  still used old icon paths and the workspace trigger exposed an arbitrary grid
  metaphor.
- Existing Playwright visual infrastructure includes workspace/canvas visual
  specs and 1×/2× replay snapshots. Home-specific screenshots were not a
  coherent matrix, so the icon work adds an isolated home/editor visual review
  run rather than creating a second test framework.

## Architecture

```text
feature
  -> SemanticIcon / TOOL_SEMANTIC_ICONS
  -> Hugeicons Stroke Rounded definition
  -> HugeiconsIcon (currentColor, 1.5px default stroke)
```

`Icon` and `SolidIcon` remain supported for unmigrated surfaces. This is
intentional: removing either package before all legitimate consumers migrate
would turn an icon refresh into an unrelated compatibility change.

Semantic size tokens remain `xs` 12px, `sm` 14px, `md` 16px, `lg` 20px, and
`xl` 24px. Interactive controls own the hit target; the icon glyph does not
need to be enlarged to make a button usable. All migrated icons inherit
`currentColor`, so theme, hover, selected, disabled, and destructive states
continue to come from the surrounding control.

## Significant mappings

| Varve concept | Previous source | Hugeicons replacement | Reason |
| --- | --- | --- | --- |
| Warp | Lucide `Grid3x3` / Phosphor `GridFour` | `BendToolIcon` | Matches envelope/mesh deformation and remains distinguishable from transform/scale at toolbar size. |
| Workspace | Phosphor `SquaresFour` | `Layout01Icon` | Communicates a working surface/layout instead of an arbitrary app-grid metaphor. |
| Select | Lucide `MousePointer2` / Phosphor `Cursor` | `Mouse02Icon` | Rounded pointer/mouse silhouette is clearer beside shape tools. |
| Frame | Lucide `Frame` / Phosphor `FrameCorners` | `FramerIcon` | Keeps frame differentiated from a plain rectangle. |
| Boolean union | Lucide `Combine` | `PathfinderUniteIcon` | Uses the familiar pathfinder metaphor for a geometry operation. |
| Boolean intersect | Lucide `Combine` | `PathfinderIntersectIcon` | Distinguishes intersection from union. |
| Boolean exclude | Lucide `Diff` | `PathfinderExcludeIcon` | Communicates pathfinder exclusion rather than a generic difference. |
| Filter | Lucide `ListFilter` / Phosphor `Funnel` | `FilterHorizontalIcon` | Better balance in compact home toolbar controls. |
| Search | Lucide `Search` / Phosphor `MagnifyingGlass` | `Search01Icon` | Consistent Stroke Rounded language across home and editor. |
| Settings | Lucide `Settings` / Phosphor `Gear` | `Settings01Icon` | Maintains the established gear metaphor with one stroke family. |

## Migration exceptions

Direct `Icon`/`SolidIcon` usage remains where a component consumes a broad
legacy icon-name contract (for example, document icon assets and some package
browser surfaces). These are tracked by the existing icon maps and are not
being removed based on naming alone. New UI work should use the semantic layer;
future migrations should be made when the owning component can switch without
changing its command or data contract.

## Visual QA record

The implementation requires a screenshot pass covering home default/empty and
responsive states, the open workspace switcher, the editor tool surface, and
representative dialogs in light and dark themes. Warp remains covered by the
existing `tests/e2e/canvas/warp-visual.spec.ts`, which exercises the actual
selection-to-cage workflow rather than assuming the control is present on an
empty canvas. The iconography matrix adds the home/editor states without
creating a second snapshot baseline.

### Review record — 2026-08-13

- The isolated light-theme home run passed the default workflow and 420px
  reflow. Direct inspection showed the empty-state hierarchy, New action,
  settings tooltip, dialog scrim/focus treatment, and narrow toolbar remain
  legible and unclipped.
- The workspace assertion now checks `aria-expanded="true"` and captures the
  popover element itself. This matters because the first page-level capture
  did not make the transient menu visually obvious even though the locator was
  present; the element capture is the review artifact for that state.
- The dark-theme/editor rerun was attempted but the shared workspace was under
  a cold Vite rebuild and concurrent validation jobs, leaving the browser on
  the startup splash. It is not counted as a pass and must be rerun in a quiet
  environment before release. No visual baseline was updated from that run.
- The editor workspace-mode selector now uses seven distinct Hugeicons
  concepts (`Layout`, `Printer`, `Brush`, `Image`, `Play`, `Code`, `Pen`). The
  toolbar is a separate surface and remains on its previous Lucide outline
  family.
- The visual matrix now captures the editor workspace switcher as its own
  artifact in both themes, separate from the toolbar review.
