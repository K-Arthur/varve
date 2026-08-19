#!/usr/bin/env node
/**
 * Single-source the release version across every manifest that carries one.
 *
 * Varve.s version lives in five places that must agree, or the installer lies
 * about what it is (audit RB-3: all five read `0.0.0`, and `publish.yml` never
 * compared them to the tag it was triggered by). Package managers key upgrade
 * decisions off these values, so a stale one makes deb/rpm/MSI upgrades
 * undefined rather than merely cosmetic.
 *
 * Root `package.json` is the source of truth. Everything else is derived.
 *
 *   node scripts/release/version.mjs get            # print current version
 *   node scripts/release/version.mjs set 0.1.0      # write to all targets
 *   node scripts/release/version.mjs verify         # all targets agree?
 *   node scripts/release/version.mjs verify v0.1.0  # ...and match this tag?
 *   node scripts/release/version.mjs bump patch     # 0.1.0 -> 0.1.1 (writes all)
 *   node scripts/release/version.mjs snapshot       # 0.1.0-dev.<sha> (read-only)
 *
 * `verify` is the CI gate. It exits non-zero with a diff-style report rather
 * than "fixing" anything, because a release workflow silently rewriting version
 * numbers is how you ship an artifact nobody meant to build.
 *
 * Version drift between pushes is caught by the push gate: ci.yml
 * `pipeline-validate` runs `verify` on every push/PR, and the pre-push hook
 * warns on drift before the commit leaves the machine.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Test hook: point VARVE_VERSION_ROOT at a fixture tree so `set`/`bump` write
// there instead of the real repo (release-pipeline.test.mjs uses this).
const repoRoot = process.env.VARVE_VERSION_ROOT
  ? resolve(process.env.VARVE_VERSION_ROOT)
  : join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Semver core (major.minor.patch) plus optional prerelease, no build metadata.
 *  Build metadata is excluded deliberately: `+` is illegal in a Debian version
 *  and in a Windows MSI ProductVersion, so allowing it here would only defer
 *  the failure to the bundler. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Every file carrying the app version.
 *
 * `kind: 'toml-section'` targets the first `version = "..."` after a named
 * section header, so a dependency's `version =` elsewhere in the file is never
 * touched.
 *
 * `kind: 'readme-markers'` targets version strings wrapped in
 * `<!-- VARVE_VERSION -->vX.Y.Z<!-- /VARVE_VERSION -->` comment markers.
 */
const TARGETS = [
  { path: 'package.json', kind: 'json', pointer: ['version'] },
  { path: 'apps/desktop/package.json', kind: 'json', pointer: ['version'] },
  { path: 'apps/desktop/src-tauri/tauri.conf.json', kind: 'json', pointer: ['version'] },
  { path: 'Cargo.toml', kind: 'toml-section', section: 'workspace.package' },
  { path: 'apps/desktop/src-tauri/Cargo.toml', kind: 'toml-section', section: 'package' },
  { path: 'README.md', kind: 'readme-markers' },
];

function readTarget(target) {
  const abs = join(repoRoot, target.path);
  if (!existsSync(abs)) return { text: '', value: undefined };
  const text = readFileSync(abs, 'utf-8');
  if (target.kind === 'json') {
    let node = JSON.parse(text);
    for (const key of target.pointer) node = node?.[key];
    return { text, value: node };
  }
  if (target.kind === 'readme-markers') {
    const match = text.match(/<!-- VARVE_VERSION -->[^<]*<!-- \/VARVE_VERSION -->/);
    if (!match) return { text, value: undefined };
    const versionMatch = match[0].match(/<!-- VARVE_VERSION -->([^<]*)<!-- /);
    return { text, value: versionMatch?.[1]?.replace(/^v/, '') };
  }
  return { text, value: tomlSectionVersion(text, target.section) };
}

