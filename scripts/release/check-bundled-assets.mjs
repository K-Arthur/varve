#!/usr/bin/env node
/**
 * Fail the build when a bundled asset is a Git LFS pointer instead of real content.
 *
 * Audit RB-1 (historical): `.gitattributes` used to route `*.onnx` through Git
 * LFS, and `actions/checkout` does not fetch LFS content unless explicitly
 * asked, so a 133-byte pointer text file could sit where a 64 MB model should
 * be — which builds fine, packages fine, uploads fine, and fails at runtime in
 * front of a user with an opaque ONNX parse error. LFS was retired
 * 2026-08-20 (see `.gitattributes`) after the 980 MB ddcolor source exhausted
 * the free-tier bandwidth quota; bundled models are committed directly now.
 * This guard stays as defense-in-depth: it still fails loudly if a
 * contributor's local LFS config or a future re-adoption ever produces a
 * pointer file in a bundled model's place.
 *
 * Also checks the inverse hazard: an asset marked `bundled: false` in the model
 * manifest that is nonetheless staged in `public/`, where Vite copies it into
 * `dist/` unconditionally. `ddcolor.onnx` is 980 MB; shipping it by accident
 * would add ~1 GB to every installer.
 *
 * Usage:
 *   node scripts/release/check-bundled-assets.mjs            # source tree
 *   node scripts/release/check-bundled-assets.mjs --dist     # also check built dist/
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const LFS_MAGIC = 'version https://git-lfs.github.com/spec/v1';
/** An LFS pointer is always well under 1 KB; real models are megabytes. */
const POINTER_MAX_BYTES = 1024;

const PUBLIC_MODELS = join(repoRoot, 'apps/desktop/public/models');
const DIST_MODELS = join(repoRoot, 'apps/desktop/dist/models');

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function isLfsPointer(path) {
  const size = statSync(path).size;
  if (size > POINTER_MAX_BYTES) return false;
  try {
    return readFileSync(path, 'utf-8').startsWith(LFS_MAGIC);
  } catch {
    // Binary content that fails UTF-8 decoding is, by definition, not a pointer.
    return false;
  }
}

function pointerDetails(path) {
  const text = readFileSync(path, 'utf-8');
  return {
    size: Number(text.match(/^size (\d+)$/m)?.[1] ?? 0),
    oid: text.match(/^oid sha256:([0-9a-f]+)$/m)?.[1] ?? 'unknown',
  };
}

/**
 * Extract `id` -> `bundled` from the engine's model catalog.
 *
 * Regex rather than a TS parse: this script must run before any build step, on
 * a bare Node with nothing compiled. The catalog entries are plain object
 * literals with one `id:` and one `bundled:` each, so a per-entry scan is
 * reliable enough for a consistency check — and a false positive here fails
 * loudly rather than silently, which is the correct direction to be wrong in.
 */
