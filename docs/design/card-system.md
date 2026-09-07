# Varve card system

Status: beta implementation (2026-09-07)

This document records the repository audit and the small shared contract for
card-like surfaces. Cards are visual containers, not an automatic semantic
role. A surface remains a panel, list row, dialog, fieldset, or bento cell when
that is the stronger product model.

## Decision

The audit found the same visual contract in several React consumers: a
surface, optional media, title/description hierarchy, metadata, and optional
actions. A shared presentational primitive is therefore justified, but only
for geometry and slots. It does not own product data, selection algorithms,
drag sensors, thumbnails, file operations, or navigation.

`@varve/ui` now provides the beta `Card` composition:

- `Card` — `div`, `article`, `section`, or `li`; `surface`, `outline`,
  `subtle`, `interactive`, `selectable`, `media`, `status`, and `prominent`
  visual variants; compact or standard density; selected, disabled, and
  loading state data.
- `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardMedia`,
  `CardAction`, and `CardFooter` — optional structural slots.

The root does not accept `button` or `a`: navigation and activation use a real
link or button supplied by the product component. This prevents nested
interactive markup and keeps whole-surface activation separate from secondary
actions.

## Design rules

1. Use a card when a subject is a skimmable unit in a collection or a
   deliberately bounded content surface. Use a panel, section, fieldset,
   dialog, or list row when that structure is more honest.
2. Prefer `surface` for Home and website content, `outline` or `subtle` for
   low-emphasis groupings, `interactive` for navigation/activation surfaces,
   `selectable` for collection choices, `media` for preview-led content, and
   `status` for compact metrics. Reserve `prominent` for rare featured
   content.
3. The card owns its outer radius and border. Children do not become a set of
   nested rounded bubbles. Media is edge-to-edge when it is the visual lead;
   header/content/footer own their insets.
4. Use `--radius-card` for Home/start/marketing cards and compact control
   geometry for dense editor cards. State changes do not alter radius.
5. Use stable media aspect ratios, `Thumbnail` where the product has a
   thumbnail contract, meaningful alt text, lazy loading for noncritical
   images, and explicit loading/error/missing states.
6. Arrange card collections with tokenized gaps, `auto-fit`/`auto-fill`,
   `minmax(min(..., 100%), 1fr)`, `min-width: 0`, and stretch alignment where
   equal row rhythm is useful. Home's virtualized grid keeps its measured
   16px gap and 220px card footprint synchronized with the CSS token.
7. Never put an invisible link over independent controls. Stop propagation at
   the actual nested control boundary and give every action an accessible
   name.
8. Hover is restrained border/surface feedback. Spotlight, glow, 3D, flip,
   and entrance effects are opt-in treatments for rare marketing moments only;
   they are not part of `Card`.

## Audit inventory and migration map

The repository search covered JSX/TSX/Astro/CSS class names, card/tile/bento
terms, preview-led grids, and whole-surface handlers. The following table is
the actionable inventory; ordinary panels, rows, dialogs, overlays, and
inspector disclosure sections were reviewed and intentionally excluded.

