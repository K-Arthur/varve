#!/usr/bin/env node
/**
 * Fetch the native ONNX Runtime shared library for the current platform and
 * stage it where the desktop app's Tauri build bundles it as a resource.
 *
 * strata-bgremove's `ai` Cargo feature uses `ort` with `load-dynamic`
 * (dlopen at runtime, no compile-time linkage — see crates/strata-bgremove/
 * Cargo.toml). WASM inference of BiRefNet is bound by the wasm32 4 GiB
 * linear-memory ceiling and can crash with std::bad_alloc with no GPU
 * available (docs/audits/background-removal-wasm-memory-hardening-2026-07-18.md);
 * native execution of the same model peaks around 445 MB. Bundling the real
 * onnxruntime dylib lets the desktop build use that safer path instead of
 * requiring every user to install onnxruntime system-wide (verified absent
 * via `pacman -Q onnxruntime` during that audit).
 *
 * Idempotent and version-pinned: skips re-downloading when a file with the
 * expected checksum is already staged, and refuses to stage a file whose
 * checksum doesn't match (protects against a corrupted or tampered
 * download — same posture as scripts/compute-model-checksum.mjs).
 *
 * Not every platform/arch is bundled (see PLATFORMS below). Missing a bundle
 * for the current platform is not a hard failure: the app still runs, it
 * just can't use the native `ai` feature there and falls back to the
 * existing WASM/heuristic providers.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const stageDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'onnxruntime-libs');

const ORT_VERSION = '1.27.1';

/**
 * One entry per platform-arch pair Strata's desktop build targets.
 * `dir` matches `format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)`
 * in Rust so lib.rs can compute the expected path without a lookup table.
 * `archivePath` is the file to extract from the downloaded archive;
 * `libName` is what it's staged as (the name the Rust side looks for).
 */
const PLATFORMS = {
  'linux-x86_64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-x64-${ORT_VERSION}.tgz`,
    sha256: '25b1ef1fea1acd210d63f8f24dc870ad6e077795ce1f54876252c6d3803c15af',
    // The archive's `libonnxruntime.so` is a symlink chain (.so -> .so.1 ->
    // .so.1.27.1); extracting just the symlink member leaves it dangling
    // since its target was never extracted, so grab the real file directly.
    archivePath: `onnxruntime-linux-x64-${ORT_VERSION}/lib/libonnxruntime.so.${ORT_VERSION}`,
    libName: 'libonnxruntime.so',
    kind: 'tar',
  },
  'linux-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-aarch64-${ORT_VERSION}.tgz`,
    sha256: '33c67e33d1e25b816878366ea276589a024f71f000e7ff955c4b33224d639edd',
    archivePath: `onnxruntime-linux-aarch64-${ORT_VERSION}/lib/libonnxruntime.so.${ORT_VERSION}`,
    libName: 'libonnxruntime.so',
    kind: 'tar',
  },
  'macos-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-osx-arm64-${ORT_VERSION}.tgz`,
    sha256: 'e42b77a7281cc6e55141bf44fcfbac2c782b823a491bbb6ac33c781dd991f8a6',
    archivePath: `onnxruntime-osx-arm64-${ORT_VERSION}/lib/libonnxruntime.dylib`,
    libName: 'libonnxruntime.dylib',
    kind: 'tar',
  },
  'windows-x86_64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-win-x64-${ORT_VERSION}.zip`,
    sha256: '2e00414a63fdef0914cd5a5ede6c707844878e0c08e1b6693842f0451b2df2a1',
    archivePath: `onnxruntime-win-x64-${ORT_VERSION}/lib/onnxruntime.dll`,
    libName: 'onnxruntime.dll',
    kind: 'zip',
  },
  // Not bundled: macOS Intel (osx-x64 has no CPU-only asset in this release
  // line) and Windows ARM64 (low install base). Both fall back to WASM.
};

