# Button-system consolidation — audit and evidence (2026-09-19)

Scope: every button-like control in `packages/editor`, `packages/ui`,
`packages/home`, and the Astro marketing site. Owner session: button-system
focus (master). Base HEAD `5fff1006e`.

Canonical contract updated in the same pass:
`docs/architecture/button-action-system.md`.

## Method

1. Inventory: `Button`/`IconButton`/`ToggleButton`/`ButtonGroup` primitives,
   every `varve-btn` usage, every bespoke `*btn*` class family, and every raw
   `<button>` in the product packages.
2. Evidence: source scan (see commands in "Verification"), plus a driven
   Playwright capture of the real editor surfaces before and after the change
   (`/tmp` review captures; reproduced surfaces below).
3. Implementation: closed the variant vocabulary, migrated raw markup to the
   primitives, added the disabled-reason path, adopted the marketing-site
   component, added guards.
4. Validation: unit + integration + website analyzer/build/E2E + direct visual
   inspection (see "Verification").

## Findings and decisions

| ID | Finding (evidence) | Classification | Decision |
| --- | --- | --- | --- |
| B1 | `varve-btn--primary` (11 refs) and `varve-btn--danger` (5 refs) had **no CSS rule anywhere** (`rg "varve-btn--primary\\|varve-btn--danger" packages`); the destructive "Reset All Workspaces" rendered neutral grey (before capture) | Accidental redundancy / correctness | **CANONICALIZE**: migrated all 16 call sites to `Button variant="default"` / `variant="destructive"`; parity test closes the vocabulary |
| B2 | 12 editor surfaces hand-wrote `<button className="varve-btn …">` markup (24 defined-variant + 16 undefined), bypassing loading/disabled/label/focus behavior | Accidental redundancy | **MERGE** into `Button`/`IconButton` |
| B3 | 112 raw `aria-pressed` buttons with bespoke classes vs 13 `ToggleButton`/`IconButton pressed` uses | Partly intentional (surface density styles) | **KEEP INTENTIONALLY** for the surface geometry, but `Button` now styles `[aria-pressed]` for `ghost`/`outline`/`secondary`/`toolbar`, so `IconButton pressed` finally has a visible state |
| B4 | Inspector parallel system `.insp-btn` (51 refs) / `.insp-btn-sm` (34 refs); `.insp-btn--primary` / `--secondary` have 0 call sites; `.insp-btn--compact` has 5 | Partly accidental (dead variants), partly intentional (field-height contract) | **REMOVE DEAD VARIANTS (deferred — file is being edited by another session)**, keep the density vocabulary as documented |
| B5 | `ButtonVariant` was a hand-written union with no link to `components.css` | Maintainability | **REDESIGN**: `BUTTON_VARIANTS`/`BUTTON_SIZES` are the runtime source of truth; parity test enforces TSX ↔ CSS |
| B6 | No explanation on unavailable actions that could not express their blocker in the label (layout save/import, workspace reset, preset import) | Information gap (research-backed) | **ADD**: `disabledReason` (focusable, `aria-describedby`, title) |
| B7 | Website: `Button.astro` had **0 importers** while 84 raw anchors in 47 pages re-declared `.btn-*` markup; `.btn-outline`/`ghost`/`link`/`destructive`, all size classes, and both pill classes had 0 usages | Accidental redundancy | **CANONICALIZE**: extended `Button.astro` (forwards `target`/`rel`/`aria-*`/`data-*`), migrated all 84 anchors; variant classes retained as the component's vocabulary |
| B8 | Raw `<button>` without `type` — accurate PCRE2 scan found 0 real cases outside the menubar item (which is not in a form); icon-only buttons all have names (scanner in method step 2) | Clean | **KEEP** |
| B9 | Menubar top-level items (`Menubar.tsx`) omit `type="button"` | Hygiene | **DEFERRED** — file is under another session's active edit; menu items are outside forms and cannot submit |

## External failure evidence (what this resolves)

| Documented failure (other products / research) | Resolution here |
| --- | --- |
| Destructive buttons that do not look destructive; red reserved for danger (Smashing Magazine 2024, design-system guides 2025) | B1 makes `variant="destructive"` the only red vocabulary; the 16 undefined-variant call sites now render correctly |
| Disabled buttons with no explanation: users re-tap, guess the missing field, or bounce (NN/g 2025, Smashing Magazine, UX Patterns Guide, GOV.UK / Polaris guidance) | B6: `disabledReason` keeps the control focusable, announces the blocker, shows a pointer title; applied at the layout save/import, workspace reset, and gradient-preset import gates |
| Color-only signals: color-blind users miss red danger (destructive-button guides) | The destructive buttons keep action-specific labels ("Delete layout", "Replace existing", "Reset All Workspaces") and the confirm dialog repeats the consequence |
| Loading spinners that flash on fast operations | `Button`'s shared `useDelayedLoading` (150 ms) with immediate `aria-busy`; unchanged but now used by the migrated surfaces |
| Interactive controls too small for touch (WCAG 2.5.8 / 2.5.5) | Shared primitive target sizes and `@media (pointer: coarse)` promotion; the migration moves raw buttons onto that contract |
| Variant drift between design tokens and shipped markup | B5/B7 guards make drift a test failure, not a customer discovery |

