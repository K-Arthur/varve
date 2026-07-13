# Native Tauri E2E (optional)

Strata's shared editor runs in a Chromium webview on desktop. Browser E2E
(`tests/e2e/canvas/guides.spec.ts`, etc.) exercises the same DOM pipeline via
Vite dev server.

Native Tauri E2E requires **tauri-driver** + a WebDriver server (e.g. `geckodriver`
or `chromedriver`) attached to the Tauri webview. This repo ships a gated smoke
spec that runs only when explicitly enabled:

```bash
# Prerequisites (see https://v2.tauri.app/develop/tests/webdriver/)
cargo install tauri-driver --locked
# Start geckodriver or chromedriver, then:
STRATA_TAURI_E2E=1 pnpm exec playwright test tests/e2e/tauri --project=tauri
```

Or use the helper script:

```bash
./scripts/tauri-e2e.sh
```

CI does not run native Tauri E2E by default (no WebDriver in the PR gate). Chromium
Playwright coverage remains the regression gate for viewport/guides behavior.
