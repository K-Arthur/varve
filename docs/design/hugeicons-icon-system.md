# Varve icon system

Varve’s product UI uses a controlled semantic icon boundary. Feature code
should request a concept through `SemanticIcon`, `TablerIcon`, or the existing
`Icon`/`SolidIcon` wrappers instead of scattering glyph choices.

The current visual language for compact navigation and workspace controls is
Tabler’s rounded outline family: a clear 2px stroke, familiar silhouettes, and
enough weight to remain legible at 14–16px. Phosphor remains available for
surfaces that intentionally use filled icons, while Lucide remains the
fallback for semantic concepts that have not yet been mapped to Tabler.

## Discovery audit — 2026-08-13

- Production icon packages are `@tabler/icons-react` (preferred outline
  family), `lucide-react` (outline fallback), and `@phosphor-icons/react`
  (filled `SolidIcon`). They are exposed through `packages/ui/src/icons/`.
- `semantic.tsx` provides the right abstraction: semantic names, directional
  metadata, size tokens, and an accessible/decorative contract. Homepage and
  workspace concepts resolve to Tabler; the remaining outline concepts use
  Lucide until they receive an intentional Tabler mapping.
- The old system had duplicate outline/filled mappings, scattered direct glyph
  names, mixed optical weights, and a few weak tool metaphors. The most
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
  -> SemanticIcon / TablerIcon / TOOL_SEMANTIC_ICONS
  -> Tabler outline, Lucide fallback, or Phosphor filled definition
  -> currentColor SVG with an explicit visual weight
```

`Icon` and `SolidIcon` remain supported where a component consumes a broad
legacy icon-name contract or where a filled treatment is intentional. New
homepage and workspace UI should use Tabler through the semantic boundary.

Semantic size tokens remain `xs` 12px, `sm` 14px, `md` 16px, `lg` 20px, and
`xl` 24px. Interactive controls own the hit target; the icon glyph does not
need to be enlarged to make a button usable. All migrated icons inherit
`currentColor`, so theme, hover, selected, disabled, and destructive states
continue to come from the surrounding control.

## Significant mappings

| Varve concept | Current mapping | Reason |
| --- | --- | --- |
| Warp | Lucide `Spline` | Matches deformation more clearly than a generic grid. |
| Workspace modes | Tabler `LayoutDashboard`, `Brush`, `Photo`, `Printer`, `PlayerPlay`, `Code`, `Badge` | Gives every mode a distinct, recognizable metaphor at a heavier 2.25px stroke. |
| Search | Tabler `Search` | Consistent rounded outline language across home and editor. |
| Settings | Tabler `Settings` | Keeps the established gear metaphor with one stroke family. |

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

- The home review covers the default workflow, the workspace menu, settings
  tooltip, new-document dialog, and 420px reflow in both themes.
- The editor review captures the workspace switcher separately from the
  toolbar. It checks that all seven modes use distinct Tabler glyphs and that
  each rendered glyph carries the Tabler family marker.
- The toolbar remains on its established Lucide treatment; the Tabler change is
  intentionally scoped to the workspace switcher and homepage semantic icons.
- Screenshots must be inspected manually after each icon-family change. A
  passing DOM assertion alone is not a visual approval.
