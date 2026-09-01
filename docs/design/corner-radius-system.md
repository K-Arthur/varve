# Varve corner-radius system

Status: active design-system contract (2026-08-31)

Varve uses corner radius to express geometry and hierarchy, not as a universal
decoration. The editor is a dense professional tool, so controls stay compact
and precise. Larger radii belong to surfaces that float above the workspace or
to content cards; they do not leak into toolbar children.

## Semantic scale

The CSS custom properties below are the public radius API. Components own the
radius for their rendered surface; callers should not override it with a local
pixel value or a generic `rounded-*` utility.

| Token | Value | Owner / use |
| --- | ---: | --- |
| `--radius-none` | `0` | edge-connected panels, internal group boundaries, precision overlays |
| `--radius-control-compact` | `4px` | dense icon buttons, toolbar buttons, menu items, compact fields |
| `--radius-control` | `6px` | Button, Input, Select, ordinary interactive controls |
| `--radius-floating` | `12px` | floating/contextual toolbars and compact floating panels |
| `--radius-surface` | `12px` | dialogs, menus, popovers, raised editor surfaces |
| `--radius-card` | `16px` | home/start-screen and marketing content cards |
| `--radius-device` | `40px` | phone/device-frame shells in prototype previews |
| `--radius-pill` | `9999px` | badges, tags, switches, slider tracks/thumbs, true pills |

The existing `--radius-sm`, `--radius-md`, `--radius-lg`, and `--radius-xl`
names remain compatibility aliases for older package consumers. New UI code
uses the semantic names. `--radius-2xl` remains reserved for oversized
marketing art and is retained as a compatibility alias for
`--radius-device`; it is not an editor-control radius.

## Ownership rules

- `Button`, `IconButton`, `Input`, `Select`, and `SegmentedControl` own control
  geometry.
- `Popover`, `Dialog`, `Menu`, and floating toolbar shells own surface geometry.
- Connected groups own their outer radius. Children have square internal edges;
  first/last edges are structural, not individual bubbles.
- A child inside a clipped surface uses `--radius-none` or a derived inset
  radius only when it is a separate visible layer. Do not add `overflow: hidden`
  to conceal an accidental mismatch.
- Hover, focus, disabled, and selected states do not change radius.
- `rounded-full`/`--radius-pill` is intentional only for semantically circular
  or capsule-shaped UI. It is not the default icon-button shape.
- Canvas/document geometry, selection boxes, handles, guides, and artwork are
  outside this system.

## Group geometry

Horizontal and vertical connected controls use one outer shell. Internal
boundaries are square and the first/last visible members determine the outer
corners. Conditional groups must use structural selectors or explicit group
position data so a hidden member cannot leave a stale rounded edge.

For a visible nested surface, the inner radius should be derived from the outer
radius and inset (`max(0px, outer - inset)`) when concentric corners matter.

## Web and desktop

The website imports the same generated `@varve/ui/tokens.css` file as the
desktop renderer. Website-specific aliases map to the semantic scale, allowing
the marketing site to use larger `--radius-card` surfaces while sharing control,
floating, and pill geometry with the application. Radius is theme-independent;
contrast, border, shadow, and clipping must still be checked in light, dark,
high-contrast, and high-DPI rendering.

## Review checklist

When adding or changing a surface, inspect the rendered result and ask:

1. Does an equivalent component use the same token everywhere?
2. Is the outer surface visibly distinct from its controls without nested
   bubble shapes?
3. Are connected controls rounded only on their exposed outer edges?
4. Is a pill or circle semantically necessary?
5. Does the focus ring follow the control geometry without being clipped?
6. Does the result remain coherent in the light and dark themes and at 200%?

The dated audit records the migration inventory and the remaining justified
exceptions.
