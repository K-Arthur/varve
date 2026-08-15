#!/usr/bin/env node
/**
 * Read-only desktop runtime diagnostics. This command never installs packages,
 * downloads drivers, starts the application, or alters a user environment.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  evaluateDisplay,
  evaluateLinuxDependencies,
  evaluatePlatform,
  evaluateWdioCompatibility,
  evaluateWindowsWebView2,
  evaluateXvfb,
  getLinuxInstallHint,
  parseWindowsWebView2Version,
} from './compatibility.mjs';

const wantsJson = process.argv.includes('--json');
const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};
const findExecutable = (name) => run(process.platform === 'win32' ? 'where' : 'which', [name]);
const getDistro = () => {
  if (process.platform !== 'linux') return null;
  const text = run('cat', ['/etc/os-release']) ?? '';
  const id = text.match(/^ID=(.+)$/m)?.[1]?.replaceAll('"', '') ?? 'unknown';
  return id;
};
const pkgConfigVersion = (name) => run('pkg-config', ['--modversion', name]);
const windowsWebView2Version = () => {
  if (process.platform !== 'win32') return null;
  const clientId = '{F1E7E4A3-5D8A-4A42-BB8B-D0D444CBAE6D}';
  const registryKeys = [
    `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${clientId}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${clientId}`,
    `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${clientId}`,
  ];

  for (const key of registryKeys) {
    const registryOutput = run('reg', ['query', key, '/v', 'pv']);
    const version = parseWindowsWebView2Version(registryOutput);
    if (version) return version;
  }

  // Some hosted images expose the runtime directory while registry
  // virtualization hides the client key from the runner account.
  const directoryOutput = run('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "Get-ChildItem 'C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application','C:\\Program Files\\Microsoft\\EdgeWebView\\Application' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name",
  ]);
  return directoryOutput?.match(/^\d+(?:\.\d+){2,}$/m)?.[0] ?? null;
};
const macosRuntime = () => {
  if (process.platform !== 'darwin') return null;
  return {
    macosVersion: run('sw_vers', ['-productVersion']),
    xcodePath: run('xcode-select', ['-p']),
  };
};
const packageJsonFor = (entryPath, expectedName) => {
  let directory = dirname(entryPath);
  while (directory !== dirname(directory)) {
    const candidate = join(directory, 'package.json');
    if (existsSync(candidate)) {
      const metadata = JSON.parse(readFileSync(candidate, 'utf8'));
      if (metadata.name === expectedName) return candidate;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package.json for ${entryPath}`);
};

async function inspectWdio() {
  try {
    const localRequire = createRequire(import.meta.url);
    const serviceEntryPath = localRequire.resolve('@wdio/tauri-service');
    const servicePackagePath = packageJsonFor(serviceEntryPath, '@wdio/tauri-service');
    const service = JSON.parse(readFileSync(servicePackagePath, 'utf8'));
    const serviceRequire = createRequire(servicePackagePath);
    const nativeUtilsEntry = serviceRequire.resolve('@wdio/native-utils');
    const nativeUtilsPackagePath = packageJsonFor(nativeUtilsEntry, '@wdio/native-utils');
    const nativeUtils = JSON.parse(readFileSync(nativeUtilsPackagePath, 'utf8'));
    const nativeUtilsModule = await import(pathToFileURL(nativeUtilsEntry).href);
    return evaluateWdioCompatibility({
      serviceVersion: service.version,
      nativeUtilsVersion: nativeUtils.version,
      nativeUtilsExports: Object.keys(nativeUtilsModule),
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        `Unable to inspect WDIO compatibility: ${error instanceof Error ? error.message : String(error)}`,
      ],
      remediation: 'Run pnpm install --frozen-lockfile before native desktop testing.',
    };
  }
}

const platform = process.platform;
const distro = getDistro();
const platformSupport = evaluatePlatform({ platform, arch: process.arch });
const xvfbCheck = evaluateXvfb({
  xvfbBinary: findExecutable('Xvfb'),
  xvfbRunBinary: findExecutable('xvfb-run'),
});
const pkgConfig = Object.fromEntries(
  ['gtk+-3.0', 'webkit2gtk-4.1', 'librsvg-2.0', 'fontconfig'].map((name) => [
    name,
    pkgConfigVersion(name),
  ]),
);
const linuxLibraries = evaluateLinuxDependencies({ platform, pkgConfig });
const detectedWebView2Version = windowsWebView2Version();
const webView2 = evaluateWindowsWebView2({ platform, version: detectedWebView2Version });
const display = evaluateDisplay({
  platform,
  sessionType: process.env.XDG_SESSION_TYPE ?? '',
  waylandDisplay: process.env.WAYLAND_DISPLAY ?? '',
  display: process.env.DISPLAY ?? '',
});
const wdio = await inspectWdio();

const report = {
  platform: {
    os: platform,
    release: os.release(),
    architecture: process.arch,
    distro,
    support: platformSupport,
  },
  gui: {
    sessionType: process.env.XDG_SESSION_TYPE ?? null,
    waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
    x11Display: process.env.DISPLAY ?? null,
    display,
    xvfb: xvfbCheck,
  },
  linux:
    platform === 'linux'
      ? { pkgConfig, dependencies: linuxLibraries, installHint: getLinuxInstallHint(distro) }
      : null,
  runtimes: {
    webView2: platform === 'win32' ? { version: detectedWebView2Version, check: webView2 } : null,
    wkWebView: macosRuntime(),
    webKitWebDriver: platform === 'linux' ? findExecutable('WebKitWebDriver') : null,
    tauriDriver: findExecutable('tauri-driver'),
    chromeDriver: platform === 'linux' ? findExecutable('chromedriver') : null,
  },
  webdriver: { provider: 'embedded', wdio },
};

const allChecks = [linuxLibraries, webView2, display, wdio, platformSupport];

if (wantsJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`Varve desktop preflight: ${platform}/${process.arch}`);
  if (!platformSupport.ok) {
    for (const issue of platformSupport.issues) console.log(`ERROR: ${issue}`);
  }
  console.log(`GUI: ${display.ok ? 'available' : 'unavailable'}`);
  if (!display.ok && xvfbCheck.ok) {
    console.log(
      `Xvfb available (${xvfbCheck.available}) — wrap commands with xvfb-run for headless GUI tests`,
    );
  }
  for (const issue of linuxLibraries.issues) console.log(`ERROR: ${issue}`);
  for (const issue of display.issues) console.log(`ERROR: ${issue}`);
  for (const issue of wdio.issues) console.log(`ERROR: ${issue}`);
  if (platform === 'linux') console.log(`Linux setup: ${report.linux.installHint}`);
  if (display.remediation) console.log(`Display remediation: ${display.remediation}`);
  if (wdio.remediation) console.log(`WDIO remediation: ${wdio.remediation}`);
}

if (!allChecks.every((check) => check.ok)) process.exitCode = 1;