/** Find `version = "x"` inside `[section]`, stopping at the next section header. */
function tomlSectionVersion(text, section) {
  const lines = text.split('\n');
  let inSection = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) {
      inSection = header[1].trim() === section;
      continue;
    }
    if (!inSection) continue;
    const match = line.match(/^\s*version\s*=\s*"([^"]*)"/);
    if (match) return match[1];
  }
  return undefined;
}

function writeTarget(target, version) {
  const abs = join(repoRoot, target.path);
  if (!existsSync(abs)) return; // skip missing files (e.g. README in test fixtures)
  const text = readFileSync(abs, 'utf-8');

  if (target.kind === 'json') {
    // Rewrite the value in place rather than JSON.stringify-ing the whole file,
    // so key order, indentation and the trailing newline survive untouched.
    const updated = text.replace(
      /^(\s*"version"\s*:\s*)"[^"]*"/m,
      (_m, prefix) => `${prefix}"${version}"`,
    );
    if (updated === text && readTarget(target).value !== version) {
      throw new Error(`Could not locate a "version" key to update in ${target.path}`);
    }
    writeFileSync(abs, updated);
    return;
  }

  if (target.kind === 'readme-markers') {
    if (!existsSync(abs)) return; // README may not exist in test fixtures
    // Replace every <!-- VARVE_VERSION -->vX.Y.Z<!-- /VARVE_VERSION --> with
    // the new version, preserving the v prefix where present.
    const updated = text.replace(
      /<!-- VARVE_VERSION -->([^<]*)<!-- \/VARVE_VERSION -->/g,
      (_m, oldVersion) => {
        const prefix = oldVersion.startsWith('v') ? 'v' : '';
        return `<!-- VARVE_VERSION -->${prefix}${version}<!-- /VARVE_VERSION -->`;
      },
    );
    if (updated === text) {
      throw new Error(`Could not locate <!-- VARVE_VERSION --> markers in ${target.path}`);
    }
    writeFileSync(abs, updated);
    return;
  }

  const lines = text.split('\n');
  let inSection = false;
  let written = false;
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^\s*\[([^\]]+)\]/);
    if (header) {
      if (inSection && !written) break; // left the section without finding one
      inSection = header[1].trim() === target.section;
      continue;
    }
    if (!inSection) continue;
    if (/^\s*version\s*=\s*"[^"]*"/.test(lines[i])) {
      lines[i] = lines[i].replace(/"[^"]*"/, `"${version}"`);
      written = true;
      break;
    }
  }
  if (!written) {
    throw new Error(`Could not locate [${target.section}] version in ${target.path}`);
  }
  writeFileSync(abs, lines.join('\n'));
}

function currentVersion() {
  return readTarget(TARGETS[0]).value;
}

/** Strip a leading `v` so `v0.1.0` and `0.1.0` compare equal. */
function normaliseTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Increment one part of a semver core. Any prerelease suffix is dropped —
 * bumping is for the NEXT version, and the next version has no suffix until
 * someone deliberately adds one with `set`.
 * @param {string} version
 * @param {'major'|'minor'|'patch'} part
 * @returns {string}
 */
