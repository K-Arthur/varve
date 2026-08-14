#!/usr/bin/env node
/**
 * Generate a CycloneDX 1.5 SBOM for a Varve release.
 *
 * Deliberately has no external tool dependency (no syft, no cargo-cyclonedx).
 * A release pipeline that needs a tool installed from a `latest` URL to produce
 * its bill of materials has replaced one supply-chain question with another —
 * and on a solo project it is one more thing that silently breaks. Everything
 * here comes from `cargo metadata` and `pnpm list`, both of which read the
 * committed lockfiles and are already required for the build.
 *
 * Usage:
 *   node scripts/release/generate-sbom.mjs --out dist/release/varve-sbom.cdx.json
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetFor } from './targets.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.shell ? { shell: true } : {}),
  });
}

/** Percent-encode the parts of a purl that may contain reserved characters. */
function purlEncode(value) {
  return encodeURIComponent(value).replace(/%2F/gi, '/');
}

/**
 * Rust crates from every workspace in the repo. The Tauri app is a *separate*
 * Cargo workspace (see apps/desktop/src-tauri/Cargo.toml `[workspace]`), so a
 * single `cargo metadata` at the root misses tauri, wry, ort and everything
 * else that actually ships in the binary — the crates a consumer most wants in
 * an SBOM.
 */
function rustComponents() {
  const manifests = ['Cargo.toml', 'apps/desktop/src-tauri/Cargo.toml'];
  const seen = new Map();

  for (const manifest of manifests) {
    let raw;
    try {
      raw = run('cargo', [
        'metadata',
        '--format-version',
        '1',
        '--manifest-path',
        manifest,
        // Locked: the SBOM must describe the committed dependency graph, not
        // whatever resolution cargo would pick today.
        '--locked',
      ]);
    } catch (err) {
      const detail = err.stderr?.toString().trim() ?? err.message;
      const hint = detail.includes('--locked')
        ? '\n  The lockfile is stale relative to the manifests. This usually means the version ' +
          'was bumped without refreshing Cargo.lock — run `cargo check --workspace` and ' +
          '`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, then commit both ' +
          'lockfiles. --locked is intentional here: an SBOM must describe the committed ' +
          'dependency graph, not a freshly-resolved one.'
        : '';
      throw new Error(`cargo metadata failed for ${manifest}: ${detail}${hint}`);
    }

    const metadata = JSON.parse(raw);
    for (const pkg of metadata.packages) {
      // Path dependencies are first-party Varve crates, not third-party supply
      // chain. They are recorded, but flagged so a consumer can tell them apart.
      const isLocal = (pkg.source ?? null) === null;
      const key = `${pkg.name}@${pkg.version}`;
      if (seen.has(key)) continue;

      seen.set(key, {
        type: 'library',
        'bom-ref': `pkg:cargo/${purlEncode(pkg.name)}@${pkg.version}`,
        name: pkg.name,
        version: pkg.version,
        purl: `pkg:cargo/${purlEncode(pkg.name)}@${pkg.version}`,
        ...(pkg.description ? { description: pkg.description.slice(0, 400) } : {}),
        ...(pkg.license ? { licenses: licenseEntries(pkg.license) } : {}),
        ...(pkg.repository ? { externalReferences: [{ type: 'vcs', url: pkg.repository }] } : {}),
        properties: [
          { name: 'varve:ecosystem', value: 'cargo' },
          { name: 'varve:origin', value: isLocal ? 'first-party' : 'registry' },
        ],
      });
    }
  }
  return [...seen.values()];
}

/**
 * CycloneDX wants one entry per licence. Cargo stores SPDX expressions like
 * "MIT OR Apache-2.0", which is an expression, not an id — emit it as such so
 * downstream scanners do not treat the whole string as an unknown licence.
 */
function licenseEntries(expression) {
  if (/\s(OR|AND|WITH)\s/i.test(expression)) return [{ expression }];
  return [{ license: { id: expression } }];
}

