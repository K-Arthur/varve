# Corner-radius system audit — 2026-08-31

## Scope

The repository-wide scan covered active source under `packages/*`,
`apps/desktop/src`, and `apps/website/src`, while excluding dependencies,
generated website output, model fixtures, and document/artwork geometry. The
scan searched for Tailwind `rounded-*` utilities, CSS `border-radius`, inline
`borderRadius`, radius custom properties, partial-corner declarations,
`overflow-hidden`, and `border-radius: inherit`.

Baseline counts from the active source scan:

| Pattern | Count |
| --- | ---: |
| CSS `border-radius:` declarations | 1,205 |
| inline `borderRadius:` declarations | 69 |
| `rounded-*` utility occurrences | 10 |
| raw CSS length radii | 175 |
| pill/circle forms (`50%`, `999*`, pill/full aliases) | 168 |
| radius declarations by area | editor 811, website 186, ui 99, home 77, desktop 7 |

These numbers are an audit baseline, not a target to reduce mechanically. Many
of the editor declarations are intentionally dense inspector controls, while
many website declarations are duplicated card and CTA recipes.

## Findings

### Shared UI

The shared primitives already centralize much of the control geometry, but they
use generic `sm`/`md`/`lg` names. Button and Select use `--radius-md`, Input
uses `--radius-sm`, Popover/Menu use `--radius-md`, and SegmentedControl rounds
the outer shell but does not explicitly own square child edges. This makes
equivalent controls appear different and invites callsite overrides.

### Editor

The main floating toolbar and quick text bar each define their own shell and
button radii. The floating tool palette uses a large surface radius while the
quick text bar uses the oversized `--radius-xl`; both need one floating token.
The inspector is intentionally dense, but contains a small number of raw
values and repeated nested control rules that should migrate incrementally.
The top bar, docked panels, canvas selection geometry, handles, and document
objects must retain their structural/square treatment where applicable.

### Website

The website uses shared aliases in some global rules, but pages and components
also contain `0.25rem` through `1rem`, `0.75rem`, `1rem`, `999px`, and `9999px`
directly. Content cards and decorative hero SVG geometry are legitimate larger
or artistic exceptions; buttons, header controls, status pills, and form
controls should use semantic aliases.

## Migration classification

- Expected shared-token usage: component primitives, editor controls, menus,
  popovers, dialogs, and website controls.
- Structural exceptions: group first/last edges, docked panel boundaries,
  table/edge-to-edge sections, selection geometry, and SVG artwork.
- Pill/circular exceptions: switches, badges/tags, slider tracks/thumbs,
  avatars, status pills, and deliberately circular decorative marks.
- Review exceptions: legacy raw values in broad editor CSS and website pages;
  these are migrated by surface family rather than by blind replacement.

## Acceptance evidence

The implementation is accepted only with targeted UI tests plus direct browser
inspection of representative light/dark surfaces: main/floating toolbars,
quick text editing, button and form controls, inspector, dialog, menu/popover,
home/start screen, and marketing cards. The final pass repeats the inventory
and records every remaining raw or pill value as expected, structural, semantic,
or justified exception.
