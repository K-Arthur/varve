#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
/**
 * Remove the bundled WebKit/GTK/GStreamer library stack from the AppImage.
 *
 * Why this exists (measured 2026-08-11, v0.1.1):
 *
 * Tauri's AppImage pipeline runs linuxdeploy-plugin-gtk, which bundles the
 * whole GTK/WebKit/GStreamer dependency closure built on the CI baseline
 * (ubuntu-22.04). That closure carries an EGL implementation ABI from the
 * build host; on distributions with a newer Mesa/EGL stack (Arch, CachyOS,
 * Fedora 40+, Ubuntu 24.04) the bundled WebKitWebProcess fails at startup:
 *
 *     Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...
 *
 * The web process dies, the window stays open and blank — the documented
 * "white screen". `bundleMediaFramework: false` does NOT prevent this: it
 * only stops Tauri's own webkit copy, while linuxdeploy-plugin-gtk still
 * bundles the full stack via ldd analysis. `WEBKIT_DISABLE_DMABUF_RENDERER=1`
 * (the v0.1.0 workaround) is not sufficient either: the EGL display
 * creation failure happens before the renderer selection.
 *
 * The fix: delete the bundled libraries from the AppImage payload. The
 * binary resolves every library from the host (verified: `ldd` reports zero
 * unresolved), so the AppImage then behaves exactly like the .deb — which
 * works on every tested distribution. Trade-off: the AppImage now requires
 * the host to provide libwebkit2gtk-4.1, libgtk-3, GStreamer and Mesa —
 * the same system packages the .deb depends on. That is documented on the
 * download page; a silent white screen is worse than a declared dependency.
 *
 * Runs after `tauri build` on the Linux bundle directory, before collection.
 * Safe and idempotent: operates on the produced AppImage payload only.
 *
 *   node scripts/release/prune-appimage-bundled-libs.mjs \
 *     --bundle-dir apps/desktop/src-tauri/target/release/bundle
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function findAppImage(bundleDir) {
  const appImageDir = join(bundleDir, 'appimage');
  if (!existsSync(appImageDir)) return null;
  return readdirSync(appImageDir).find((f) => f.endsWith('.AppImage'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = args['bundle-dir'] ?? 'apps/desktop/src-tauri/target/release/bundle';
  const appImage = findAppImage(bundleDir);
  if (!appImage) {
    process.stdout.write('No AppImage found — nothing to prune.\n');
    return;
  }

  // Resolve to an absolute path: execFileSync with `cwd` set resolves a
  // relative command against the cwd (here: the temp dir), so the AppImage
  // would not be found even though it exists relative to the repo root.
  const appImagePath = resolve(join(bundleDir, 'appimage', appImage));
  const work = mkdtempSync(join(tmpdir(), 'varve-appimage-prune-'));
  const squashfsRoot = join(work, 'squashfs-root');

  process.stdout.write(`Pruning bundled libraries from ${appImage}...\n`);

  // Extract the AppImage payload. NOTE: the runtime's
  // `--appimage-extract <dir>` form silently creates an empty dir in some
  // versions; the no-arg form extracts to ./squashfs-root reliably.
  execFileSync(appImagePath, ['--appimage-extract'], { cwd: work, stdio: 'pipe' });

  const libDirs = [join(squashfsRoot, 'usr', 'lib'), join(squashfsRoot, 'usr', 'lib64')];
  let removed = 0;
  for (const dir of libDirs) {
    if (!existsSync(dir)) continue;
    // Keep nothing under usr/lib: every library the binary needs resolves
    // from the host (validated with ldd on v0.1.1). Empty module dirs are
    // harmless and left in place.
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() || entry.isSymbolicLink()) {
        rmSync(join(dir, entry.name), { force: true });
        removed += 1;
      }
    }
  }

  if (removed === 0) {
    rmSync(work, { recursive: true, force: true });
    process.stdout.write('No bundled libraries to prune.\n');
    return;
  }

  // Repack: a type-2 AppImage is a runtime ELF prepended to a squashfs.
  // Split the original at the squashfs magic ("hsqs") and concatenate the
  // runtime with a fresh squashfs of the pruned payload.
  const original = readFileSync(appImagePath);
  const magicIndex = original.indexOf(Buffer.from('hsqs'));
  if (magicIndex <= 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error('Cannot locate squashfs payload in AppImage (unexpected format).');
  }
  const runtime = original.subarray(0, magicIndex);
  const runtimePath = join(work, 'runtime');
  writeFileSync(runtimePath, runtime);
  chmodSync(runtimePath, 0o755);

  const newSquash = join(work, 'varve.squashfs');
  execFileSync(
    'mksquashfs',
    [squashfsRoot, newSquash, '-noappend', '-comp', 'gzip', '-root-owned'],
    { stdio: 'inherit' },
  );

  const output = resolve(join(bundleDir, 'appimage', appImage));
  writeFileSync(output, Buffer.concat([runtime, readFileSync(newSquash)]));
  chmodSync(output, 0o755);

  const prunedSize = statSync(output).size;
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(
    `Pruned ${removed} bundled libraries and repacked ${appImage} (${(prunedSize / 1e6).toFixed(1)} MB). ` +
      'AppImage now uses host WebKit/GTK/GStreamer/Mesa — see module doc.\n',
  );
}

main();
