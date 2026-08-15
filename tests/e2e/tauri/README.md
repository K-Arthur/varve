# Native Tauri E2E Testing

Varve supports two approaches for native Tauri desktop E2E testing:

| Approach | Runner | macOS | Linux | Windows | Requires |
|----------|--------|-------|-------|---------|----------|
| **WDIO (embedded)** | WebdriverIO | Native | Native | Native | `wdio` Cargo feature |
| **tauri-driver + Playwright** | Playwright | Not supported | Requires WebKitWebDriver | Requires msedgedriver | External WebDriver process |

## Recommended: WebdriverIO with embedded WebDriver (`@wdio/tauri-service`)

This approach works on **all three platforms** without any external WebDriver process.
It embeds a W3C WebDriver HTTP server inside the Tauri app itself.

### Prerequisites

```bash
# 1. Install npm packages (already in package.json)
pnpm install

# 2. Install platform-specific dependencies:

# Linux (Arch/CachyOS):
sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg fontconfig mesa libxkbcommon dbus at-spi2-core xvfb

# Linux (Ubuntu/Debian/Pop!_OS/Linux Mint):
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libfontconfig1-dev \
  libsoup-3.0-dev libglib2.0-dev libgdk-pixbuf-2.0-dev libcairo2-dev libpango1.0-dev \
  cmake pkg-config patchelf xvfb dbus-x11 at-spi2-core

# Linux (Fedora):
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel fontconfig-devel \
  libsoup3-devel glib2-devel gdk-pixbuf2-devel cairo-devel pango-devel xorg-x11-server-Xvfb

# Windows:
# - Microsoft Edge WebView2 Evergreen Runtime (bundled via offline installer)
# - Visual Studio Build Tools (for MSVC compiler, available on GitHub Actions windows-latest)
# - No GTK or WebKit required

# macOS:
# - Xcode Command Line Tools: xcode-select --install
# - No additional WebView runtime needed (WKWebView is built-in)
```

### Running

```bash
# Run preflight diagnostics first
pnpm desktop:preflight

# Headed (requires a real display)
pnpm test:wdio

# Headless Linux (CI, no display)
xvfb-run pnpm test:wdio

# Full native E2E pipeline (preflight -> build -> test)
pnpm test:desktop:native
```

The WDIO config lives at `wdio.conf.ts`. Tests are in `tests/wdio/`.

The default native lane runs `tauri-smoke.e2e.ts` and
`native-menu.e2e.ts`. Updater fixture specs are intentionally excluded because
they require the dedicated signed AppImage fixture runner; select an explicit
set when debugging another lane:

```bash
VARVE_WDIO_SPECS=tests/wdio/updater.e2e.ts pnpm test:desktop:native
```

The embedded Tauri provider starts each session at the app's current document,
so native specs must wait for the home/editor selectors rather than navigate to
`/`. Use `browser.tauri.execute()` for in-app JavaScript and stable
`data-testid` or accessible-role selectors for UI actions.

### What's tested

- Application lifecycle (load, home screen, create document)
- Tauri IPC bridge availability
- Native Tauri command invocation
- Canvas interaction via pointer events
- Native plugin access (dialog, fs)

## Legacy: tauri-driver + Playwright

This approach requires `tauri-driver` and a platform WebDriver server.
It works on **Windows and Linux only** (macOS is not supported by tauri-driver directly).

```bash
# Install tauri-driver
cargo install tauri-driver --locked

# Linux - install WebKitWebDriver:
sudo apt-get install webkit2gtk-driver  # Ubuntu/Debian
# or
sudo pacman -S webkit2gtk               # Arch (includes WebKitWebDriver)

# Windows - download msedgedriver matching your Edge/WebView2 version:
# https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/

# Run
./scripts/tauri-e2e.sh
```

A Playwright spec for this path also lives in this directory:
`tests/e2e/tauri/smoke.spec.ts`. It is **skipped unless `VARVE_TAURI_E2E=1`
is set** (see the spec header), so it never affects the default `playwright
test` run. `scripts/tauri-e2e.sh` runs the full flow: it verifies
`tauri-driver` is installed, starts it against a Tauri dev build (the
`withGlobalTauri: true` config exposes the IPC bridge), sets the env var, and
runs the spec. To drive the spec manually:

```bash
VARVE_TAURI_E2E=1 npx playwright test tests/e2e/tauri/smoke.spec.ts --project=chromium --reporter=list
```

## CI

Desktop E2E runs in CI as the `desktop-e2e` job in `.github/workflows/ci.yml`:

| Platform | Runner | Display | Status |
|----------|--------|---------|--------|
| Linux (X11) | ubuntu-latest | xvfb-run | Active |
| Windows | windows-latest | Native (via WebView2) | Active |
| macOS | macos-latest | Native (via WKWebView) | Active |

All three platforms use the WDIO embedded WebDriver approach. The `build.yml`
workflow also builds a debug binary with wdio features on Linux for post-build
verification.

## Adding new desktop E2E tests

1. Add WDIO tests to `tests/wdio/*.e2e.ts`
2. Use `browser.tauri.execute()` for in-app JavaScript access
3. Use `browser.tauri.mock()` to mock Tauri commands
4. Use stable selectors (`data-testid`, accessible roles) over CSS classes
5. Await the `varve:ready` custom event instead of using arbitrary timeouts
6. Verify real application outcomes, not just DOM presence

## Troubleshooting

### Build fails: "Permission wdio:default not found"

The `wdio` Cargo feature must be enabled for test builds:
```bash
# Correct:
pnpm desktop:build:test

# Wrong (will fail):
cargo build -p varve-desktop
```

Normal release builds do NOT include the wdio feature.

### Preflight reports missing dependencies

```bash
# Run preflight with JSON output for detailed diagnostics
node scripts/desktop/preflight.mjs --json
```

### No display available on Linux

```bash
# Install xvfb:
sudo pacman -S xvfb             # Arch/CachyOS
sudo apt-get install xvfb       # Ubuntu/Debian

# Run tests with xvfb-wrap:
xvfb-run pnpm test:desktop:native
```
