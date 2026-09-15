# Typography website visual evidence — 2026-09-13

The typography marketing page and guide were rebuilt and checked in both
shipping base-path modes after the font-system copy and screenshot updates.
The check covered desktop light/dark layouts and the 390×844 narrow dark layout.

## Commands and results

```text
pnpm build:website
pnpm build:website:pages
VARVE_WEBSITE_E2E_PORT=4331 VARVE_WEBSITE_E2E_PORT_ROOT=4332 \
npx playwright test -c playwright.website.config.ts \
  apps/website/tests/e2e/typography-workflow.spec.ts \
  --project=ghpages --project=custom-domain --reporter=list --timeout=120000
```

Both website builds completed successfully. The Chromium run passed **14/14**
checks in 8.0 seconds across `/varve` (GitHub Pages) and `/` (custom domain):
all typography feature/guide layouts, FAQ structured data, image decoding,
base-path links, and narrow overflow assertions passed.

## Inspected captures

- [Custom-domain feature toolbar scene](../screenshots/fonts/2026-09-13-website-typography/custom-feature-toolbar-scene.png) — the compact toolbar example is legible inside the feature page and its copy explains the explicit font decision boundary.
- [Custom-domain feature browser scene](../screenshots/fonts/2026-09-13-website-typography/custom-feature-browser-scene.png) — the Browse fonts example shows the family list, specimen, and details pane without implying silent downloads.
- [Custom-domain narrow guide](../screenshots/fonts/2026-09-13-website-typography/custom-docs-narrow-intro.png) — the 390px guide keeps the heading, paragraphs, keyboard hint, and section rules inside the viewport.
- [GitHub Pages narrow licensing state](../screenshots/fonts/2026-09-13-website-typography/ghpages-docs-narrow-font-access.png) — the access/licensing section remains readable at the `/varve` base path and states that technical flags do not establish a license grant.

The pages describe exact-face identity, explicit local-font permission/import,
missing-font recovery, variable axes, Document Fonts, Select by Font, image
identification, and export limitations. Claims that remain pending in the
product are labelled as integration work rather than presented as shipped
capabilities.

## Follow-up visual pass — 2026-09-14

The narrow captures exposed an inline-axis token wrapping at the hyphen. The
feature and guide now keep inline code tokens intact within their paragraph
flow, while still allowing the whole token to move to the next line. This is a
page-scoped change; it does not change the global code-block behavior.

Commands:

```text
pnpm --filter @varve/website build
pnpm build:website:pages
CI=1 VARVE_WEBSITE_E2E_PORT=1753 VARVE_WEBSITE_E2E_PORT_ROOT=1754 npx playwright test apps/website/tests/e2e/typography-workflow.spec.ts -c playwright.website.config.ts --project=ghpages --project=custom-domain --reporter=list
```

Both builds completed with **0 errors** (Astro reported five existing hints),
and the two deployment projects passed **14/14** typography/FAQ cases. I
inspected the refreshed desktop light, desktop dark, and 390×844 narrow
captures for both base paths; the `vertical-rl` and `vertical-lr` chips remain
readable without horizontal overflow.