function incrementVersion(version, part) {
  const core = version.split('-')[0];
  const [major, minor, patch] = core.split('.').map(Number);
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump part '${part}' — use major, minor or patch.`);
}

function gitShortSha() {
  try {
    const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const sha = result.status === 0 ? result.stdout.trim() : '';
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * A deterministic dev-build version for the current HEAD, read-only: the
 * released version core plus `-dev.<short-sha>`. Never touches a manifest, so
 * committed files stay release-clean while dev/test bundles are
 * distinguishable from the last release and from each other.
 * @param {string} version - current committed version (root package.json)
 * @returns {string}
 */
function snapshotVersion(version) {
  const core = version.split('-')[0];
  const sha = gitShortSha();
  return `${core}-dev.${sha || 'local'}`;
}

function cmdGet() {
  process.stdout.write(`${currentVersion()}\n`);
}

/** Shared write path for `set` and `bump`: all targets + lockfile reminder. */
function applyVersion(version, actionLabel) {
  for (const target of TARGETS) {
    writeTarget(target, version);
    process.stdout.write(`  updated ${target.path}\n`);
  }
  process.stdout.write(`\n${actionLabel} ${version}.\n`);
  process.stdout.write(
    'Cargo.lock still records the old version — run `cargo check --workspace` and\n' +
      '`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` to refresh it,\n' +
      'then commit both lockfiles with the version bump.\n',
  );
}

function cmdSet(version) {
  if (!version) throw new Error('Usage: version.mjs set <semver>');
  if (!SEMVER.test(version)) {
    throw new Error(
      `'${version}' is not a valid release version. Expected MAJOR.MINOR.PATCH with an ` +
        'optional prerelease suffix (e.g. 0.1.0 or 0.1.0-alpha.1). Build metadata ("+...") ' +
        'is rejected because deb and MSI cannot represent it.',
    );
  }
  applyVersion(version, 'Version set to');
}

function cmdBump(part) {
  const next = incrementVersion(currentVersion(), part);
  applyVersion(next, `Bumped ${part} to`);
}

function cmdSnapshot() {
  process.stdout.write(`${snapshotVersion(currentVersion())}\n`);
}

function cmdVerify(tag) {
  const found = TARGETS.map((target) => {
    const exists = existsSync(join(repoRoot, target.path));
    let value;
    let error;
    try {
      value = readTarget(target).value;
    } catch (err) {
      error = err.message;
    }
    return { path: target.path, value, error, exists };
  });

  const problems = [];
  const expected = found[0].value;

  if (!expected) {
    problems.push(`Root package.json has no readable version.`);
  } else if (!SEMVER.test(expected)) {
    problems.push(`Root package.json version '${expected}' is not valid semver.`);
  }

  for (const entry of found) {
    if (!entry.exists) continue;
    if (entry.error) {
      problems.push(`${entry.path}: ${entry.error}`);
    } else if (entry.value !== expected) {
      problems.push(`${entry.path}: '${entry.value}' does not match root '${expected}'`);
    }
  }

  if (tag) {
    const wanted = normaliseTag(tag);
    if (wanted !== expected) {
      problems.push(
        `Tag '${tag}' does not match application version '${expected}'. ` +
          `Run \`node scripts/release/version.mjs set ${wanted}\` and commit before tagging.`,
      );
    }
  }

  const width = Math.max(...found.map((f) => f.path.length));
  for (const entry of found) {
    const shown = entry.error ? `ERROR: ${entry.error}` : entry.value;
    process.stdout.write(`  ${entry.path.padEnd(width)}  ${shown}\n`);
  }
  if (tag) process.stdout.write(`  ${'(git tag)'.padEnd(width)}  ${normaliseTag(tag)}\n`);

  if (problems.length > 0) {
    process.stderr.write('\nVersion verification FAILED:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }

  process.stdout.write(`\nAll version manifests agree on ${expected}.\n`);
}

// `pathToFileURL` (not a literal `file://${argv[1]}` prefix) so the guard also
// matches on Windows, where argv[1] is `C:\...` and import.meta.url is
// `file:///C:/...` — the literal form silently disables the CLI there.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, argument] = process.argv.slice(2);
  try {
    if (command === 'get') cmdGet();
    else if (command === 'set') cmdSet(argument);
    else if (command === 'bump') cmdBump(argument);
    else if (command === 'snapshot') cmdSnapshot();
    else if (command === 'verify') cmdVerify(argument);
    else {
      process.stderr.write(
        'Usage:\n' +
          '  node scripts/release/version.mjs get\n' +
          '  node scripts/release/version.mjs set <semver>\n' +
          '  node scripts/release/version.mjs bump <major|minor|patch>\n' +
          '  node scripts/release/version.mjs snapshot\n' +
          '  node scripts/release/version.mjs verify [tag]\n',
      );
      process.exit(2);
    }
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

export { incrementVersion, normaliseTag, snapshotVersion };