## Visual evidence

Captured with a driven Playwright session against the real editor dev server
(`VARVE_E2E_PORT=4189`, fresh context, 1440×900, reduced motion), before the
change and after. Committed under
`docs/screenshots/2026-09-19-button-review/`:

| Surface | Before | After | Observation |
| --- | --- | --- | --- |
| "Reset All Workspaces" (Customize Workspace) | `01-before-reset-all-workspaces.png` | `04-after-reset-all-workspaces.png` | Was neutral grey (undefined `varve-btn--danger`); now red `destructive` with `on-danger` text |
| Reset All Workspaces confirmation | `02-before-reset-confirm.png` | `05-after-reset-confirm.png` | Trigger and confirm action both read as destructive |
| Manage Layouts (+ saved row) | `03-before-manage-layouts.png` | `08-after-manage-layouts.png` | Row actions keep secondary/ghost hierarchy; Delete is isolated at the trailing edge |
| Delete confirmation | — | `06-after-delete-layout-confirm.png`, `07-after-delete-button.png` | Cancel secondary, "Delete layout" destructive, consequence text present |
| Disabled save with reason | — | `09-after-disabled-reason.png` | "Save current" is `aria-disabled`, focusable, `aria-describedby=_r_8d_` → "Enter a layout name to save", title identical (verified in the live DOM) |

Runtime check recorded by the capture script: the delete button's computed
`background` is `oklch(0.5763 0.1773 22.78)` with white text — the destructive
token pair, not the neutral base.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Vocabulary parity (TSX ↔ CSS) | `npx vitest run packages/ui/src/components/ButtonVariantParity.test.ts` | 5 passed |
| Button unit contract | `npx vitest run packages/ui/src/components/Button.test.tsx` | 16 passed |
| Repo-wide button guard | `npx vitest run tests/unit/button-system.test.ts` | 3 passed |
| Migrated surfaces | `npx vitest run packages/editor/src/components/ManageLayoutsDialog.test.tsx packages/editor/src/components/WorkspaceCustomizeDialog.test.tsx packages/editor/src/components/ShapeBuilderOverlay.test.tsx packages/editor/src/components/BackgroundRemoval/SubjectPickerOverlay.test.tsx packages/editor/src/components/Rasterize/RasterizeDialog.test.tsx packages/editor/src/TabStrip.test.tsx packages/editor/src/TabStrip.dirtyClose.test.tsx` | 36 passed |
| UI typecheck | `pnpm --filter @varve/ui exec tsc --noEmit` | clean |
| Editor typecheck | `pnpm --filter @varve/editor exec tsc -p tsconfig.json --noEmit` | 45 pre-existing errors from other sessions' in-flight files; 0 in touched files |
| Website analyzer | `pnpm --filter @varve/website exec astro check` | 0 errors, 0 warnings |
| Website unit suite | `npx vitest run apps/website/src/test` | 232 passed; 5 pre-existing failures (demo fixtures stale for schema 2.28; raw colors in `features/canvas.astro` / `docs/tools/grids.astro`) |
| Website E2E (visual + a11y) | `npx playwright test -c playwright.website.config.ts --project=ghpages` and `--project=custom-domain` | 224 passed (ghpages includes every visual baseline) and 218 passed (custom-domain, axe + touch targets + contrast) |

The first full website run failed one lane: `Button.astro` originally emitted a
default `btn-md` class, whose padding rule overrode page-scoped CTA geometry
(`.quick-download-btn`, hero CTAs) and changed pixels. The component now emits
a size class only when `size` is passed; the variant classes already own the
default geometry. Both projects then passed, visual baselines included.

## Remaining / deferred

- `.insp-btn--primary` / `.insp-btn--secondary` dead rules (0 call sites) live in
  `packages/editor/src/components/Inspector/inspector.css`, which another
  session is actively editing; remove them when that file is free.
- The 112 raw `aria-pressed` surface buttons keep their surface-specific CSS by
  design (documented in `button-action-system.md`); migrating their classes to
  the shared primitives would change inspector/timeline density and is not
  justified without a visual review of those surfaces.
- `Menubar.tsx` menu items still omit `type="button"` (hygiene only; not in a
  form). Deferred to avoid conflicting with the menubar session.
