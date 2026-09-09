# UI and visual optimization audit — 2026-09-09

Status: implementation checkpoint on `master`

This is the current-state record for the UI and visual-design optimization
pass requested on 2026-09-09. It complements the durable design-system
contracts in [`docs/design/design-principles.md`](../design/design-principles.md),
[`docs/design/visual-direction.md`](../design/visual-direction.md), and the
interface sizing contract in
[`docs/architecture/interface-sizing-system.md`](../architecture/interface-sizing-system.md).

## A. Repository UI map

| Surface | Entry point | Styling source | Visual verification |
|---|---|---|---|
| Desktop/web editor shell | `apps/desktop/src/main.tsx`, `packages/editor/src/Shell.tsx` | `packages/ui/src/tokens/tokens.css`, `packages/ui/src/components/components.css`, `packages/editor/src/editor.css` and domain CSS | Playwright `tests/e2e/canvas/**`, menu/settings visual specs, deterministic screenshot harness |
| Home/workspace browser | `packages/home/src/HomeShell.tsx` | `packages/home/src/home.css` plus `@varve/ui` primitives/tokens | `tests/e2e/home/**`, home empty/populated fixtures |
| Shared primitives | `packages/ui/src/components/` | `packages/ui/src/components/components.css` and component CSS | Vitest component tests, stories, token/audit scripts |
| Marketing/documentation site | `apps/website/src/layouts/Layout.astro`, `apps/website/src/pages/` | `apps/website/src/styles/global.css`, `theme.css`, imported shared tokens | `apps/website/tests/e2e/`, website visual snapshots, static build |
| Product screenshot pipeline | `scripts/screenshots/`, `apps/website/src/data/screenshot-manifest.json` | Generated captures from the running editor | `pnpm screenshots:product`, manifest tests, website visual suite |

The desktop app and website share the token vocabulary and local font families,
but intentionally differ in density: the editor is a professional workspace;
the website uses the same color and type roles with more editorial spacing.

## B. Baseline evidence

Baseline captures were taken from the running local servers at 1440×900 (editor)
and 1280×720 (website), with a 390×844 narrow website pass attempted using the
Chromium browser profile. The following compositions were inspected directly:

- Home empty state: clear shell, but the active sidebar item is the strongest
  filled surface in an otherwise quiet layout.
- New Design dialog: the advanced-settings summary has insufficient separation
  between its label and current-state hint; this is a P1 clarity defect.
- Editor empty state: the canvas is correctly dominant, with compact menubar,
  layers rail, inspector, floating tool rail, and status bar using the shared
  token system.
- Marketing homepage: strong editorial hero and real product screenshot; the
  product screenshot frame still uses generic three-dot window chrome.
- Marketing Layers page: consistent type and surface language, but the page
  should continue to frame product UI as the same system shown in the app.

The baseline command was:

```bash
pnpm exec playwright screenshot --device='Desktop Chrome' \
  --wait-for-timeout=3000 http://localhost:1420/ /tmp/varve-ui-baseline/desktop-home.png
pnpm exec playwright screenshot --device='Desktop Chrome' \
  --wait-for-timeout=3000 http://localhost:4397/ /tmp/varve-ui-baseline/website-home.png
```

The New Design and editor captures were taken after opening the real dialog and
creating a real empty document through Playwright. They were visually inspected,
not treated as proof merely because the browser completed the capture.

## C. Prioritized audit

