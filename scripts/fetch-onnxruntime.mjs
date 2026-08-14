#!/usr/bin/env node
/**
 * Fetch the native ONNX Runtime shared library for the current platform and
 * stage it where the desktop app's Tauri build bundles it as a resource.
 *
 * varve-bgremove's `ai` Cargo feature uses `ort` with `load-dynamic`
 * (dlopen at runtime, no compile-time linkage — see crates/varve-bgremove/
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentTargetId, normalizeTargetId } from './release/targets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const stageDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'onnxruntime-libs');

const FETCH_TIMEOUT_MS = 120_000;

const ORT_VERSION = '1.27.1';

/**
 * One entry per platform-arch pair Varve's desktop build targets.
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
  'windows-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-win-arm64-${ORT_VERSION}.zip`,
    sha256: '6e22c2061ba6400b42a59663d700c8694e4e8fe654cf452c4700c24237407ae1',
    archivePath: `onnxruntime-win-arm64-${ORT_VERSION}/lib/onnxruntime.dll`,
    libName: 'onnxruntime.dll',
    kind: 'zip',
  },
  // Not bundled: macOS Intel (osx-x64 has no CPU-only asset in this release
  // line). It remains outside the supported release target registry.
};

function currentPlatformKey() {
  return currentTargetId();
}

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function downloadToBuffer(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Download failed: HTTP ${res.status} ${res.statusText} (${url})\n${body ? `  Response body: ${body.slice(0, 500)}` : ''}`,
      );
    }
    const contentLength = res.headers.get('content-length');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error(`Download produced zero-byte file: ${url}`);
    }
    if (contentLength && buffer.length !== parseInt(contentLength, 10)) {
      throw new Error(
        `Download size mismatch: expected ${contentLength} bytes, got ${buffer.length} (${url})`,
      );
    }
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromTarGz(archiveBuffer, entryPath) {
  const { execFileSync } = await import('node:child_process');
  const tmpDir = join(stageDir, `.tmp-extract-${process.pid}`);
  const tmpArchive = join(tmpDir, 'archive.tgz');
  const tmpOut = join(tmpDir, 'out');
  try {
    mkdirSync(tmpOut, { recursive: true });
    writeFileSync(tmpArchive, archiveBuffer);
    execFileSync('tar', ['xzf', tmpArchive, '-C', tmpOut, entryPath], {
      stdio: 'pipe',
      timeout: 30_000,
    });
    const extractedPath = join(tmpOut, entryPath);
    if (!existsSync(extractedPath)) {
      throw new Error(`tar extraction succeeded but expected file not found: ${entryPath}`);
    }
    const extracted = readFileSync(extractedPath);
    if (extracted.length === 0) {
      throw new Error(`Extracted file is empty: ${entryPath}`);
    }
    return extracted;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function extractFromZip(archiveBuffer, entryPath) {
  const { execFileSync } = await import('node:child_process');
  const tmpDir = join(stageDir, `.tmp-extract-${process.pid}`);
  const tmpArchive = join(tmpDir, 'archive.zip');
  const tmpOut = join(tmpDir, 'out');
  try {
    mkdirSync(tmpOut, { recursive: true });
    writeFileSync(tmpArchive, archiveBuffer);
    execFileSync('unzip', ['-o', '-q', tmpArchive, entryPath, '-d', tmpOut], {
      stdio: 'pipe',
      timeout: 30_000,
    });
    const extractedPath = join(tmpOut, entryPath);
    if (!existsSync(extractedPath)) {
      throw new Error(`unzip succeeded but expected file not found: ${entryPath}`);
    }
    const extracted = readFileSync(extractedPath);
    if (extracted.length === 0) {
      throw new Error(`Extracted file is empty: ${entryPath}`);
    }
    return extracted;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const requested = process.argv[2];
  const targets = requested ? [normalizeTargetId(requested)] : [currentPlatformKey()];

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
      const existingSize = readFileSync(destFile).length;
      if (existingSize === 0) {
        console.error(`[fetch-onnxruntime] ${key}: existing staged file is empty, re-downloading.`);
        rmSync(destFile);
      } else {
        console.log(
          `[fetch-onnxruntime] ${key}: already staged at ${destFile}, skipping download.`,
        );
        continue;
      }
    }

    console.log(
      `[fetch-onnxruntime] ${key}: downloading onnxruntime ${ORT_VERSION} from ${platform.url}`,
    );
    const archiveBuffer = await downloadToBuffer(platform.url);

    // Verify BEFORE extracting. The previous order downloaded, ran tar/unzip on
    // the bytes, wrote the library to disk, and only then compared checksums —
    // so an attacker able to substitute the archive got a decompressor invoked
    // on their input before anything was checked. Archive parsers are exactly
    // the kind of C code you do not want reached by unverified data, and the
    // check costs nothing where it is now.
    const archiveSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
    if (archiveSha256 !== platform.sha256) {
      console.error(
        `[fetch-onnxruntime] CHECKSUM MISMATCH for ${key} archive.\n` +
          `  expected: ${platform.sha256}\n  actual:   ${archiveSha256}\n` +
          `Refusing to extract an archive that doesn't match the pinned checksum.`,
      );
      process.exit(1);
    }

    mkdirSync(stageDir, { recursive: true });
    const extracted =
      platform.kind === 'zip'
        ? await extractFromZip(archiveBuffer, platform.archivePath)
        : await extractFromTarGz(archiveBuffer, platform.archivePath);

    mkdirSync(destDir, { recursive: true });
    writeFileSync(destFile, extracted);

    const actualSha256 = await sha256OfFile(destFile);

    console.log(
      `[fetch-onnxruntime] ${key}: staged ${destFile} (extracted sha256=${actualSha256})`,
    );
  }
}

main().catch((err) => {
  console.error('[fetch-onnxruntime] FATAL:', err);
  process.exit(1);
});
