# Typography website evidence — 2026-09-14

## Command

```text
pnpm build:website
pnpm build:website:pages
VARVE_WEBSITE_E2E_PORT=4471 VARVE_WEBSITE_E2E_PORT_ROOT=4472 CI=1 \
pnpm exec playwright test -c playwright.website.config.ts \
  apps/website/tests/e2e/typography-workflow.spec.ts \
  --project=ghpages --project=custom-domain --reporter=list
```

## Result

Both static builds completed successfully. The targeted website run passed
**14/14** scenarios across the `/varve` GitHub Pages base path and the custom
domain root:

- typography feature and guide pages in desktop light and dark layouts;
- both pages in a narrow dark layout;
- image decode and horizontal-overflow checks;
- visible guidance for More text formatting, Document fonts, and the current
  integration limits; and
- FAQ structured-data consistency with the visible missing-font limitations.

The run generated and inspected the typography intro, font-access, browser,
and toolbar captures for the feature page. No website changes were staged from
the shared worktree during this validation.