| Surface | Context / taxonomy | Semantics and interaction | Variant / decision |
| --- | --- | --- | --- |
| `packages/home/src/FileCard.tsx` | Home file/project card | ARIA `gridcell`; roving focus, selection modifiers, rename, favorite, context menu, dedicated drag handle, double-click open | `selectable` recipe on stable virtualized footprint; migrate root only |
| `packages/home/src/FileList.tsx` | Home file/project list row | ARIA grid row; sort, selection, rename, pin, favorite, context menu | Not a card; preserve row geometry |
| `packages/home/src/TemplatesGallery.tsx` | Template/preset card | Real button; applies template; source/usage metadata | `interactive` recipe; preserve button semantics |
| `packages/home/src/AssetBrowser.tsx` | Asset card / folder choice | Asset card has nested Insert button; folder is a real button | `media` and `interactive` recipes; preserve asset search and import states |
| `packages/home/src/NewDesignDialog.tsx` | Form/task choice surface | Native `RadioGroup` card options, `PresetPicker` listbox | Not migrated to generic Card; existing `RadioGroup` owns choice semantics |
| `packages/ui/src/components/PresetPicker/PresetTile.tsx` | Preset selectable tile | Listbox option with favorite and overflow controls | Keep domain tile; align geometry with compact card tokens |
| `packages/editor/src/components/BackgroundRemoval/SubjectCard.tsx` | Selectable media card | Listbox option; keyboard toggle; nested preview-mode buttons | `selectable` recipe; preserve preview modes and thumbnail fallback |
| `packages/editor/src/components/Mockups/MockupsPanel.tsx` | Mockup media card | Article with Apply/Favorite actions | `media` recipe; preserve native SVG preview and action states |
| `packages/editor/src/components/BrushBrowser/BrushBrowser.tsx` | Brush selectable tile | Button selection with separate action lane | Keep domain tile; no whole-card drag or 3D treatment |
| `packages/editor/src/components/IconBrowser/IconGrid.tsx` | Icon selectable/drag tile | Grid item, keyboard selection, double-click insert, native drag | Keep virtualized/icon-specific tile; preserve fixed measurement |
| `packages/help/src/HelpBrowser.tsx` | Help navigation/content cards | Real buttons for categories, results, articles, related content | `interactive`/`outline` recipe; preserve dialog focus trap |
| `packages/editor/src/components/EffectStudio/*` | Effect/preset gallery and action regions | Domain-specific controls and previews | Keep specialized gallery; no generic card wrapper where it would add nesting |
| `packages/editor/src/components/AdjustmentLayer/*` | Adjustment/effect preset groups | Inspector controls and disclosure sections | Panel, not card; no migration |
| `packages/editor/src/components/Export/*` | Export results, preflight, destination previews | Dialog/list/status surfaces | Panel/list/status; no migration |
| `packages/editor/src/components/CodePanel/*` | Readiness/format metric surfaces | Informational metrics and code output | Status/panel; no generic wrapper |
| Website `feature-card`, `learn-card`, `docs-card` | Promotional/navigation cards | Semantic links or static content blocks | Site `site-card` recipe; preserve Astro static output |
| Website `tutorial-card`, `example-card` | Tutorial/content preview | Static content or real link | Site `site-card`, interactive only for links |
| Website `compare` / `tier-card` / `contribute-card` | Comparison, support, contribution | Static comparison/support content | Site recipe; featured states remain page-specific |
| Website `issue-card`, `audience-card`, `mode-card` | Status/product explanation | Article/static content | Site `site-card` subtle/status treatment |
| Website `transfer-card`, workflow/honesty surfaces | Form/task/content grouping | Semantic section/article | Site recipe only where bounded content is intentional |
| Website `bento-grid` / `BentoCard` | Marketing composition | Static grid cells | Keep bento layout; use site card surface tokens |
| Website hero cards and product screenshot windows | Decorative art / product proof | `aria-hidden` art or figure | Not generic cards; retain specialized art direction |

## Reference patterns

The reviewed references reinforced composable header/title/description/content/
action/footer regions, explicit media treatment, responsive grids, selected
and disabled states, and loading/empty stability. Varve adapts those ideas to
its own tokens and interaction contracts. Tailwind, Radix/Base UI, Motion,
third-party demo images, global pointer listeners, continuous tilt loops, and
generic “cardify everything” patterns were rejected.

## React / Astro boundary

The React primitive is not imported by Astro. `apps/website/src/styles/global.css`
owns a lightweight `site-card` recipe that maps to the same surface, border,
spacing, radius, focus, forced-colors, and reduced-motion tokens. Astro pages
remain statically rendered and links remain real links.

## Coverage

`Card.test.tsx` covers slot composition, class merging, semantic element
selection, and selected/disabled/loading state attributes. `Card.stories.tsx`
covers basic, selectable, compact status, disabled, loading, media, and
prominent-compatible compositions. Domain tests remain with their owners;
virtualized Home grids and thumbnail behavior are not replaced by the generic
primitive.
