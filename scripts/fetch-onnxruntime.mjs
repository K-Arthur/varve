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
 *
 * Also stages the optional `onnxruntime-ep-webgpu` WebGPU plugin execution
 * provider (a separate wheel) on platforms where one is published. The plugin
 * is strictly optional: a missing wheel, a download failure, or a checksum
 * failure is logged and skipped, never fatal — the runtime reports
 * `artifactMissing` and falls back to the CPU execution provider (see
 * crates/varve-bgremove/src/webgpu_ep.rs).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentTargetId, normalizeTargetId } from './release/targets.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const stageDir = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'onnxruntime-libs');

const FETCH_TIMEOUT_MS = 120_000;

const ORT_VERSION = '1.27.1';

/**
 * ONNX Runtime WebGPU plugin execution provider (`onnxruntime-ep-webgpu`) —
 * a separate wheel from the core runtime. The pinned core 1.27.1 builds expose
 * the plugin execution provider API, and the plugin picks a Dawn graphics
 * backend at runtime (Vulkan on Linux, Metal on macOS, D3D12 on Windows).
 *
 * Not every target has a published wheel (Linux aarch64 and macOS x86_64 do
 * not), which is why the plugin is optional and never fatal.
 */
const WEBGPU_PLUGIN_VERSION = '0.3.0';

/** Target keys for which an `onnxruntime-ep-webgpu` wheel is published. */
const WEBGPU_PLUGIN_TARGETS = ['linux-x86_64', 'macos-aarch64', 'windows-x86_64'];

/**
 * Complete the WebGPU plugin spec with the license paths shared by every
 * wheel's `dist-info` directory. `libraryPath`/`libraryName` stay per-platform
 * because the archive member (and its staged name) differs by OS.
 */
