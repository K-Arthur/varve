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

## Implemented checkpoints

- Added the semantic token layer and compatibility mappings in `@varve/ui`.
- Added component-owned cascade rules for controls, menus, popovers, dialogs,
  segmented controls, and toolbars.
- Normalized the editor floating toolbar, quick text bar, selection quick bar,
  and command/actions bar to the floating/control/surface hierarchy.
- Migrated the marketing site’s shared buttons, cards, feature surfaces,
  download surfaces, and representative page families to website aliases of
  the shared scale.
- Added a Storybook gallery for side-by-side light/dark geometry review.

The broad remaining editor declarations are compatibility-token consumers or
documented structural/pill exceptions; the next cleanup pass should inspect
the residual raw values listed by the final search rather than replace them
mechanically.

## Final cleanup and verification (2026-08-31)

The repository-wide migration was completed for active application and
marketing-site chrome. All callsites now use semantic tokens; the legacy
`--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`, and `--radius-2xl`
names remain only as compatibility aliases in the token definition. The
prototype phone frame has an explicit `--radius-device` token rather than an
unexplained generic `2xl` value.

The final source audit (`pnpm audit:radius`) reports:

| Pattern | Final count |
| --- | ---: |
| CSS `border-radius:` declarations | 1,124 |
| inline `borderRadius:` declarations | 61 |
| `rounded-*` utility occurrences | 0 |
| legacy radius consumers outside token definitions | 0 |
| intentional raw geometry exceptions | 6 |
| declarations by area | editor 865, website 186, ui 127, desktop 7 |

The six raw values are explicitly allowlisted and are not controls: four tiny
rotated website markers/cursor handles, the inspector histogram bar’s
top-only shape, and a page-navigation structural edge. Circles remain for
true circular geometry such as switch thumbs, slider thumbs, indicators, and
avatars; `--radius-pill` remains for badges, status chips, and switches.
Document/object corner radii, canvas selection geometry, and artwork remain
outside this UI-chrome audit.

The audit is now executable through `pnpm audit:radius`, so future additions
fail when they introduce a raw numeric radius or a legacy alias consumer.

## Validation evidence

- Shared UI focused tests: 21 tests passed across Button, Toolbar, and token
  coverage.
- Editor focused tests: 45 tests passed across floating toolbar, floating text
  bar, and selection quick bar coverage.
- `@varve/ui` and `@varve/website` typechecks passed.
- Website production build and GitHub Pages build passed for all 66 pages.
- Direct website Playwright geometry checks passed in light and dark themes;
  screenshots were inspected for the home and download surfaces.
- The navbar’s compact Download and Try CTAs use the same 8px control radius
  as every non-pill CTA; an exhaustive browser check passed across all 66
  generated website routes.
- Existing website visual checks passed for homepage light/dark and product
  showcase light. The download-dark full-page check hit its existing unstable
  screenshot-height stitching guard; the captured page was inspected and had
  coherent geometry, with no radius assertion failure.
- The editor workspace-toolbar visual run captured a passing desktop frame.
  Three additional cases were blocked by unrelated concurrent ToastProvider
  module/startup failures in the shared worktree, not by radius assertions.

## Roundness tuning (2026-09-01)

Following the completed migration, the shared semantic scale was increased
slightly across every migrated application and marketing-site surface:

| Token | Updated value |
| --- | ---: |
| `--radius-control-compact` | `6px` |
| `--radius-control` | `8px` |
| `--radius-floating` / `--radius-surface` | `14px` |
| `--radius-card` | `18px` |

`--radius-none`, `--radius-device`, and `--radius-pill` remain unchanged so
structural edges, device frames, and intentionally pill-shaped elements retain
their distinct geometry.
