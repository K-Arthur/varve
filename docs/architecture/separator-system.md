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

## Forced colors and high contrast

Separators must remain visible when the operating system forces its own color
palette (Windows Contrast Themes and equivalents). In forced-colors mode the
user agent replaces background channels with the canvas color and reverts
background images, so:

- `tokens.css` remaps `--color-separator-subtle/-default/-strong` to
  `CanvasText` and `--color-separator-accent` to `Highlight` **for every app
  theme**, including `[data-theme="high-contrast"]` (whose author palette is
  otherwise preserved by the `:root:not([data-theme="high-contrast"])` block).
  Backgrounds drawn with system-color keywords are honored by the user agent,
  so every `background: var(--color-separator-*)` recipe survives.
- `Separator.css` redraws the gradient-based `fade` variant as a solid
  system-color border, because gradients are always reverted.
- `--color-border-subtle` / `--color-border-strong` are remapped the same way
  so rule recipes that still paint `background: var(--color-border-*)` (shell
  dividers, playback separators) do not disappear in the high-contrast theme.

Do not "fix" a vanished separator with `forced-color-adjust: none`; supply a
system color instead. Regression coverage:
`tests/e2e/theme/separators.spec.ts`; reviewed captures under
`docs/screenshots/2026-09-15-separators/`.

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

- ~~Complete representative desktop and browser screenshot capture~~ Done
  2026-09-15 through `tests/e2e/theme/separators.spec.ts` + reviewed captures
  under `docs/screenshots/2026-09-15-separators/` (light, dark, high-contrast,
  forced-colors; the Storybook iframe path remains unused).
- Migrate any future true structural rules discovered in shell and panel audits;
  do not convert virtualized row borders, surface boundaries, canvas guides, or
  resize handles into primitive nodes.
- Add a production use of `SeparatorWithContent` only when a real labeled
  grouping needs it. The current gallery intentionally exercises the API
  without adding decorative density to the editor.
- Unify the vertical group-rule recipes in the toolbar family.
  ~~Menubar half~~ Done 2026-09-15: `.editor-menubar__divider`,
  `.editor-menubar__zoom-divider` (both), and `.workspace-dock__divider` now
  share one recipe (`--separator-thickness` × `--space-4`,
  `--color-separator-subtle`, `margin: 0 var(--space-1)`); the zoom rules were
  literal `|` glyphs sized by their inherited font (5×22.1px vs 4×18.7px).
  Still open: `.insp-separator`, `.ccb__divider`,
  `.selection-quick-bar__separator`, `.floating-text-bar__separator`,
  `.crop-toolbar__separator`, and `FindReplaceBar.css`'s space-token width.
- ~~Reconcile `tokens.css` with `generate-token-css.ts` so `tokens:generate` is
  a no-op again~~ Done 2026-09-15: the generator now emits biome-format-stable
  output (wrapped font stacks, normalized numeric literals, indented
  media-query blocks, no trailing blank lines), `tokens:generate` is verified
  idempotent, and a token-name set diff confirmed no existing token was
  removed by the reconciliation.
- Re-run the affected validation gate after the existing `ScrollArea.tsx`
  formatting failure and long-running package checks are resolved.
- Recheck bundle and style recalculation impact if animated separators are
  introduced into a frequently rendered surface.
