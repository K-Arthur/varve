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
 * Resource preservation (fixed 2026-09-12): Tauri installs `bundle.resources`
 * under `usr/lib/<productName>/` in the AppDir — the same tree as the system
 * libraries. The original implementation removed `usr/lib` and `usr/lib64`
 * wholesale, which also deleted `usr/lib/Varve/onnxruntime-libs/<os>-<arch>/
 * libonnxruntime.so` (and the generative helper). v0.2.1's published
 * AppImages therefore shipped without the native ONNX Runtime even though the
 * .deb and .rpm carried it. The prune plan now keeps the product's resource
 * directory and removes only the library entries around it.
 *
 * Runs after `tauri build` on the Linux bundle directory, before collection.
 * Safe and idempotent: operates on the produced AppImage payload only.
 *
 *   node scripts/release/prune-appimage-bundled-libs.mjs \
 *     --bundle-dir apps/desktop/src-tauri/target/release/bundle \
 *     [--tools-dir ~/.cache/tauri]
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeArchitecture, normalizeTargetId, targetIdFor } from './targets.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TAURI_CONF = join(REPO_ROOT, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');

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

/**
 * Tauri installs `bundle.resources` under `usr/lib/<productName>/` on Linux
 * (verified against the v0.2.1 .deb: `/usr/lib/Varve/onnxruntime-libs/...`).
 * The AppImage uses the same AppDir layout, so the product name is also the
 * resource directory name there.
 */
export function resolveLinuxResourceDirName(tauriConfPath = TAURI_CONF) {
  if (!existsSync(tauriConfPath)) return null;
  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  return typeof conf.productName === 'string' && conf.productName.length > 0
    ? conf.productName
    : null;
}

/**
 * Decide which entries under `usr/lib`/`usr/lib64` to remove and which to
 * keep. Everything in those trees is a bundled system library except the
 * product's own resource directory, which holds Tauri resources such as the
 * native ONNX Runtime and the generative helper.
 */
export function collectPrunePlan(squashfsRoot, resourceDirName) {
  const remove = [];
  const keep = [];
  for (const dirName of ['lib', 'lib64']) {
    const dir = join(squashfsRoot, 'usr', dirName);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (dirName === 'lib' && resourceDirName && entry === resourceDirName) {
        keep.push(full);
      } else {
        remove.push(full);
      }
    }
  }
  return { remove, keep };
}

/**
 * Tauri can reuse an existing AppDir. Pruning the source staging directory
 * before a later build therefore does not remove foreign runtimes already
 * copied into usr/lib/<productName>/onnxruntime-libs. Keep only the runtime
 * for the Linux target being packaged; unknown resource directories are left
 * untouched so this cleanup cannot delete a future, unregistered artifact.
 */
