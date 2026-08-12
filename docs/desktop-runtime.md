# Desktop runtime and native testing

Varve uses Tauri 2. The desktop renderer is WebKitGTK on Linux, WebView2 on
Windows, and WKWebView on macOS. Browser tests and desktop-window tests are
separate: Playwright drives the Vite browser build; WebdriverIO drives a real
Tauri window built with test-only support.

## Preflight

Run this before native testing:

```bash
pnpm desktop:preflight
pnpm desktop:preflight -- --json
```

It is read-only. It reports OS/architecture, Linux library discovery, Wayland
or X11 display availability, installed driver executables, and the pinned WDIO
compatibility set. It never installs packages or downloads a driver. A failure
includes the supported remediation rather than selecting an arbitrary latest
driver.

## Native desktop test

```bash
pnpm test:desktop:native
```

This first builds a debug-only Tauri binary with the `wdio` Cargo feature, then
runs `wdio.conf.ts` with the embedded provider. The release configuration
enables only the normal `default` Tauri capability; `wdio` permissions and the
frontend bridge are enabled only by `tauri.test.conf.json` and Vite's `wdio`
mode. Do not ship a build made with that feature.

The pinned compatibility set is `@wdio/tauri-service` 1.3.0 with
`@wdio/native-utils` 2.5.0. The override exists because the service imports
`installMockSyncOverride`, which 2.4.0 does not export. `tauri-driver` remains
an optional manual diagnostic on Linux and Windows; it is not the canonical
cross-platform native test provider.

## Linux

CachyOS and Arch:

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg fontconfig mesa libxkbcommon dbus at-spi2-core
```

Ubuntu, Linux Mint, and Pop!_OS:

```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libfontconfig1-dev libsoup-3.0-dev libglib2.0-dev libgdk-pixbuf-2.0-dev libcairo2-dev libpango1.0-dev
```

Fedora:

```bash
sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel fontconfig-devel libsoup3-devel glib2-devel gdk-pixbuf2-devel cairo-devel pango-devel
```

Run locally in a logged-in Wayland session or under X11/XWayland. For X11 CI,
use `xvfb-run --auto-servernum pnpm test:desktop:native`; include D-Bus,
AT-SPI, fonts, Mesa software rendering, and the package set above. A container
without a display cannot prove interactive native-window behavior. Wayland CI
requires a compositor such as Weston, not merely `Xvfb`.

## Windows

The app uses WebView2, never GTK. The NSIS installer is configured to embed
Tauri's offline WebView2 bootstrapper so an offline installation does not rely
on a browser download. Hosted Windows runners execute the embedded provider;
no EdgeDriver is selected or downloaded by Varve. Test x64 and ARM64 packaged
builds independently, use short writable temp paths, and retain screenshots on
failure. Account for DPI and multiple-monitor coordinates in interaction tests.

## macOS

The app uses WKWebView and supports macOS 13 or later. Native tests require a
logged-in macOS runner; there is no supported generic headless WKWebView
substitute. The embedded provider is used instead of `tauri-driver`. Release
builds require a real Apple signing identity, hardened runtime entitlements,
notarization credentials, and post-notarization launch verification on both
Apple Silicon and Intel. Native UI automation additionally needs the runner's
Accessibility/Automation consent where the test tooling requests it.

## CI and artifacts

CI keeps browser Playwright, native desktop smoke tests, and package smoke
tests as distinct jobs. Native failures should upload WDIO logs, screenshots,
and relevant platform logs. Package smoke testing must run on the matching OS;
one Linux container cannot validate Windows or macOS installers.

## Sources

- [Tauri WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [WebdriverIO Tauri service](https://webdriver.io/docs/wdio-tauri-service/)
- [Tauri Windows installer configuration](https://v2.tauri.app/distribute/windows-installer/)
