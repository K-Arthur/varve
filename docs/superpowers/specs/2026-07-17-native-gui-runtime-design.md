# Native GUI Runtime and Test Infrastructure Design

## Goal

Make Strata's Tauri desktop runtime and GUI automation reproducible on Linux,
Windows, and macOS while keeping browser tests, native-development tests, and
packaged-application tests separate.

## Observed architecture and root causes

Strata uses Tauri 2.11.3. Linux uses GTK 3 and WebKitGTK 4.1; Windows uses
WebView2; macOS uses WKWebView. Browser tests use Playwright. Native tests use
WebdriverIO and the Tauri service.

The native test failure is a published dependency incompatibility:
`@wdio/tauri-service@1.2.0` imports `installMockSyncOverride`, while its locked
`@wdio/native-utils@2.4.0` does not export it. The API is present in
`@wdio/native-utils@2.5.0`. The existing legacy script is also invalid: it
starts Playwright against Vite, but never starts `tauri-driver` or attaches a
W3C client to it.

The local CachyOS environment has the required runtime and both a direct native
Wayland launch and a direct `tauri-driver`/`WebKitWebDriver` W3C session have
been verified. The failures are configuration and dependency-management faults,
not a missing local GTK/WebKitGTK library.

## Compatibility architecture

Embedded WebdriverIO is the canonical native-development test provider. It is
the only free provider that works consistently on Linux, Windows, and macOS,
including WKWebView. The embedded WebDriver server and WDIO helper plugin are
compiled only into a dedicated test build. Production and release artifacts do
not contain test automation listeners.

`tauri-driver` remains an explicitly optional Linux/Windows diagnostic path for
testing an uninstrumented packaged binary. It is never invoked by Playwright.
Playwright remains the renderer/browser suite and never claims to test a native
window.

The dependency policy lives in one small JavaScript module. The preflight CLI,
native runner, unit tests, and CI all consume it so version and platform
assumptions are not duplicated in shell fragments.

## Components

### Compatibility and preflight

`scripts/desktop/compatibility.mjs` owns supported operating systems,
architectures, package-manager instructions, expected WebDriver provider, and
version checks. `scripts/desktop/preflight.mjs` detects the host OS, architecture,
display server, Tauri/WebKit/WebView runtime, executable linkage, optional
drivers, and WDIO export compatibility. It produces text by default and JSON
with `--json`; it never installs a package.

### Native test build

`tauri.test.conf.json` selects an explicit capability containing WDIO
permissions. A compile feature enables the Rust plugins only in this build;
Vite's `wdio` mode loads the test helper frontend module only for this build.
The regular Tauri configuration and release builds remain test-plugin-free.

### Test runners

`wdio.native.conf.ts` uses the embedded provider and a resolved app path. It
captures frontend/backend logs and writes reports/screenshots to a designated
artifact directory. The suite asserts a visible real window, a responsive
webview, and an interaction outcome rather than only a live process.

The browser Playwright configuration stays separate. The retired Playwright
"tauri" project and shell script are replaced by a clear external-driver
diagnostic script that uses a W3C-capable client or is removed if it provides no
coverage.

### CI and packaging

CI has distinct browser, native Linux X11, native Linux Wayland, native Windows,
and native macOS jobs. Linux X11 uses Xvfb; Wayland uses a headless Weston
compositor. Windows/macOS run only on their native hosted runners. Artifacts
include preflight JSON, service logs, screenshots, and reports on failure.

PR builds package unsigned artifacts. Tagged releases fail before publishing if
required signing/notarization secrets are unavailable. Windows installers embed
the offline WebView2 installer. The release matrix builds Windows x64 and ARM64,
and macOS universal binaries; execution jobs run only where a matching native
runner is available.

## Platform policy

Linux supports CachyOS/Arch, Ubuntu, Mint, Pop!_OS, and Fedora. The preflight
reports distro-specific commands for missing build/runtime requirements and
explains display-server fallbacks. GTK/WebKitGTK checks are Linux-only.

Windows targets Windows 10/11 using Evergreen WebView2 at development time and
the offline installer for distributable installers. It reports WebView2 and
Edge-driver state without downloading a driver during preflight.

macOS targets the existing macOS 13+ baseline. It uses WKWebView and embedded
WDIO for webview interaction. A real logged-in runner session is required for
native GUI execution; containers are not treated as a substitute. Signing,
hardened runtime, notarization, and Accessibility Inspector/XCTest requirements
are documented as release responsibilities.

## Validation

Tests cover compatibility-policy behavior, Linux dependency detection,
display-server errors, WDIO export compatibility, and test-build isolation.
Native smoke tests assert visible window state, DOM readiness, canvas geometry,
and an actual user action. Package smoke tests verify a packaged executable can
launch with the correct platform runtime; Windows and macOS tests run only on
their native CI runners.

## Known baseline failures

Before this worktree was created, `pnpm typecheck` failed on five unused symbols
in engine files and `pnpm test` failed seven assertions in composite-canvas,
CanvasArea, and Menubar tests. These failures are outside this design's ownership
and must remain distinguishable from changes made here.