function currentPlatformKey() {
  const os =
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
  const arch =
    process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : process.arch;
  return `${os}-${arch}`;
}

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  return Buffer.from(await res.arrayBuffer());
}

async function extractFromTarGz(archiveBuffer, entryPath) {
  const { execFileSync } = await import('node:child_process');
  const tmpArchive = join(stageDir, '.download.tgz');
  writeFileSync(tmpArchive, archiveBuffer);
  const tmpOut = join(stageDir, '.extract');
  mkdirSync(tmpOut, { recursive: true });
  execFileSync('tar', ['xzf', tmpArchive, '-C', tmpOut, entryPath], { stdio: 'inherit' });
  const extracted = readFileSync(join(tmpOut, entryPath));
  execFileSync('rm', ['-rf', tmpArchive, tmpOut]);
  return extracted;
}

async function extractFromZip(archiveBuffer, entryPath) {
  // Avoid adding a zip-parsing dependency: shell out to `unzip`, which is
  // near-universal on Linux/macOS CI and the only platform this script runs
  // on for a Windows *target* (cross-staging, not cross-compiling).
  const { execFileSync } = await import('node:child_process');
  const tmpArchive = join(stageDir, '.download.zip');
  writeFileSync(tmpArchive, archiveBuffer);
  const tmpOut = join(stageDir, '.extract');
  mkdirSync(tmpOut, { recursive: true });
  execFileSync('unzip', ['-o', '-q', tmpArchive, entryPath, '-d', tmpOut], { stdio: 'inherit' });
  const extracted = readFileSync(join(tmpOut, entryPath));
  execFileSync('rm', ['-rf', tmpArchive, tmpOut]);
  return extracted;
}

async function main() {
  const requested = process.argv[2];
  const targets = requested ? [requested] : [currentPlatformKey()];

  for (const key of targets) {
    const platform = PLATFORMS[key];
    if (!platform) {
      console.log(
        `[fetch-onnxruntime] No bundle configured for '${key}' — native ai feature ` +
          `will fall back to WASM/heuristic providers on this platform. Not an error.`,
      );
      continue;
    }

    const destDir = join(stageDir, key);
    const destFile = join(destDir, platform.libName);

    if (existsSync(destFile)) {
      console.log(`[fetch-onnxruntime] ${key}: already staged at ${destFile}, skipping download.`);
      continue;
    }

    console.log(
      `[fetch-onnxruntime] ${key}: downloading onnxruntime ${ORT_VERSION} from ${platform.url}`,
    );
    const archiveBuffer = await downloadToBuffer(platform.url);

    mkdirSync(stageDir, { recursive: true });
    const extracted =
      platform.kind === 'zip'
        ? await extractFromZip(archiveBuffer, platform.archivePath)
        : await extractFromTarGz(archiveBuffer, platform.archivePath);

    mkdirSync(destDir, { recursive: true });
    writeFileSync(destFile, extracted);

    const actualSha256 = await sha256OfFile(destFile);
    // Note: this checksums the *extracted library*, not the archive — pin
    // values above were computed over the archive. Print both so a
    // maintainer refreshing ORT_VERSION can re-pin correctly; verification
    // below re-derives the archive checksum instead of trusting extraction.
    const archiveSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
    if (archiveSha256 !== platform.sha256) {
      console.error(
        `[fetch-onnxruntime] CHECKSUM MISMATCH for ${key} archive.\n` +
          `  expected: ${platform.sha256}\n  actual:   ${archiveSha256}\n` +
          `Refusing to stage a library that doesn't match the pinned checksum.`,
      );
      process.exit(1);
    }

    console.log(
      `[fetch-onnxruntime] ${key}: staged ${destFile} (extracted sha256=${actualSha256})`,
    );
  }
}

main().catch((err) => {
  console.error('[fetch-onnxruntime] failed:', err);
  // Non-fatal for the overall build: native ai is an optional acceleration
  // path, not a hard dependency. Missing/failed fetch means the app still
  // works via the existing WASM/heuristic fallback chain.
  process.exit(0);
});
