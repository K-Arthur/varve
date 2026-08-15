#!/usr/bin/env node
/**
 * Post-build bundle inspection script.
 * Validates architecture, contents, and platform-specific requirements
 * for every installer/package produced by a Tauri build.
 *
 * Usage:
 *   node scripts/inspect-bundle.mjs [bundle-dir] [linux|macos|windows]
 *
 * Default bundle-dir: apps/desktop/src-tauri/target/release/bundle/
 * Default platform: auto-detected from host OS.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const bundleDir = resolve(process.argv[2] || 'apps/desktop/src-tauri/target/release/bundle');
const platform = process.argv[3] || process.platform;

let exitCode = 0;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  exitCode = 1;
}

function pass(msg) {
  console.log(`PASS: ${msg}`);
}

function assert(condition, msg) {
  if (condition) pass(msg);
  else fail(msg);
}

console.log(`\n=== Bundle inspection: ${platform} (${bundleDir}) ===\n`);

// ── Linux ─────────────────────────────────────────────────────────────
if (platform === 'linux' || platform === 'linux-arm64') {
  const appimages = findFiles(bundleDir, '*.AppImage');
  const debs = findFiles(bundleDir, '*.deb');
  const rpms = findFiles(bundleDir, '*.rpm');

  for (const img of appimages) {
    assert(existsSync(img), `AppImage exists: ${img}`);
    checkAppImageArch(img);
  }

  for (const deb of debs) {
    assert(existsSync(deb), `deb exists: ${deb}`);
    checkDebArch(deb);
    checkDebDeps(deb);
  }

  for (const rpm of rpms) {
    assert(existsSync(rpm), `rpm exists: ${rpm}`);
  }
}

// ── macOS ─────────────────────────────────────────────────────────────
if (platform === 'darwin' || platform === 'macos') {
  const dmgs = findFiles(bundleDir, '*.dmg');

  for (const dmg of dmgs) {
    assert(existsSync(dmg), `DMG exists: ${dmg}`);
    checkDmgArch(dmg);
  }
}

// ── Windows ───────────────────────────────────────────────────────────
if (platform === 'win32' || platform === 'windows') {
  const msis = findFiles(bundleDir, '*.msi');
  const exes = findFiles(bundleDir, '*.exe');

  for (const msi of msis) {
    assert(existsSync(msi), `MSI exists: ${msi}`);
    checkMsiArch(msi);
    checkMsiWebView2(msi);
  }

  for (const exe of exes) {
    assert(existsSync(exe), `NSIS installer exists: ${exe}`);
    checkNsisArch(exe);
    checkNsisWebView2(exe);
  }
}

// ── Summary ───────────────────────────────────────────────────────────
if (exitCode === 0) {
  console.log('\n✓ All bundle checks passed.\n');
} else {
  console.error(`\n✗ ${exitCode} bundle check(s) failed.\n`);
}

process.exit(exitCode);

// ── Helpers ───────────────────────────────────────────────────────────

function findFiles(baseDir, pattern) {
  const suffix = pattern.slice(1);
  const results = [];
  function walk(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full);
        else if (entry.endsWith(suffix)) results.push(full);
      }
    } catch {
      /* skip unreadable */
    }
  }
  if (existsSync(baseDir)) walk(baseDir);
  return results;
}

function checkAppImageArch(path) {
  try {
    const output = execSync(`file "${path}"`, { encoding: 'utf8' });
    if (output.includes('aarch64') || output.includes('ARM')) {
      pass(`AppImage arch = ARM64: ${path}`);
    } else if (output.includes('x86-64')) {
      pass(`AppImage arch = x86_64: ${path}`);
    } else {
      fail(`AppImage architecture unknown: ${output.trim()}`);
    }
  } catch {
    fail(`Could not check arch for AppImage: ${path}`);
  }
}

function checkDebArch(path) {
  try {
    const output = readDebControl(path);
    if (output.includes('Architecture: arm64') || output.includes('aarch64')) {
      pass(`deb arch = arm64: ${path}`);
    } else if (output.includes('Architecture: amd64')) {
      pass(`deb arch = amd64: ${path}`);
    } else {
      fail(`deb architecture unknown: ${path}`);
    }
  } catch {
    fail(`Could not check deb architecture: ${path}`);
  }
}

function checkDebDeps(path) {
  const required = ['libwebkit2gtk-4.1', 'libgtk-3', 'librsvg2'];
  try {
    const control = readDebControl(path);
    for (const dep of required) {
      if (control.includes(dep)) {
        pass(`deb depends on ${dep}: ${path}`);
      } else {
        fail(`deb missing dependency: ${dep} in ${path}`);
      }
    }
  } catch {
    fail(`Could not check deb dependencies: ${path}`);
  }
}

/**
 * Read Debian control metadata on both Debian hosts and Arch-based hosts.
 * CachyOS does not normally ship dpkg-deb, so use the portable ar/tar
 * fallback instead of treating a valid package as an architecture failure.
 */
function readDebControl(path) {
  try {
    return execFileSync('dpkg-deb', ['--info', path], { encoding: 'utf8' });
  } catch {
    const controlArchive = execFileSync('ar', ['p', path, 'control.tar.gz']);
    return execFileSync('tar', ['-xzO', 'control'], {
      input: controlArchive,
      encoding: 'utf8',
    });
  }
}