/** npm packages from the pnpm workspace, via the committed lockfile. */
function npmComponents() {
  let raw;
  try {
    raw = run(
      // On Windows the pnpm launcher is pnpm.cmd: execFileSync does not do
      // PATHEXT resolution for .cmd shims (ENOENT with 'pnpm'), and executing
      // a .cmd directly returns EINVAL unless shell: true routes it through
      // cmd.exe. The ubuntu and macOS paths use the bare 'pnpm' binary.
      process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      ['list', '--recursive', '--depth', 'Infinity', '--json', '--prod'],
      { shell: process.platform === 'win32' },
    );
  } catch (err) {
    throw new Error(`pnpm list failed: ${err.stderr?.toString().trim() ?? err.message}`);
  }

  const projects = JSON.parse(raw);
  const seen = new Map();

  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (!info?.version) continue;
      // Workspace links resolve to `link:../foo`; they are first-party.
      const isLink = String(info.version).startsWith('link:');
      const version = isLink ? '0.0.0' : info.version;
      const key = `${name}@${version}`;
      if (!seen.has(key)) {
        seen.set(key, {
          type: 'library',
          'bom-ref': `pkg:npm/${purlEncode(name)}@${version}`,
          name,
          version,
          purl: `pkg:npm/${purlEncode(name)}@${version}`,
          properties: [
            { name: 'varve:ecosystem', value: 'npm' },
            { name: 'varve:origin', value: isLink ? 'first-party' : 'registry' },
          ],
        });
      }
      walk(info.dependencies);
    }
  };

  for (const project of projects) {
    walk(project.dependencies);
    walk(project.optionalDependencies);
  }
  return [...seen.values()];
}

/**
 * Binary artifacts that are neither npm nor cargo packages but genuinely ship
 * inside the installer. Omitting these is the most common SBOM gap in a Tauri
 * app: the ONNX Runtime shared library and the AI model weights are the two
 * largest third-party things in the bundle and neither appears in a lockfile.
 *
 * `--os`/`--arch` scope the ONNX Runtime entry to the platform's own shared
 * library (each platform ships a different binary); without them the entry
 * describes the runtime generically.
 */
