# Separator system review — ownership (2026-09-15, session F)

**Task (user directive):** "focus on all the app's separators, reviewing all
its sections and components" — finish the app-wide separator review started in
`docs/architecture/separator-system.md` (commit `16c28997d`), cover both
applications (`apps/desktop`, `apps/website`), fix real defects, validate with
rendered evidence, and update docs/website copy.

**Branch/worktree:** `master` / `/home/kevina/CodingProjects/varve` (per the
task instruction; no branch or worktree created).
**Base HEAD at start:** `474be04a7` (observed moving during the session — other
sessions committed `5169db71d` while this session was in discovery; every
commit from this session re-checks ownership and stages only its own paths).

## Interpretation of the directive (recorded, not hidden)

"All the app's separators" is read as the separator/divider system across every
application section and component: structural group rules, menu separators,
section boundaries, list/table row rules, and interactive splitters. The
audit inventories in `docs/audits/separator-system-review-2026-09-15.md` cover
every divider-like declaration in `packages/editor/src` and
`apps/website/src`, so the "review all sections and components" half of the
directive is satisfied even where a divider is intentionally retained.

## Owned paths (this session edits)

| Path | Planned change |
|---|---|
| `packages/ui/src/components/Separator.tsx` / `.css` / `.test.tsx` / `.stories.tsx` | Forced-colors survivability for every variant; tests |
| `packages/ui/src/tokens/color.ts` (+ regenerated `tokens.css`) | `--color-separator-*` in the forced-colors block |
| `packages/ui/src/components/components.css` | `.varve-menu__sep` forced-colors survivability |
| `packages/editor/src/editor.css` | Menubar/dock/settings divider recipes: forced-colors; verified doubled-seam removals |
| `packages/editor/src/components/Inspector/sections/MockupsSection.css` | Invalid `1px solid var(--border-micro)` separators (painted nothing) |
| `packages/editor/src/components/Inspector/sections/PreflightWarnings.tsx` | Same invalid inline separator declarations |
| `packages/editor/src/components/FindReplace/FindReplaceBar.css` | Vertical separator width token misuse |
| `packages/editor/src/components/TimelinePanel/TimelinePanel.css` | Divergent duplicate recipes (only where cascade-verified) |
| `apps/website/src/styles/*`, `apps/website/src/pages/index.astro`, `apps/website/src/components/ProductShowcase.astro`, affected page styles | Doubled section seam, dead `--divider` token, token bypasses |
| `tests/e2e/theme/separators.spec.ts` (new) | Real-world + forced-colors regression coverage |
| `docs/audits/separator-system-review-2026-09-15.md`, `docs/architecture/separator-system.md`, `docs/screenshots/2026-09-15-separators/**` | Audit, contract, rendered evidence |

## Not touched (other writers, active or recently active)

- `packages/editor/src/components/LayersPanel/**` — session closed, but its
  uncommitted neighbours own the tree rows; separator review only.
- `packages/editor/src/menu/**`, `Menubar.tsx` — another session's in-flight
  clipboard menu entries (+450 snapshot lines). Menu *recipes* are audited;
  only shared CSS recipes (`editor.css`, `components.css`) are edited.
- `packages/editor/src/components/FloatingToolbar/**`,
  `FloatingTextBar/**`, `ContextControlBar/**`, `StatusBar.tsx`,
  `SelectionQuickBar/**` — toolbar follow-up session B was running E2E at
  task start; their vertical separator recipes are documented as remaining
  work instead of edited.
- `context.tsx`, `CanvasArea.tsx`, `Shell.tsx` — hub files, other writers.

## Commits

Progressive, docs-first, one commit per coherent slice; staged paths are always
a subset of the table above. Other sessions' uncommitted work is never staged,
reverted, or reformatted.

| Commit | Slice |
|---|---|
| `05c1e8c65` | Audit of every divider in both apps + forced-colors contract |
| `fa39f8f18` | Forced-colors visibility for all separator recipes + spec + reviewed captures |
| `a0549d9ad` | Border-token shorthand repairs (15 dead declarations) + static guard |
| `08e1ace1a` | Homepage single section boundary + `section-rules.spec.ts` + reviewed baselines |

## Status: complete (2026-09-15 session F)

Delivered: the app-wide separator audit (`docs/audits/separator-system-review-2026-09-15.md`),
forced-colors survivability for every separator recipe in both apps,
15 border declarations that painted nothing, a homepage doubled seam, a
regression guard for shorthand-token nesting, and two new Playwright specs
with reviewed screenshots. Deferred items (editor doubled seams, website
mock-artwork palette, `--divider` removal, `tokens.css`/generator drift,
vertical-recipe unification) are recorded with exact file:line evidence and
the blocker for each.

Not staged or modified, though it needs entries for these fixes: `CHANGELOG.md`
holds another session's uncommitted isometric release notes (36 insertions),
so a changelog entry for this session must wait for that work to land.