| ID | Issue / location | Evidence and consequence | Severity | Root cause | Implementation |
|---|---|---|---|---|---|
| UI-01 | New Design advanced summary, `packages/home/src/home.css` | “Advanced settings” and the current intent/color hint visually concatenate in the real 1440×900 dialog capture | P1 | Inline flex summary has no explicit visual divider or spacing contract | Fixed in this pass with a separated summary treatment and narrow-layout wrapping |
| UI-02 | Home active navigation, `packages/home/src/home.css` | Active Recent row carries a high-saturation filled treatment that competes with the primary empty-state action | P2 | Selection treatment was inherited from an accent-filled navigation pattern | Fixed in this pass with a quieter wash plus a persistent accent rail |
| UI-03 | Home file thumbnail controls, `packages/home/src/home.css` | Drag handle and type badge use translucency/blur while the adopted application surface model is opaque | P2 | Legacy “glass” treatment survived the opaque-surface migration | Fixed in this pass with opaque token-backed surfaces |
| UI-04 | Marketing product screenshot frame, `apps/website/src/components/ProductShowcase.astro` | Generic desktop-window dots make the real application capture feel like a mockup | P2 | Showcase wrapper predates the current product-chrome direction | Fixed in this pass with a Varve workspace frame and status treatment |
| UI-05 | Editor domain controls, `packages/editor/src/components/Inspector/` and Layers | Inline/domain controls remain a known migration area even though the visual language is mostly coherent | P2 | Specialized editor widgets predate some shared primitives | Partially addressed: the high-frequency single-selection path now has a polished Quick properties surface; Tree/Combobox ownership work remains deferred |
| UI-06 | Website feature page composition | Feature pages are visually consistent but have no shared product-frame primitive for domain screenshots | P3 | Each page owns its screenshot framing locally | Deferred; candidate for a later Astro component extraction |

## D. Design direction adopted

The existing Varve direction is retained and made more explicit:

- **Work-first density:** the canvas and document content remain the dominant
  visual surface; editor chrome stays compact and measured.
- **Quiet structure, strong state:** use opaque elevation surfaces and 1px
  micro-borders for structure; reserve teal for actions, selection, focus, and
  meaningful current-state indicators.
- **Readable summaries:** a control label and its current state are separate
  pieces of information and must have intentional spacing, alignment, and
  truncation behavior.
- **One geometry vocabulary:** controls, menus, dialogs, cards, and panels use
  the existing compact/default/large heights and semantic radius/elevation
  tokens.
- **Product-truth marketing:** the website shows real captures and frames them
  as Varve workspace surfaces rather than generic SaaS or operating-system
  mockups.

This is a refinement of the existing Neo-Bento × Linear hybrid, not a new
framework or visual skin.

## E. Component consolidation and access map

| Category | Canonical owner | Duplicates / debt | Decision |
|---|---|---|---|
| Buttons and icon buttons | `@varve/ui` `Button` / `IconButton` | Local home and editor buttons remain for domain-only affordances | Keep shared primitives; migrate only equivalent controls |
| Dialog shell | `@varve/ui` `Dialog` | Domain content remains local | Keep one shell; fix content anatomy at the owning surface |
| Menus/popovers | `@varve/ui` `Menu`, `ContextMenu`, `Popover` | Specialized canvas overlays remain specialized | Preserve shared geometry/ownership contracts |
| Panel/layout surfaces | `@varve/ui` `Panel` plus editor panel CSS | Layers/Inspector need domain-specific tree/forms | Keep domain composition; use shared tokens for chrome |
| Home file cards | `@varve/home` file card recipe + `.bento-cell` | No new card variant introduced | Keep card visual hierarchy, remove translucent legacy surface treatment |
| Marketing product screenshots | `ProductShowcase.astro` | Feature-page screenshot blocks are separate and intentionally deferred | Improve the homepage frame now; extract later when requirements converge |

## Inspector follow-up — 2026-09-09

The deferred inspector slice now has a bounded implementation. A single selected
node exposes X, Y, W, H, Opacity, and Fill at the top of the Design/Properties
surface. The strip reuses the canonical setters and binding presentation, keeps
image dimensions proportional like the full Layout section, and disappears for
empty or mixed selections. Its controls use the existing token and input-field
grammar: explicit borders, restrained sunken grouping, keyboard focus rings,
and a wider Fill control for the color-popover affordance.

The implementation deliberately leaves the full Layout and Appearance sections
in place as the authoritative editing surfaces. This avoids introducing a
second state model while reducing repeated navigation for the six most common
single-selection edits.

Evidence: `tests/e2e/inspector/quick-properties.spec.ts` verifies the real
browser flow, canonical X synchronization, empty/mixed-selection behavior, and
the focused visual snapshot. The focused run used Chromium at the standard
inspector width; the repository-wide visual gate remains an integration check.

