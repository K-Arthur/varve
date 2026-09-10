/**
 * Desktop runtime policy shared by the preflight CLI and its regression tests.
 * Research basis: Tauri 2 WebDriver/manual-setup and prerequisites docs,
 * WebdriverIO Tauri embedded-provider documentation (reviewed 2026-07-17).
 */

export const REQUIRED_WDIO_NATIVE_UTIL_EXPORT = 'installMockSyncOverride';

const LINUX_REQUIREMENTS = ['gtk+-3.0', 'webkit2gtk-4.1', 'librsvg-2.0', 'fontconfig'];

export function evaluateWdioCompatibility({
  serviceVersion,
  nativeUtilsVersion,
  nativeUtilsExports,
}) {
  if (nativeUtilsExports.includes(REQUIRED_WDIO_NATIVE_UTIL_EXPORT)) {
    return { ok: true, issues: [], remediation: null };
  }

  return {
    ok: false,
    issues: [
      `@wdio/tauri-service@${serviceVersion} requires @wdio/native-utils to export ${REQUIRED_WDIO_NATIVE_UTIL_EXPORT}; resolved ${nativeUtilsVersion} does not.`,
    ],
    remediation:
      'Pin @wdio/tauri-service@1.3.0 and override @wdio/native-utils to 2.5.0; do not substitute an arbitrary latest browser driver.',
  };
}

export function evaluateLinuxDependencies({ platform, pkgConfig }) {
  if (platform !== 'linux') return { ok: true, issues: [] };

  const missing = LINUX_REQUIREMENTS.filter((name) => !pkgConfig[name]);
  return {
    ok: missing.length === 0,
    issues: missing.map((name) => `Missing Linux runtime/build dependency: pkg-config ${name}`),
  };
}

export function evaluateWindowsWebView2({ platform, version }) {
  if (platform !== 'win32' || version) return { ok: true, issues: [], remediation: null };

  return {
    ok: false,
    issues: ['Microsoft Edge WebView2 Evergreen Runtime was not detected.'],
    remediation:
      'Install the Microsoft Edge WebView2 Evergreen Runtime for the matching architecture, then rerun desktop:preflight.',
  };
}

/** Parse the `pv` value emitted by Windows WebView2 registry probes. */
export function parseWindowsWebView2Version(output) {
  return output?.match(/\bpv\s+REG_\w+\s+([0-9]+(?:\.[0-9]+){2,})/i)?.[1] ?? null;
}

export function evaluateXvfb({ xvfbBinary, xvfbRunBinary }) {
  if (xvfbRunBinary) return { ok: true, available: 'xvfb-run', issues: [] };
  if (xvfbBinary) return { ok: true, available: 'Xvfb', issues: [] };
  return {
    ok: false,
    available: null,
    issues: [
      'xvfb-run and Xvfb are not installed — headless display service unavailable for native GUI tests.',
    ],
  };
}

export function evaluateDisplay({ platform, sessionType, waylandDisplay, display }) {
  if (platform !== 'linux') return { ok: true, issues: [], remediation: null };
  if (waylandDisplay || display) return { ok: true, issues: [], remediation: null };

  return {
    ok: false,
    issues: [
      `No Wayland or X11 display is available for a native GUI test (session: ${sessionType || 'unknown'}).`,
    ],
    remediation:
      'Run in a logged-in Wayland/X11 session, use xvfb-run for X11 CI, or launch a headless Weston compositor for Wayland CI.',
  };
}

export function evaluatePlatform({ platform, arch }) {
  const supported = { linux: true, win32: true, darwin: true };
  return {
    ok: supported[platform] === true,
    issues: supported[platform]
      ? []
      : [`Unsupported platform: ${platform} ${arch} (supported: linux, win32, darwin)`],
  };
}

export function getLinuxInstallHint(distroId) {
  switch (distroId) {
    case 'arch':
    case 'cachyos':
      return 'sudo pacman -S --needed webkit2gtk-4.1 gtk3 librsvg fontconfig mesa libxkbcommon dbus at-spi2-core';
    case 'ubuntu':
    case 'linuxmint':
    case 'pop':
      return 'sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libfontconfig1-dev libsoup-3.0-dev libglib2.0-dev libgdk-pixbuf-2.0-dev libcairo2-dev libpango1.0-dev';
    case 'fedora':
      return 'sudo dnf install webkit2gtk4.1-devel gtk3-devel librsvg2-devel fontconfig-devel libsoup3-devel glib2-devel gdk-pixbuf2-devel cairo-devel pango-devel';
    default:
      return 'Install GTK 3, WebKitGTK 4.1, librsvg, fontconfig, and their development metadata using your distribution package manager.';
  }
}
