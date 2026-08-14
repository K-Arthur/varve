#!/usr/bin/env node
/**
 * Collect Tauri bundle output into a release directory with predictable names,
 * SHA-256 checksums, and a machine-readable manifest.
 *
 * Tauri names bundles inconsistently and by platform convention:
 *   Varve_0.1.0_amd64.deb        (space, Debian arch name)
 *   varve-desktop_0.1.0_amd64.AppImage
 *   Varve_0.1.0_x64-setup.exe
 *   Varve_0.1.0_aarch64.dmg
 *
 * Spaces in a download filename break naive shell pipelines and get percent-
 * encoded inconsistently by browsers; the arch names disagree across formats
 * (amd64 / x64 / x86_64). Releases need one scheme so the download page, the
 * checksum file, and the AUR PKGBUILD can all predict a URL:
 *
 *   Varve-<version>-<os>-<arch>.<ext>
 *   e.g. Varve-0.1.0-linux-x86_64.AppImage
 *
 * Usage:
 *   node scripts/release/collect-artifacts.mjs \
 *     --bundle-dir apps/desktop/src-tauri/target/release/bundle \
 *     --out dist/release \
 *     [--os linux] [--arch x86_64]
 *
 * Emits into --out:
 *   <renamed artifacts>
 *   SHA256SUMS.txt            sha256sum -c compatible
 *   release-manifest.json     consumed by the website download page
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productSlug } from './product.mjs';
import { currentTargetId, targetById, targetFor } from './targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Bundle subdirectory -> canonical extension and metadata.
 * `nsis` produces `*-setup.exe`; we keep `.exe` but the canonical name makes the
 * format explicit via the `format` field rather than the extension.
 */
const FORMATS = {
  appimage: { ext: 'AppImage', format: 'appimage', label: 'AppImage' },
  deb: { ext: 'deb', format: 'deb', label: 'Debian package' },
  rpm: { ext: 'rpm', format: 'rpm', label: 'RPM package' },
  dmg: { ext: 'dmg', format: 'dmg', label: 'macOS disk image' },
  nsis: { ext: 'exe', format: 'nsis', label: 'Windows installer' },
  msi: { ext: 'msi', format: 'msi', label: 'Windows MSI' },
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Human-readable size that matches what a browser shows on a download. */
function humanSize(bytes) {
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function collect({ bundleDir, outDir, os, arch, version, product }) {
  if (!existsSync(bundleDir)) {
    throw new Error(
      `Bundle directory not found: ${bundleDir}\n` +
        'Run a Tauri build first (e.g. `just package-linux`).',
    );
  }
  mkdirSync(outDir, { recursive: true });

  const artifacts = [];
  for (const [subdir, meta] of Object.entries(FORMATS)) {
    const dir = join(bundleDir, subdir);
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir)) {
      // Tauri drops sidecar files (.sig, .tar.gz for the updater) next to the
      // installer. Only the installer itself is a release artifact here.
      if (!entry.toLowerCase().endsWith(`.${meta.ext.toLowerCase()}`)) continue;

      const source = join(dir, entry);
      if (!statSync(source).isFile()) continue;

      const canonical = `${product}-${version}-${os}-${arch}.${meta.ext}`;
      const dest = join(outDir, canonical);
      copyFileSync(source, dest);

      const size = statSync(dest).size;
      artifacts.push({
        filename: canonical,
        originalName: basename(source),
        os,
        arch,
        format: meta.format,
        label: meta.label,
        sizeBytes: size,
        size: humanSize(size),
        sha256: sha256(dest),
      });

      // Tauri v2 reuses the AppImage/NSIS installer bytes for updater installs
      // and emits the detached `.sig` beside them. The signature is a release
      // input, not an OS code-signing claim; publish it so the feed can be
      // audited against the exact bytes users download.
      if (meta.format === 'appimage' || meta.format === 'nsis') {
        copyUpdaterSignature({ source, canonical, outDir });
      }
    }
  }

  // macOS keeps the DMG as the distribution container, while Tauri's updater
  // consumes a signed tarball of the installed `.app`.
  const macosDir = join(bundleDir, 'macos');
  if (existsSync(macosDir)) {
    for (const entry of readdirSync(macosDir)) {
      if (!entry.endsWith('.app.tar.gz')) continue;
      const source = join(macosDir, entry);
      if (!statSync(source).isFile()) continue;
      const canonical = `${product}-${version}-${os}-${arch}.app.tar.gz`;
      copyFileSync(source, join(outDir, canonical));
      copyUpdaterSignature({ source, canonical, outDir });
    }
  }

  if (artifacts.length === 0) {
    throw new Error(
      `No recognised bundles under ${bundleDir}.\n` +
        `Looked in: ${Object.keys(FORMATS).join(', ')}`,
    );
  }

  artifacts.sort((a, b) => a.filename.localeCompare(b.filename));
  return artifacts;
}

