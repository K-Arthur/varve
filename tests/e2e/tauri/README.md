# Native Tauri E2E Testing

Strata supports two approaches for native Tauri desktop E2E testing:

| Approach | Runner | macOS | Linux | Windows | Requires |
|----------|--------|-------|-------|---------|----------|
| **WDIO (embedded)** | WebdriverIO | ✅ Native | ✅ Native | ✅ Native | `wdio` Cargo feature |
| **tauri-driver + Playwright** | Playwright | ❌ | ✅ | ✅ | External WebDriver |

## Recommended: WebdriverIO with embedded WebDriver (`@wdio/tauri-service`)

This approach works on **all three platforms** without any external WebDriver process.
It embeds a W3C WebDriver HTTP server inside the Tauri app itself.

### Prerequisites

```bash
# 1. Install npm packages
pnpm add -D @wdio/cli @wdio/globals @wdio/local-runner \
  @wdio/mocha-framework @wdio/spec-reporter \
  @wdio/tauri-service @wdio/tauri-plugin ts-node

# 2. On Linux, install WebKitGTK driver and xvfb
sudo apt-get install -y webkit2gtk-driver xvfb

# 3. Build the Tauri app with the wdio feature
cd apps/desktop
pnpm tauri build --debug --features wdio
```

### Running

```bash
# Headed (requires a real display)
pnpm test:wdio

# Headless (CI, no display)
xvfb-run pnpm test:wdio
```

The WDIO config lives at `wdio.conf.ts`. Tests are in `tests/wdio/`.

### What's tested

- Application lifecycle (load, home screen, create document)
- Tauri IPC bridge availability
- Native Tauri command invocation
- Canvas interaction via pointer events
- Native plugin access (dialog, fs)

## Legacy: tauri-driver + Playwright

This approach requires `tauri-driver` and a platform WebDriver server.
It works on **Windows and Linux only** (macOS is not supported by tauri-driver directly).

### Prerequisites

```bash
# 1. Install tauri-driver
cargo install tauri-driver --locked

# 2. Install platform WebDriver
# Linux:
sudo apt-get install -y webkit2gtk-driver
# Windows: download msedgedriver matching your Edge version

# 3. Install xvfb (Linux, headless)
sudo apt-get install -y xvfb
```

### Running

```bash
# Using the helper script
./scripts/tauri-e2e.sh

# Or manually:
export STRATA_TAURI_E2E=1
pnpm exec playwright test tests/e2e/tauri --project=tauri --reporter=list
```

### Platform support

| Platform | tauri-driver | Notes |
|----------|-------------|-------|
| Linux (WebKitGTK) | ✅ | Requires WebKitWebDriver |
| Windows (WebView2) | ✅ | Requires msedgedriver |
| macOS (WKWebView) | ❌ | No WKWebView driver tool; use WDIO + embedded WebDriver instead |

## CI

Desktop E2E runs in CI under the `desktop-e2e` job (Linux only, xvfb).
It uses the embedded WDIO approach with the `wdio` feature flag.

The `build.yml` pipeline also builds with `--features wdio` on Linux so that
release artifacts include test infrastructure for post-build validation.

## Adding new desktop E2E tests

1. Add WDIO tests to `tests/wdio/*.e2e.ts`
2. Use `browser.tauri.execute()` for in-app JavaScript access
3. Use `browser.tauri.mock()` to mock Tauri commands
4. Use stable selectors (`data-testid`, accessible roles) over CSS classes
5. Await the `strata:ready` custom event instead of using arbitrary timeouts
6. Verify real application outcomes, not just DOM presence