function catalogBundledFlags() {
  const path = join(repoRoot, 'packages/engine/src/inference/modelCatalog.ts');
  if (!existsSync(path)) return new Map();

  const text = readFileSync(path, 'utf-8');
  const flags = new Map();
  // Split on `id: '...'` so each chunk is one catalog entry.
  const entries = text.split(/^\s*id:\s*'/m).slice(1);
  for (const entry of entries) {
    const id = entry.slice(0, entry.indexOf("'"));
    const bundled = entry.match(/^\s*bundled:\s*(true|false)/m)?.[1];
    if (id && bundled) flags.set(id, bundled === 'true');
  }
  return flags;
}

function main() {
  const checkDist = process.argv.includes('--dist');
  const problems = [];
  const warnings = [];

  const manifestPath = join(PUBLIC_MODELS, 'manifest.json');
  const models = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf-8')).models ?? [])
    : [];
  const bundledFilenames = new Set(models.filter((m) => m.bundled).map((m) => m.filename));
  const knownFilenames = new Map(models.map((m) => [m.filename, m]));

  // Two independent sources of truth describe what ships: the runtime manifest
  // read by the app, and the engine's compile-time catalog. When they disagree,
  // one of them is wrong about roughly a gigabyte of installer payload — and
  // which one wins depends on which code path runs first. Fail on the
  // disagreement itself rather than guessing.
  const catalog = catalogBundledFlags();
  for (const model of models) {
    if (!catalog.has(model.id)) continue;
    const catalogSaysBundled = catalog.get(model.id);
    if (catalogSaysBundled !== Boolean(model.bundled)) {
      problems.push(
        `Model '${model.id}' is marked bundled=${Boolean(model.bundled)} in ` +
          `apps/desktop/public/models/manifest.json but bundled=${catalogSaysBundled} in ` +
          'packages/engine/src/inference/modelCatalog.ts.\n' +
          '      These must agree — they decide whether the weights ship in the installer.\n' +
          '      Reconcile them before releasing.',
      );
    }
  }

  // Any model the app can fetch at runtime must be checksum-pinned. The download
  // path in lib.rs verifies against `checksum_sha256` only `if let Some(expected)`
  // — a model with a null checksum is downloaded and used unverified, silently.
  // All 18 downloadable models are pinned today; this keeps the 19th honest.
  for (const model of models) {
    if (model.remoteUrl && !model.sha256) {
      problems.push(
        `Model '${model.id}' has a remoteUrl but no sha256.\n` +
          `      ${model.remoteUrl}\n` +
          '      The runtime download only verifies a checksum when one is present, so this\n' +
          '      model would be fetched over the network and used without verification.',
      );
    }
    if (model.remoteUrl && !/^https:\/\//.test(model.remoteUrl)) {
      problems.push(`Model '${model.id}' has a non-HTTPS remoteUrl: ${model.remoteUrl}`);
    }
  }

  const roots = [PUBLIC_MODELS, ...(checkDist ? [DIST_MODELS] : [])];

  for (const root of roots) {
    for (const path of walk(root)) {
      if (!path.endsWith('.onnx')) continue;
      const rel = relative(repoRoot, path);
      // basename() (not split('/')) — Windows checkouts use backslash paths,
      // and the guard must treat both separators identically.
      const filename = basename(path);

      if (isLfsPointer(path)) {
        const { size, oid } = pointerDetails(path);
        const message =
          `${rel} is a Git LFS pointer (${statSync(path).size} B) standing in for ` +
          `${(size / 1_000_000).toFixed(0)} MB of real content (oid ${oid.slice(0, 12)}…)`;

        if (bundledFilenames.has(filename)) {
          problems.push(
            `${message}\n` +
              `      This model is marked "bundled": true — the app expects real weights here.\n` +
              `      Fix: git lfs pull --include="apps/desktop/public/models/${filename}"\n` +
              `      In CI: fetch it explicitly; actions/checkout does NOT fetch LFS by default.`,
          );
        } else {
          warnings.push(
            `${message}\n` +
              `      Not marked bundled, so this pointer will ship harmlessly — but the file\n` +
              `      should not be in public/ at all (see below).`,
          );
        }
        continue;
      }

      // Real content present. If it is not a bundled model, it is ~1 GB of dead
      // weight that Vite will copy into dist/ and Tauri will embed.
      if (!bundledFilenames.has(filename) && root === PUBLIC_MODELS) {
        const sizeMb = statSync(path).size / 1_000_000;
        const model = knownFilenames.get(filename);
        problems.push(
          `${rel} is ${sizeMb.toFixed(0)} MB of real content but is marked ` +
            `"bundled": ${model ? model.bundled : 'absent from manifest'}.\n` +
            `      Everything in public/ is copied into dist/ and embedded in the installer.\n` +
            `      Fix: move it out of public/ — it is designed to be downloaded at runtime.`,
        );
      }
    }
  }

  for (const warning of warnings) process.stdout.write(`  warning: ${warning}\n`);

  if (problems.length > 0) {
    process.stderr.write('Bundled asset check FAILED:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }

  const checked = roots.flatMap(walk).filter((p) => p.endsWith('.onnx')).length;
  process.stdout.write(
    `Bundled asset check passed (${checked} .onnx file(s) across ${roots.length} root(s); ` +
      `${bundledFilenames.size} declared bundled).\n`,
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
