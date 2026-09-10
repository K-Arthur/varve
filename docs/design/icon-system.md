# Varve icon system

Varve’s product UI uses a controlled semantic icon boundary. Feature code
should request a concept through `SemanticIcon`, `TablerIcon`, or the existing
`Icon`/`SolidIcon` wrappers instead of scattering glyph choices.

The current visual language for compact navigation and workspace controls is
Tabler’s rounded outline family: a clear 2px stroke, familiar silhouettes, and
enough weight to remain legible at 14–16px. Phosphor remains available for
surfaces that intentionally use filled icons, while Lucide remains the
fallback for semantic concepts that have not yet been mapped to Tabler.

## Production packages

- `@tabler/icons-react` is the preferred outline family for homepage and
  workspace concepts.
- `lucide-react` remains the outline fallback for unmigrated semantic
  concepts and the established editor toolbar.
- `@phosphor-icons/react` provides the intentional filled `SolidIcon` family.

All three are exposed through `packages/ui/src/icons/`; feature code should
consume those wrappers and semantic maps rather than importing package glyphs
directly.

## Architecture

```text
feature
  -> SemanticIcon / TablerIcon / TOOL_SEMANTIC_ICONS
  -> Tabler outline, Lucide fallback, or Phosphor filled definition
  -> currentColor SVG with an explicit visual weight
```

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
legacy icon-name contract or where a filled treatment is intentional. New
homepage and workspace UI should use Tabler through the semantic boundary.

## Visual QA record — 2026-08-13

The iconography visual matrix covers home default/empty and responsive states,
the open workspace switcher, the editor tool surface, and representative
dialogs in light and dark themes. The editor review captures the workspace
switcher separately from the toolbar and checks that all seven modes use
distinct Tabler glyphs with the expected family marker.

The toolbar remains on its established Lucide treatment; the Tabler change is
intentionally scoped to the workspace switcher and homepage semantic icons.
Screenshots are manually inspected after each icon-family change. A passing
DOM assertion alone is not visual approval.