function copyUpdaterSignature({ source, canonical, outDir }) {
  const signatureSource = `${source}.sig`;
  if (!existsSync(signatureSource) || !statSync(signatureSource).isFile()) {
    throw new Error(
      `Missing Tauri updater signature for ${source}. ` +
        'Refusing to collect an installable updater artifact without its .sig.',
    );
  }
  copyFileSync(signatureSource, join(outDir, `${canonical}.sig`));
}

function writeChecksums(outDir, artifacts) {
  // `sha256sum -c SHA256SUMS.txt` format: hash, two spaces, filename.
  const body = artifacts.map((a) => `${a.sha256}  ${a.filename}`).join('\n');
  writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${body}\n`);
}

function writeManifest(outDir, artifacts, version) {
  const manifestPath = join(outDir, 'release-manifest.json');

  // Merge with an existing manifest so a multi-runner CI matrix can each append
  // their own platform without clobbering the others. Keyed by filename, which
  // is unique per (version, os, arch, format).
  let existing = { artifacts: [] };
  if (existsSync(manifestPath)) {
    try {
      existing = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      // A corrupt partial manifest should not abort the build; start fresh.
      existing = { artifacts: [] };
    }
  }

  const byName = new Map((existing.artifacts ?? []).map((a) => [a.filename, a]));
  for (const artifact of artifacts) byName.set(artifact.filename, artifact);

  const merged = [...byName.values()].sort((a, b) => a.filename.localeCompare(b.filename));

  const manifest = {
    schemaVersion: 1,
    version,
    // Fixed at collect time rather than at page render, so the website shows the
    // release date and not the date its last deploy happened to run.
    generatedAt: new Date().toISOString(),
    signed: false,
    notarized: false,
    artifacts: merged,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundleDir = resolve(
    repoRoot,
    args['bundle-dir'] ?? 'apps/desktop/src-tauri/target/release/bundle',
  );
  const outDir = resolve(repoRoot, args.out ?? 'dist/release');
  const currentTarget = targetById(currentTargetId());
  const os = args.os ?? currentTarget.os;
  const arch = args.arch ?? currentTarget.architecture;
  targetFor(os, arch);

  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version;
  if (version === '0.0.0') {
    throw new Error(
      'Refusing to collect artifacts at version 0.0.0 — that is the placeholder, not a ' +
        'release. Run `node scripts/release/version.mjs set <semver>` first.',
    );
  }

  // Read from tauri.conf.json rather than hardcoded, so a product rename
  // renames the artifacts too instead of silently shipping the old name.
  const product = productSlug();
  const artifacts = collect({ bundleDir, outDir, os, arch, version, product });
  writeChecksums(outDir, artifacts);
  const manifest = writeManifest(outDir, artifacts, version);

  process.stdout.write(`Collected ${artifacts.length} artifact(s) for ${os}/${arch}:\n`);
  for (const a of artifacts) {
    process.stdout.write(
      `  ${a.filename.padEnd(44)} ${a.size.padStart(9)}  ${a.sha256.slice(0, 16)}…\n`,
    );
  }
  process.stdout.write(`\nOutput: ${outDir}\n`);
  process.stdout.write(`Manifest now lists ${manifest.artifacts.length} artifact(s) total.\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