export function collectRuntimePrunePlan(runtimeRoot, targetId) {
  if (!existsSync(runtimeRoot)) return { remove: [], keep: [] };

  const remove = [];
  const keep = [];
  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let normalized;
    try {
      normalized = normalizeTargetId(entry.name);
    } catch {
      continue;
    }
    const full = join(runtimeRoot, entry.name);
    if (normalized === targetId) keep.push(full);
    else remove.push(full);
  }
  return { remove, keep };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(args['bundle-dir'] ?? 'apps/desktop/src-tauri/target/release/bundle');
  const toolsDir =
    args['tools-dir'] ?? process.env.TAURI_CACHE_DIR ?? join(homedir(), '.cache', 'tauri');
  const architecture = normalizeArchitecture(args.arch ?? process.arch);
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

  // Tauri resources (the bundled ONNX Runtime, the generative helper) live
  // under usr/lib/<productName> inside the same tree as the GTK/WebKit
  // closure. Remove only the library entries; keeping the resource directory
  // is what stops the AppImage from silently losing native AI.
  const resourceDirName = resolveLinuxResourceDirName();
  const { remove, keep } = collectPrunePlan(squashfsRoot, resourceDirName);
  for (const entry of remove) {
    // Files, symlinks AND subdirectories such as
    // usr/lib/x86_64-linux-gnu/gtk-3.0/*: every library the binary needs
    // resolves from the host (validated with ldd on v0.1.1), and a leftover
    // module .so makes linuxdeploy re-deploy dependencies and fail on libs
    // the CI host does not have.
    rmSync(entry, { recursive: true, force: true });
  }
  const targetId = targetIdFor('linux', architecture);
  const runtimeRoot = resourceDirName
    ? join(squashfsRoot, 'usr', 'lib', resourceDirName, 'onnxruntime-libs')
    : null;
  const runtimePlan = runtimeRoot
    ? collectRuntimePrunePlan(runtimeRoot, targetId)
    : { remove: [], keep: [] };
  for (const entry of runtimePlan.remove) {
    rmSync(entry, { recursive: true, force: true });
  }
  if (runtimePlan.remove.length > 0) {
    process.stdout.write(
      'Removing ' +
        runtimePlan.remove.length +
        ' foreign ONNX Runtime target director' +
        (runtimePlan.remove.length === 1 ? 'y' : 'ies') +
        ' from the AppImage payload.\n',
    );
  }
  const removed = remove.length;
  if (keep.length > 0) {
    process.stdout.write(
      `Preserving ${keep.length} resource directory(ies): ${keep
        .map((p) => p.slice(squashfsRoot.length + 1))
        .join(', ')}\n`,
    );
  }

  if (removed === 0 && runtimePlan.remove.length === 0) {
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
    findTool(
      toolsDir,
      architecture === 'aarch64'
        ? ['linuxdeploy-aarch64.AppImage', 'linuxdeploy.AppImage']
        : ['linuxdeploy-x86_64.AppImage', 'linuxdeploy.AppImage'],
    ) ?? process.env.LINUXDEPLOY;
  if (!linuxdeploy) {
    rmSync(work, { recursive: true, force: true });
    throw new Error(
      `linuxdeploy not found in ${toolsDir}. Pass --tools-dir or set LINUXDEPLOY. ` +
        'Tauri downloads it to ~/.cache/tauri during the build.',
    );
  }
  const pluginAppImage = findTool(toolsDir, [
    `linuxdeploy-plugin-appimage-${architecture}.AppImage`,
    'linuxdeploy-plugin-appimage-x86_64.AppImage',
  ]);
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
    { cwd: work, env: { ...process.env, OUTPUT: output, ARCH: architecture }, stdio: 'inherit' },
  );

  if (!existsSync(output) || statSync(output).size === 0) {
    rmSync(work, { recursive: true, force: true });
    throw new Error('linuxdeploy did not produce the pruned AppImage.');
  }
  chmodSync(output, 0o755);

  // Re-assembly is the step that dropped resources in the past, so verify the
  // final payload — not just the intermediate AppDir — still carries them.
  if (keep.length > 0 && resourceDirName) {
    const verifyWork = mkdtempSync(join(tmpdir(), 'varve-appimage-verify-'));
    try {
      execFileSync(output, ['--appimage-extract'], { cwd: verifyWork, stdio: 'pipe' });
      const preserved = join(verifyWork, 'squashfs-root', 'usr', 'lib', resourceDirName);
      if (!existsSync(preserved)) {
        throw new Error(
          'Pruned AppImage lost its resource directory usr/lib/' +
            resourceDirName +
            '. The native ONNX Runtime and generative helper would be missing.',
        );
      }
      const finalRuntimeRoot = join(preserved, 'onnxruntime-libs');
      const finalRuntimePlan = collectRuntimePrunePlan(finalRuntimeRoot, targetId);
      if (finalRuntimePlan.remove.length > 0) {
        throw new Error(
          'Pruned AppImage still contains foreign ONNX Runtime targets: ' +
            finalRuntimePlan.remove.map((p) => p.slice(finalRuntimeRoot.length + 1)).join(', '),
        );
      }
    } finally {
      rmSync(verifyWork, { recursive: true, force: true });
    }
  }

  const prunedSize = statSync(output).size;
  rmSync(work, { recursive: true, force: true });
  process.stdout.write(
    `Pruned ${removed} bundled library entries, removed ${runtimePlan.remove.length} foreign ` +
      `runtime directories, and re-assembled ${appImage} (${(prunedSize / 1e6).toFixed(1)} MB). ` +
      'AppImage now uses host WebKit/GTK/GStreamer/Mesa and keeps its own resources — see module doc.\n',
  );
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