Important existing commands retain their current access paths:

- New/Open/Import: home toolbar as primary access; command/keyboard paths remain
  accelerated access; no duplicate business logic is added.
- Layers/Inspector: persistent editor panels as primary access; context menus,
  shortcuts, and command surfaces remain contextual/accelerated access.
- Export and workspace switching: existing menubar/action registry remains the
  canonical execution path.

## F. Implemented groups

### Group 1 — home/dialog visual clarity

- Added explicit spacing and a divider treatment between the Advanced settings
  label and its state hint.
- Allowed the summary to wrap cleanly at constrained widths without changing
  the dialog state model or keyboard behavior.
- Changed active home navigation to use a semantic accent wash and edge marker,
  preserving `aria-current` and the selected state.
- Replaced thumbnail-control translucency with opaque token-backed surfaces.

### Group 2 — marketing product framing

- Reframed the homepage product screenshot chrome as a Varve workspace surface.
- Kept the existing manifest-driven real screenshot, alt text, dimensions, and
  loading behavior intact.
- Preserved the website’s shared font/token imports and responsive layout.

## G. Residual design-debt register

| Item | Severity | Reason deferred | Next action |
|---|---|---|---|
| Inline editor Tree/Combobox controls | P2 | Requires focused primitive ownership and behavior migration | Build/test canonical Tree/Combobox adapters before styling migration |
| Shared Astro product-frame component | P3 | Current feature-page frames have meaningful content differences | Inventory frame anatomy after the next screenshot-pipeline refresh |
| Full cross-runtime visual matrix | P2 | Linux Chromium was available; native Tauri and macOS were not in this session | Run release/desktop visual lanes on their supported hosts |

## H. Verification record

The final implementation record is maintained below as commits land. Every
meaningful UI change must include the affected-package planner, targeted tests,
and a fresh browser screenshot that is visually inspected in light/dark and at
the relevant constrained width where the surface supports it.

### Implementation and evidence

The scoped changes were delivered as three commits on `master`:

- `579caf25` — documented the repository UI map, baseline evidence, direction,
  access map, audit priorities, and residual debt.
- `0c32bedfc` — clarified home navigation, thumbnail controls, and the New
  Design advanced-settings summary.
- `5c3dc1c29` — reframed the marketing product screenshot as a Varve workspace
  surface while preserving the real manifest-driven capture.

Commands run for this pass:

```text
pnpm verify:plan
pnpm exec vitest run packages/home/src/NewDesignDialog.test.tsx --reporter=verbose
pnpm exec stylelint packages/home/src/home.css
pnpm --filter @varve/website typecheck
pnpm build:website
pnpm verify:affected
pnpm audit:docs
pnpm audit:emoji
```

Passed evidence:

- New Design dialog tests: 14/14.
- Website Astro check/typecheck: 0 errors, 0 warnings, 5 hints.
- Website static build: 79 pages built successfully.
- Docs audit: clean; emoji audit: clean.
- The staged commit checkpoints passed format, lint/health, impact-config,
  secret, contact, emoji, and docs checks.
- Fresh Playwright captures were visually inspected at desktop and narrow
  widths for the home/dialog surfaces, and at desktop, narrow, light, and dark
  themes for the marketing product frame. Evidence is retained in
  `/tmp/varve-ui-after/` during this session, including
  `new-design-dialog-light.png`, `new-design-dialog-narrow-2.png`,
  `home-empty-light.png`, `website-showcase-2.png`,
  `website-showcase-mobile-2.png`, and `website-showcase-dark-2.png`.

`pnpm verify:affected` selected the website/shared affected closure and
reported 188/192 website tests passing. Its four failures are pre-existing
fixture drift from concurrent schema work in the shared worktree: the committed
website demo `.varve` fixtures remain at format `2.22` while the concurrent
scene changes emit `2.23`. Those fixtures were not regenerated or staged as
part of this visual pass. Native desktop GUI, full visual regression, Rust
workspace, benchmark, packaging, and release lanes were deferred by the commit
checkpoint because they are outside the changed UI slice; the concurrent
worktree changes should receive their own affected validation once stabilized.