function bundledBinaryComponents(args) {
  const components = [];

  const ortScript = readFileSync(join(repoRoot, 'scripts/fetch-onnxruntime.mjs'), 'utf-8');
  const ortVersion = ortScript.match(/ORT_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (ortVersion) {
    const os = args.os ?? null;
    const arch = args.arch ?? null;
    const libDir =
      os && arch
        ? join(repoRoot, 'apps/desktop/src-tauri/onnxruntime-libs', `${os}-${arch}`)
        : null;
    const libName =
      os === 'windows'
        ? 'onnxruntime.dll'
        : os === 'macos'
          ? 'libonnxruntime.dylib'
          : 'libonnxruntime.so';
    const libPath = libDir ? join(libDir, libName) : null;
    const libHash =
      libPath && existsSync(libPath) && statSync(libPath).isFile()
        ? createHash('sha256').update(readFileSync(libPath)).digest('hex')
        : null;

    components.push({
      type: 'library',
      'bom-ref': `pkg:generic/onnxruntime@${ortVersion}${os ? `+${os}-${arch}` : ''}`,
      name: 'onnxruntime',
      version: ortVersion,
      purl: `pkg:generic/onnxruntime@${ortVersion}`,
      description:
        os && arch
          ? `Native ONNX Runtime shared library (${os}/${arch}), bundled as a Tauri resource`
          : 'Native ONNX Runtime shared library, bundled as a Tauri resource',
      licenses: [{ license: { id: 'MIT' } }],
      externalReferences: [{ type: 'vcs', url: 'https://github.com/microsoft/onnxruntime' }],
      ...(libHash ? { hashes: [{ alg: 'SHA-256', content: libHash }] } : {}),
      properties: [
        { name: 'varve:ecosystem', value: 'generic' },
        { name: 'varve:origin', value: 'vendored-binary' },
        ...(os ? [{ name: 'varve:buildOs', value: os }] : []),
        ...(arch ? [{ name: 'varve:buildArch', value: arch }] : []),
      ],
    });
  }

  const manifestPath = join(repoRoot, 'apps/desktop/public/models/manifest.json');
  const models = JSON.parse(readFileSync(manifestPath, 'utf-8')).models ?? [];
  for (const model of models.filter((m) => m.bundled)) {
    components.push({
      type: 'machine-learning-model',
      'bom-ref': `pkg:generic/${purlEncode(model.id)}@${model.modelVersion ?? '1.0.0'}`,
      name: model.id,
      version: model.modelVersion ?? '1.0.0',
      purl: `pkg:generic/${purlEncode(model.id)}@${model.modelVersion ?? '1.0.0'}`,
      ...(model.sourceLicense ? { licenses: licenseEntries(model.sourceLicense) } : {}),
      ...(model.sha256 ? { hashes: [{ alg: 'SHA-256', content: model.sha256 }] } : {}),
      properties: [
        { name: 'varve:ecosystem', value: 'onnx-model' },
        { name: 'varve:origin', value: 'bundled-model' },
        ...(model.remoteUrl ? [{ name: 'varve:sourceUrl', value: model.remoteUrl }] : []),
        {
          name: 'varve:provenanceStatus',
          value: model.validation?.provenanceStatus ?? 'unknown',
        },
      ],
    });
  }

  return components;
}

/**
 * Build metadata: the release version, the exact commit the installer was
 * built from, and the platform/architecture the SBOM describes.
 *
 * A platform-scoped SBOM (`--os linux --arch x86_64`) describes the bundle
 * that ships to that platform: the platform's own ONNX Runtime shared library
 * and bundled models. A combined SBOM (`--scope all-platforms`) is emitted by
 * the release assembly job and declares that scope explicitly.
 */
function buildMetadata(args, version) {
  const gitSha = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  })();

  const os = args.os ?? null;
  const arch = os && args.arch ? targetFor(os, args.arch).architecture : (args.arch ?? null);
  if (os && !args.arch) throw new Error('--arch is required when --os is supplied');
  if (args.arch && !os) throw new Error('--os is required when --arch is supplied');
  const scope = args.scope ?? (os ? `${os}-${arch}` : 'all-platforms');
  const description =
    'Local-first design suite for vector, layout, typography, motion, prototyping and print production';

  return {
    os,
    arch,
    scope,
    gitSha,
    version,
    description,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(repoRoot, args.out ?? 'dist/release/varve-sbom.cdx.json');
  const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version;
  const meta = buildMetadata(args, version);

  const components = [...rustComponents(), ...npmComponents(), ...bundledBinaryComponents(args)];
  components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

  const component = {
    type: 'application',
    'bom-ref': `pkg:generic/varve@${version}`,
    name: 'Varve',
    version,
    description: meta.description,
    licenses: [{ license: { name: 'FSL-1.1-MIT' } }],
    externalReferences: [
      { type: 'vcs', url: 'https://github.com/K-Arthur/varve' },
      ...(meta.gitSha ? [{ type: 'build-system', comment: `commit:${meta.gitSha}` }] : []),
    ],
    properties: [
      { name: 'varve:scope', value: meta.scope },
      ...(meta.os ? [{ name: 'varve:buildOs', value: meta.os }] : []),
      ...(meta.arch ? [{ name: 'varve:buildArch', value: meta.arch }] : []),
      ...(meta.gitSha ? [{ name: 'varve:gitCommit', value: meta.gitSha }] : []),
    ],
  };

  const sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'K-Arthur',
          name: 'varve/generate-sbom.mjs',
          version: '1.0.0',
          externalReferences: [{ type: 'vcs', url: 'https://github.com/K-Arthur/varve' }],
        },
      ],
      component,
      properties: [
        { name: 'varve:scope', value: meta.scope },
        ...(meta.os ? [{ name: 'varve:buildOs', value: meta.os }] : []),
        ...(meta.arch ? [{ name: 'varve:buildArch', value: meta.arch }] : []),
        ...(meta.gitSha ? [{ name: 'varve:gitCommit', value: meta.gitSha }] : []),
      ],
    },
    components,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(sbom, null, 2)}\n`);

  const counts = components.reduce((acc, c) => {
    const eco = c.properties?.find((p) => p.name === 'varve:ecosystem')?.value ?? 'other';
    acc[eco] = (acc[eco] ?? 0) + 1;
    return acc;
  }, {});

  process.stdout.write(`SBOM written to ${outPath} (scope: ${meta.scope})\n`);
  process.stdout.write(`  ${components.length} components total\n`);
  for (const [eco, count] of Object.entries(counts).sort()) {
    process.stdout.write(`    ${eco.padEnd(14)} ${count}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`SBOM generation failed: ${err.message}\n`);
  process.exit(1);
}