function webgpuPluginSpec({
  url,
  sha256,
  libraryPath,
  libraryName,
  librarySha256,
  licenseSha256,
  noticesSha256,
}) {
  const distInfo = `onnxruntime_ep_webgpu-${WEBGPU_PLUGIN_VERSION}.dist-info`;
  return {
    url,
    sha256,
    libraryPath,
    libraryName,
    librarySha256,
    licensePath: `${distInfo}/licenses/LICENSE`,
    licenseName: 'LICENSE.onnxruntime-webgpu.txt',
    licenseSha256,
    noticesPath: `${distInfo}/licenses/ThirdPartyNotices.txt`,
    noticesName: 'THIRD_PARTY_NOTICES.onnxruntime-webgpu.txt',
    noticesSha256,
  };
}

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
    extractedSha256: '50e214fa23276cf2f3fb96d90d8e7ca9fc5ba29f42e298eccf3b23f7d8a81ae2',
    kind: 'tar',
    webgpuPlugin: webgpuPluginSpec({
      url: 'https://files.pythonhosted.org/packages/97/9c/d37bc05c56c3d91d44585db7bebbf0f068ece5d01df5b3898449771d4bf2/onnxruntime_ep_webgpu-0.3.0-py3-none-manylinux_2_28_x86_64.whl',
      sha256: '865ce82d80319d7f259a4a65e66e32834f0f117db55ae4377868b4f28016e7bf',
      libraryPath: 'onnxruntime_ep_webgpu/libonnxruntime_providers_webgpu.so',
      libraryName: 'libonnxruntime_providers_webgpu.so',
      librarySha256: '1139af8249c58f6b0234aafda0ed0e09137a427e4acedebce4be02d589928cac',
      licenseSha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
      noticesSha256: '53d3fa5821ac016ac24dd35775c996efec86e2ae0841e9a3a5e146c0ae916845',
    }),
  },
  'linux-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-aarch64-${ORT_VERSION}.tgz`,
    sha256: '33c67e33d1e25b816878366ea276589a024f71f000e7ff955c4b33224d639edd',
    archivePath: `onnxruntime-linux-aarch64-${ORT_VERSION}/lib/libonnxruntime.so.${ORT_VERSION}`,
    libName: 'libonnxruntime.so',
    extractedSha256: '2aede08815e740c8c1fce21af1e94353d32190127219759cc7978fb8f2de30f7',
    kind: 'tar',
  },
  'macos-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-osx-arm64-${ORT_VERSION}.tgz`,
    sha256: 'e42b77a7281cc6e55141bf44fcfbac2c782b823a491bbb6ac33c781dd991f8a6',
    archivePath: `onnxruntime-osx-arm64-${ORT_VERSION}/lib/libonnxruntime.dylib`,
    libName: 'libonnxruntime.dylib',
    extractedSha256: 'a441a94433ebf38f1918009aba0199f88c6f877251b9946d89816427839964c8',
    kind: 'tar',
    webgpuPlugin: webgpuPluginSpec({
      url: 'https://files.pythonhosted.org/packages/0f/77/cfdbe4900a5a38a8b49de9b10254e3ce77f164d246fa3126db7cb7dbc713/onnxruntime_ep_webgpu-0.3.0-py3-none-macosx_14_0_universal2.whl',
      sha256: 'facdb3ad9933cb4504c579c2085c9be1644b6912ee74d7c9a7281046d7e7155a',
      libraryPath: 'onnxruntime_ep_webgpu/libonnxruntime_providers_webgpu.dylib',
      libraryName: 'libonnxruntime_providers_webgpu.dylib',
      librarySha256: '27614b70a0e4563ac236307aa4510f216f023c3d2c07e82bd814c46f59a6e71c',
      licenseSha256: '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c',
      noticesSha256: '53d3fa5821ac016ac24dd35775c996efec86e2ae0841e9a3a5e146c0ae916845',
    }),
  },
  'windows-x86_64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-win-x64-${ORT_VERSION}.zip`,
    sha256: '2e00414a63fdef0914cd5a5ede6c707844878e0c08e1b6693842f0451b2df2a1',
    archivePath: `onnxruntime-win-x64-${ORT_VERSION}/lib/onnxruntime.dll`,
    libName: 'onnxruntime.dll',
    extractedSha256: '79df49bcbefb604c019785925daef859c0348280616364e28103d73d4152f6d7',
    kind: 'zip',
    webgpuPlugin: webgpuPluginSpec({
      url: 'https://files.pythonhosted.org/packages/84/20/f4d51697015cb1eb0fb027b19bcc8641b93144beaed4cd332979803f0a99/onnxruntime_ep_webgpu-0.3.0-py3-none-win_amd64.whl',
      sha256: 'f25ed449a8f152176a20bc9b2f959a16511f16ff0f962a37979799d1b2d56bf7',
      libraryPath: 'onnxruntime_ep_webgpu/onnxruntime_providers_webgpu.dll',
      libraryName: 'onnxruntime_providers_webgpu.dll',
      librarySha256: 'b05a6d5187885be9133ac383d5271af20b76f281e72d8bfe933f35a23d05b94f',
      licenseSha256: 'c250d6278f0b47a6439fb7592b08b58a55eb9f535aa49a1db63211c3f982b674',
      noticesSha256: '4c5b864d8974c94b37461f38163facef79a1bb5dea461667ee9e5be6a8e73f83',
    }),
  },
  'windows-aarch64': {
    url: `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-win-arm64-${ORT_VERSION}.zip`,
    sha256: '6e22c2061ba6400b42a59663d700c8694e4e8fe654cf452c4700c24237407ae1',
    archivePath: `onnxruntime-win-arm64-${ORT_VERSION}/lib/onnxruntime.dll`,
    libName: 'onnxruntime.dll',
    kind: 'zip',
  },
  // Not bundled: macOS Intel. ONNX Runtime upstream discontinued macOS
  // x86_64 binaries at v1.24.1 (2026-02); the last Intel line (1.23.0)
  // predates the pinned ORT_VERSION, carries a known macOS atexit mutex
  // crash (microsoft/onnxruntime#24579) that was fixed only after that line,
  // and will never receive another fix. GitHub's last Intel macOS runner
  // (macos-15-intel) retires Aug 2027 and macOS 27 (fall 2026) drops Intel
  // entirely — see docs/plans/macos-intel-feasibility.md.
};

function currentPlatformKey() {
  return currentTargetId();
}