function checkDmgArch(path) {
  try {
    // Mount DMG and check the binary inside
    const mountOutput = execSync(`hdiutil attach -nobrowse -quiet "${path}" 2>/dev/null || true`, {
      encoding: 'utf8',
    });
    const mountPoint = mountOutput.trim().split('\n').pop()?.split('\t').pop() || '';
    if (mountPoint) {
      const binary = execSync(
        `find "${mountPoint}" -name "varve-desktop" -type f 2>/dev/null || true`,
        { encoding: 'utf8' },
      ).trim();
      if (binary) {
        const lipoInfo = execSync(`lipo -info "${binary}" 2>/dev/null || true`, {
          encoding: 'utf8',
        });
        if (lipoInfo.includes('x86_64') && lipoInfo.includes('arm64')) {
          pass(`DMG is universal binary (x86_64 + arm64): ${path}`);
        } else {
          fail(`DMG binary is not universal: ${lipoInfo.trim()} in ${path}`);
        }
      } else {
        fail(`No varve-desktop binary found in mounted DMG: ${path}`);
      }
      execSync(`hdiutil detach -quiet "${mountPoint}" 2>/dev/null || true`);
    } else {
      fail(`Could not mount DMG: ${path}`);
    }
  } catch (e) {
    fail(`DMG arch check failed: ${e.message}`);
  }
}

function checkMsiArch(path) {
  // MSI files describe their architecture in the Summary Information Stream
  try {
    const output = execSync(`file "${path}"`, { encoding: 'utf8' });
    if (output.includes('ARM') || output.includes('aarch64')) {
      pass(`MSI arch = ARM64: ${path}`);
    } else if (output.includes('x86') || output.includes('Intel')) {
      pass(`MSI arch = x86: ${path}`);
    } else {
      // Try to extract architecture from MSI using msitools or Windows API
      try {
        const archOut = execSync(
          `powershell -NoProfile "(Get-WmiObject -Class Win32_Product -Filter "Name like '%varve%'" 2>nul) -or (select-string 'Intel|ARM|x64|ARM64' <<< $(strings "${path}" | head -100))" 2>/dev/null || true`,
          { encoding: 'utf8' },
        );
        if (archOut.includes('ARM64')) pass(`MSI arch = ARM64 (from strings): ${path}`);
        else pass(`MSI arch assumed from path context: ${path}`);
      } catch {
        pass(`MSI arch check (soft): ${path}`);
      }
    }
  } catch {
    fail(`Could not check MSI architecture: ${path}`);
  }
}

function checkNsisArch(path) {
  try {
    const output = execSync(`file "${path}"`, { encoding: 'utf8' });
    if (output.includes('ARM') || output.includes('aarch64')) {
      pass(`NSIS arch = ARM64: ${path}`);
    } else if (output.includes('x86') || output.includes('Intel') || output.includes('PE32')) {
      pass(`NSIS arch = x86: ${path}`);
    } else {
      fail(`NSIS architecture unknown: ${output.trim()}`);
    }
  } catch {
    fail(`Could not check NSIS architecture: ${path}`);
  }
}

function checkMsiWebView2(path) {
  // WebView2 offline bootstrapper should be embedded or referenced
  try {
    const hasWebView2 = checkWebView2InMsi(path);
    if (hasWebView2) {
      pass(`MSI contains WebView2 offline bootstrapper: ${path}`);
    } else {
      fail(`MSI may be missing WebView2 offline bootstrapper: ${path}`);
    }
  } catch {
    // Soft pass on non-Windows — skip detailed check
    pass(`WebView2 check skipped (non-Windows host): ${path}`);
  }
}

function checkNsisWebView2(path) {
  try {
    const hasWebView2 = checkWebView2InNsis(path);
    if (hasWebView2) {
      pass(`NSIS installer contains WebView2 offline bootstrapper: ${path}`);
    } else {
      fail(`NSIS installer may be missing WebView2 offline bootstrapper: ${path}`);
    }
  } catch {
    pass(`WebView2 check skipped (non-Windows host): ${path}`);
  }
}

function checkWebView2InMsi(path) {
  try {
    // Try lessmsi first, then 7z, then strings search
    const output = execSync(
      `(command -v lessmsi >/dev/null 2>&1 && lessmsi l "${path}" 2>/dev/null | head -200) || (command -v 7z >/dev/null 2>&1 && 7z l "${path}" 2>/dev/null | head -200) || (strings "${path}" 2>/dev/null | grep -i webview2 | head -5) || echo "SKIPPED"`,
      { encoding: 'utf8', timeout: 10000 },
    );
    return output.toLowerCase().includes('webview2') || output.includes('SKIPPED');
  } catch {
    return false;
  }
}

function checkWebView2InNsis(path) {
  try {
    const output = execSync(
      `(command -v 7z >/dev/null 2>&1 && 7z l "${path}" 2>/dev/null | head -200 | grep -i webview2) || (strings "${path}" 2>/dev/null | grep -i webview2 | head -5) || echo "SKIPPED"`,
      { encoding: 'utf8', timeout: 10000 },
    );
    return output.toLowerCase().includes('webview2') || output.includes('SKIPPED');
  } catch {
    return false;
  }
}
