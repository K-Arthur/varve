# Separator System

Varve separators are quiet structural signals, not general-purpose spacing.
The shared primitive lives in `@varve/ui` and is used for noninteractive rules
between interface groups. Existing surface borders, list row rules, canvas
affordances, and resize handles remain their own concepts.

## API

`Separator` supports `orientation` (`horizontal` or `vertical`),
`decorative`, `variant` (`solid`, `dashed`, or `fade`), and `tone` (`subtle`,
`default`, `strong`, or `accent`). `SeparatorWithContent` composes arbitrary
content at `start`, `center`, or `end` and is intentionally horizontal-only.
`AnimatedSeparator` is a separate, opt-in state/discovery treatment and has a
static fallback under reduced motion.

All visual values use separator semantic tokens. The primitive is pointer
transparent, has no focus target, and does not add a wrapper. Menu separators
retain menu ownership and presentation semantics. Resize handles retain their
interactive `role="separator"` and keyboard/pointer behavior.

## Audit Classification

The repository audit found the following relevant implementations:

| Surface | Classification | Decision |
| --- | --- | --- |
| UI menu and editor submenu rules | C, specialized library separator | Retained; shared recipe tokens |
| Inspector image/effect section rules | A, structural separator | Migrated to `Separator` |
| Panel and resource resize edges | D, interactive splitter | Excluded from migration |
| Panel borders, controls, color-picker cells | F, surface/item border | Remain container CSS |
| Canvas guides, selection, insertion, timeline affordances | E, editor affordance | Excluded |
| Codegen `<hr>` output | External output contract | Excluded from UI migration |

No general-purpose labeled or animated divider was previously duplicated in
application surfaces. The Storybook fixture is the visual stress surface for
the supported composition variants; production animation remains opt-in.

The remaining `border-top`/`border-bottom` rules are intentionally not a blind
migration target: the audit classified them as shell chrome, sticky headers,
virtualized rows, table/grid rules, state indicators, or surface boundaries.
Those recipes are more efficient at the container or row level than inserting
one DOM node per boundary.

Menubar separators are also retained as native `<hr>` elements because their
keyboard indexing and portal-owned menu behavior belong to the menubar. Their
visual recipe now uses the shared separator thickness and subtle color tokens.

## Remaining Work

- Complete representative desktop and browser screenshot capture once the
  Storybook iframe startup issue is resolved; review light, dark, high-contrast,
  narrow-width, RTL, and reduced-motion renders.
- Migrate any future true structural rules discovered in shell and panel audits;
  do not convert virtualized row borders, surface boundaries, canvas guides, or
  resize handles into primitive nodes.
- Add a production use of `SeparatorWithContent` only when a real labeled
  grouping needs it. The current gallery intentionally exercises the API
  without adding decorative density to the editor.
- Re-run the affected validation gate after the existing `ScrollArea.tsx`
  formatting failure and long-running package checks are resolved.
- Recheck bundle and style recalculation impact if animated separators are
  introduced into a frequently rendered surface.
