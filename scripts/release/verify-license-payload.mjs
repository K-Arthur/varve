#!/usr/bin/env node
/** Verify legal files at the Tauri-mapped location under an extracted resource root. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rootFiles = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES'];
const licenseDirectory = 'THIRD_PARTY_LICENSES';
const tauriResourcePrefix = ['_up_', '_up_', '_up_'];

function listFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(path);
  }
  return files.sort();
}

function isRegularFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function relativePosix(root, path) {
  return relative(root, path).split(sep).join('/');
}

/**
 * Check the notice payload copied to a Tauri resource directory.
 * Relative `../../../` sources are materialized below `$RESOURCES/_up_/_up_/_up_`.
 * Other app resources may share this directory; the THIRD_PARTY_LICENSES
 * subtree must match the source exactly.
 */
export function verifyLicensePayload({ sourceRoot = repoRoot, resourceRoot }) {
  if (!resourceRoot) throw new Error('resourceRoot is required');

  const source = resolve(sourceRoot);
  const resources = join(resolve(resourceRoot), ...tauriResourcePrefix);
  const problems = [];
  const expectedPaths = [...rootFiles];
  const sourceLicenseDir = join(source, licenseDirectory);

  if (!existsSync(sourceLicenseDir) || !lstatSync(sourceLicenseDir).isDirectory()) {
    problems.push(`Missing source directory: ${licenseDirectory}/`);
  } else {
    expectedPaths.push(...listFiles(sourceLicenseDir).map((path) => relativePosix(source, path)));
  }

  if (!expectedPaths.some((path) => path.startsWith(`${licenseDirectory}/`))) {
    problems.push(`No license text files found under ${licenseDirectory}/`);
  }

  for (const path of rootFiles) {
    const sourcePath = join(source, path);
    if (!isRegularFile(sourcePath)) {
      problems.push(`Missing source file: ${path}`);
    }
  }

  for (const relativePath of expectedPaths) {
    const sourcePath = join(source, relativePath);
    const resourcePath = join(resources, ...relativePath.split('/'));
    if (!isRegularFile(resourcePath)) {
      problems.push(`Missing packaged file: ${relativePath}`);
      continue;
    }
    if (!isRegularFile(sourcePath)) {
      problems.push(`Missing or non-regular source file: ${relativePath}`);
      continue;
    }
    if (digest(sourcePath) !== digest(resourcePath)) {
      problems.push(`Packaged file differs from source: ${relativePath}`);
    }
  }

  const expectedLicenseFiles = new Set(
    expectedPaths.filter((path) => path.startsWith(`${licenseDirectory}/`)),
  );
  const packagedLicenseDir = join(resources, licenseDirectory);
  const packagedLicenseFiles = listFiles(packagedLicenseDir).map((path) =>
    relativePosix(resources, path),
  );
  for (const path of packagedLicenseFiles) {
    if (!expectedLicenseFiles.has(path)) problems.push(`Unexpected packaged file: ${path}`);
  }

  return {
    filesChecked: expectedPaths.length,
    problems,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== '--resource-root' && key !== '--source-root') {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['resource-root']) {
    throw new Error(
      'Usage: node scripts/release/verify-license-payload.mjs --resource-root <Tauri $RESOURCES root; payload expected under _up_/_up_/_up_>',
    );
  }

  const result = verifyLicensePayload({
    sourceRoot: args['source-root'] ?? repoRoot,
    resourceRoot: args['resource-root'],
  });
  if (result.problems.length > 0) {
    process.stderr.write('License payload verification FAILED:\n');
    for (const problem of result.problems) process.stderr.write(`  - ${problem}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`License payload verified (${result.filesChecked} files).\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