async function sha256OfFile(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function stagedFileMatches(path, expectedSha256) {
  if (!existsSync(path)) return false;
  const bytes = readFileSync(path);
  if (bytes.length === 0) return false;
  return !expectedSha256 || (await sha256OfFile(path)) === expectedSha256;
}

/** Replace a staged artifact only after its complete contents are verified. */
function writeAtomic(path, bytes) {
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
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

/**
 * Stage the core ONNX Runtime shared library for one target. A missing bundle
 * for a target is handled by the caller as a non-error skip; once a bundle is
 * configured, a download or checksum failure is fatal because the native `ai`
 * feature relies on the library matching its pinned build.
 */
async function stageCoreLibrary(key, platform) {
  const destDir = join(stageDir, key);
  const destFile = join(destDir, platform.libName);

  if (await stagedFileMatches(destFile, platform.extractedSha256)) {
    console.log(
      `[fetch-onnxruntime] ${key}: verified staged file at ${destFile}, skipping download.`,
    );
    return;
  }
  if (existsSync(destFile)) {
    console.warn(
      `[fetch-onnxruntime] ${key}: staged file is missing, empty, or has an unexpected ` +
        'digest; re-downloading the pinned archive.',
    );
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
  const actualSha256 = createHash('sha256').update(extracted).digest('hex');
  if (platform.extractedSha256 && actualSha256 !== platform.extractedSha256) {
    throw new Error(
      `Extracted ${key} runtime digest mismatch: expected ${platform.extractedSha256}, ` +
        `got ${actualSha256}`,
    );
  }
  writeAtomic(destFile, extracted);

  console.log(`[fetch-onnxruntime] ${key}: staged ${destFile} (extracted sha256=${actualSha256})`);
}

/**
 * Stage the optional WebGPU plugin execution provider (library + license
 * files) for one target. Idempotent per file: only entries that are missing or
 * zero-length are downloaded and written, so an already-staged plugin is never
 * re-fetched.
 *
 * The plugin is strictly optional. Errors are thrown for the caller to catch
 * and downgrade to a warning — a build must never fail because an optional
 * acceleration artifact could not be fetched.
 */
async function stageWebgpuPlugin(key, platform) {
  const plugin = WEBGPU_PLUGIN_TARGETS.includes(key) ? platform.webgpuPlugin : undefined;
  if (!plugin) {
    console.log(
      `[fetch-onnxruntime] ${key}: no WebGPU plugin wheel is published for this platform; ` +
        `the native ai feature runs on the CPU execution provider. Not an error.`,
    );
    return;
  }

  const destDir = join(stageDir, key);
  const files = [
    {
      entryPath: plugin.libraryPath,
      name: plugin.libraryName,
      sha256: plugin.librarySha256,
    },
    {
      entryPath: plugin.licensePath,
      name: plugin.licenseName,
      sha256: plugin.licenseSha256,
    },
    {
      entryPath: plugin.noticesPath,
      name: plugin.noticesName,
      sha256: plugin.noticesSha256,
    },
  ].map((file) => ({ ...file, destPath: join(destDir, file.name) }));

  const verified = await Promise.all(
    files.map(async (file) => ({
      file,
      matches: await stagedFileMatches(file.destPath, file.sha256),
    })),
  );
  const missing = verified.filter(({ matches }) => !matches).map(({ file }) => file);
  if (missing.length === 0) {
    console.log(
      `[fetch-onnxruntime] ${key}: verified WebGPU plugin ${WEBGPU_PLUGIN_VERSION} at ` +
        `${destDir}, skipping download.`,
    );
    return;
  }

  console.log(
    `[fetch-onnxruntime] ${key}: downloading onnxruntime WebGPU plugin ${WEBGPU_PLUGIN_VERSION} ` +
      `from ${plugin.url}`,
  );
  const archiveBuffer = await downloadToBuffer(plugin.url);

  // Same posture as the core runtime: verify the pinned checksum before any
  // archive parser (unzip) touches the bytes.
  const archiveSha256 = createHash('sha256').update(archiveBuffer).digest('hex');
  if (archiveSha256 !== plugin.sha256) {
    throw new Error(
      `WebGPU plugin archive checksum mismatch.\n` +
        `  expected: ${plugin.sha256}\n  actual:   ${archiveSha256}\n` +
        `Refusing to extract an archive that doesn't match the pinned checksum.`,
    );
  }

  mkdirSync(stageDir, { recursive: true });
  mkdirSync(destDir, { recursive: true });
  for (const file of missing) {
    const extracted = await extractFromZip(archiveBuffer, file.entryPath);
    const actualSha256 = createHash('sha256').update(extracted).digest('hex');
    if (file.sha256 && actualSha256 !== file.sha256) {
      throw new Error(
        `Extracted WebGPU plugin file ${file.name} digest mismatch: expected ${file.sha256}, ` +
          `got ${actualSha256}`,
      );
    }
    writeAtomic(file.destPath, extracted);
    console.log(`[fetch-onnxruntime] ${key}: staged ${file.destPath}`);
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

    await stageCoreLibrary(key, platform);

    try {
      await stageWebgpuPlugin(key, platform);
    } catch (err) {
      console.error(
        `[fetch-onnxruntime] ${key}: WebGPU plugin staging failed (optional; continuing ` +
          `without it, the runtime falls back to the CPU execution provider): ${err.message}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('[fetch-onnxruntime] FATAL:', err);
  process.exit(1);
});
