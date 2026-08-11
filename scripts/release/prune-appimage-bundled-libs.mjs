#!/usr/bin/env node
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
 * only stops Tauri's own webkit copy and the gstreamer plugin, while
 * linuxdeploy-plugin-gtk still bundles the full stack via ldd analysis
 * (see tauri-bundler linuxdeploy.rs: --plugin gtk is unconditional).
 * `WEBKIT_DISABLE_DMABUF_RENDERER=1` (the v0.1.0 workaround) is not
 * sufficient either: the EGL display creation failure happens before the
 * renderer selection.
 *
 * The fix: delete the bundled libraries from the AppImage payload and
 * re-assemble it with linuxdeploy's own AppImage output plugin, excluding
 * the entire shared-library closure (`--exclude-library '*'`), so the
 * AppImage carries only the binary, resources, icons and desktop files.
 * The binary resolves every library from the host (verified: `ldd` reports
 * zero unresolved), so the AppImage then behaves exactly like the .deb —
 * which works on every tested distribution. Trade-off: the AppImage now
 * requires the host to provide libwebkit2gtk-4.1, libgtk-3, GStreamer and
 * Mesa — the same system packages the .deb depends on. That is documented
 * on the download page; a silent white screen is worse than a declared
 * dependency.
 *
 * Runs after `tauri build` on the Linux bundle directory, before collection.
 * Safe and idempotent: operates on the produced AppImage payload only.
 *
 *   node scripts/release/prune-appimage-bundled-libs.mjs \
 *     --bundle-dir apps/desktop/src-tauri/target/release/bundle \
 *     [--tools-dir ~/.cache/tauri]
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

function findTool(toolsDir, names) {
  for (const name of names) {
    const p = join(toolsDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(args['bundle-dir'] ?? 'apps/desktop/src-tauri/target/release/bundle');
  const toolsDir =
    args['tools-dir'] ?? process.env.TAURI_CACHE_DIR ?? join(homedir(), '.cache', 'tauri');
  const appImage = findAppImage(bundleDir);
  if (!appImage) {
    process.stdout.write('No AppImage found — nothing to prune.\n');
    return;
  }

  const appImageDir = join(bundleDir, 'appimage');
  const appImagePath = join(appImageDir, appImage);
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
    // Remove the entire library tree (files, symlinks AND subdirectories
    // such as usr/lib/x86_64-linux-gnu/gtk-3.0/*): every library the binary
    // needs resolves from the host (validated with ldd on v0.1.1), and a
    // leftover module .so makes linuxdeploy re-deploy dependencies and fail
    // on libs the CI host does not have.
    rmSync(dir, { recursive: true, force: true });
    removed += 1;
  }

  if (removed === 0) {
    rmSync(work, { recursive: true, force: true });
    process.stdout.write('No bundled libraries to prune.\n');
    return;
  }

  // Re-assemble with linuxdeploy + its AppImage output plugin — the same
  // toolchain Tauri used to build the original. A hand-rolled
  // runtime + mksquashfs concatenation produces an invalid ELF (the runtime
  // reads its squashfs offset from an ELF section, not by scanning for
  // "hsqs" — verified 2026-08-11 with a segfaulting repack). Excluding the
  // whole library closure keeps linuxdeploy from re-deploying the CI host's
  // GTK/WebKit (which would recreate the broken bundle).
  const linuxdeploy =
    findTool(toolsDir, ['linuxdeploy-x86_64.AppImage', 'linuxdeploy.AppImage']) ??
    process.env.LINUXDEPLOY;
  if (!linuxdeploy) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(
      `linuxdeploy not found in ${toolsDir}. Pass --tools-dir or set LINUXDEPLOY. ` +
        'Tauri downloads it to ~/.cache/tauri during the build.',
    );
  }
  const pluginAppImage = findTool(toolsDir, ['linuxdeploy-plugin-appimage-x86_64.AppImage']);
  if (pluginAppImage) {
    process.env.LINUXDEPLOY_PLUGIN_APPIMAGE = pluginAppImage;
  }

  const output = join(appImageDir, appImage);
  rmSync(output, { force: true });
  execFileSync(
    linuxdeploy,
    [
      '--appimage-extract-and-run',
      '--appdir',
      squashfsRoot,
      '--exclude-library',
      '*',
      '--output',
      'appimage',
    ],
    { cwd: work, env: { ...process.env, OUTPUT: output, ARCH: 'x86_64' }, stdio: 'inherit' },
  );

  if (!existsSync(output) || statSync(output).size === 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error('linuxdeploy did not produce the pruned AppImage.');
  }
  chmodSync(output, 0o755);

  const prunedSize = statSync(output).size;
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(
    `Pruned ${removed} bundled libraries and re-assembled ${appImage} (${(prunedSize / 1e6).toFixed(1)} MB). ` +
      'AppImage now uses host WebKit/GTK/GStreamer/Mesa — see module doc.\n',
  );
}

main();
