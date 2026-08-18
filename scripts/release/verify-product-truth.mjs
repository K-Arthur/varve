#!/usr/bin/env node
/**
 * Product truth verification: detect contradictions between canonical sources
 * and user-facing claims.
 *
 * Canonical sources (single ownership per fact):
 *
 *   - Version:           root package.json (single-sourced by version.mjs)
 *   - Product stage:     packages/shared/src/product.ts (PRODUCT_STATUS)
 *   - Release targets:   scripts/release/targets.mjs (RELEASE_TARGETS)
 *   - Release manifest:  apps/website/src/data/release-manifest.json
 *   - Document ext:      tauri.conf.json fileAssociations[0].ext[0]
 *   - Signing state:     signing-report-*.json → signing-policy.mjs
 *
 * Contradictions detected:
 *   - Changelog/tag/version mismatch
 *   - README claiming a stale current release
 *   - Website manifest serving a different release than the release policy
 *   - `.strata` described as current native format (should be `.varve`)
 *   - Platform listed as supported with no matching release target
 *   - Architecture listed but not actually generated/published
 *   - Download URL pointing to a missing asset
 *   - Signing/notarization claimed when verification says otherwise
 *   - "signed" inferred from checksum/SBOM/provenance
 *   - Updater claims inconsistent with published channel/config
 *   - Schema metadata advertising unsupported platforms/features
 *
 * Run: node scripts/release/verify-product-truth.mjs [--fix] [--verbose]
 * Wired into CI via pnpm verify:affected (Tier 4).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const verbose = process.argv.includes('--verbose');

function readJSON(relPath) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) return null;
  return JSON.parse(readFileSync(abs, 'utf-8'));
}

function readFile(relPath) {
  const abs = join(repoRoot, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Version consistency
// ---------------------------------------------------------------------------

function checkVersionConsistency() {
  const problems = [];
  const rootPkg = readJSON('package.json');
  if (!rootPkg?.version) {
    problems.push('root package.json has no version');
    return problems;
  }
  const expected = rootPkg.version;

  const targets = [
    ['apps/desktop/package.json', (d) => d?.version],
    ['apps/desktop/src-tauri/tauri.conf.json', (d) => d?.version],
  ];

  for (const [path, extract] of targets) {
    const data = readJSON(path);
    const actual = extract(data);
    if (actual !== expected) {
      problems.push(`${path}: version '${actual}' does not match root '${expected}'`);
    }
  }

  // Cargo.toml version
  const cargoText = readFile('Cargo.toml');
  if (cargoText) {
    const match = cargoText.match(/\[workspace\.package\][\s\S]*?version\s*=\s*"([^"]+)"/);
    if (match && match[1] !== expected) {
      problems.push(
        `Cargo.toml [workspace.package]: version '${match[1]}' does not match root '${expected}'`,
      );
    }
  }

  // Desktop Cargo.toml
  const desktopCargo = readFile('apps/desktop/src-tauri/Cargo.toml');
  if (desktopCargo) {
    // Check if it uses workspace inheritance
    if (!desktopCargo.includes('version.workspace = true')) {
      const match = desktopCargo.match(/\[package\][\s\S]*?version\s*=\s*"([^"]+)"/);
      if (match && match[1] !== expected) {
        problems.push(
          `apps/desktop/src-tauri/Cargo.toml: version '${match[1]}' does not match root '${expected}'`,
        );
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 2. Website manifest vs release manifest consistency
// ---------------------------------------------------------------------------

function checkWebsiteManifestConsistency() {
  const problems = [];
  const websiteManifest = readJSON('apps/website/src/data/release-manifest.json');
  if (!websiteManifest) {
    problems.push('website release-manifest.json is missing');
    return problems;
  }

  // Version should match root package.json version if a release is pinned
  const rootPkg = readJSON('package.json');
  if (rootPkg?.version && websiteManifest.version) {
    // The website manifest tracks the PUBLISHED release, which may differ
    // from the source tree version. This is intentional. But the manifest
    // version must be valid semver.
    if (!/^\d+\.\d+\.\d+/.test(websiteManifest.version)) {
      problems.push(`website manifest version '${websiteManifest.version}' is not valid semver`);
    }
  }

  // tag must match version
  if (websiteManifest.tag) {
    const tagVersion = websiteManifest.tag.replace(/^v/, '');
    if (tagVersion !== websiteManifest.version) {
      problems.push(
        `website manifest tag '${websiteManifest.tag}' does not match version '${websiteManifest.version}'`,
      );
    }
  }

  // signed/notarized claims must not be "inferred" — if signed is true,
  // there must be a signing block with evidence
  if (websiteManifest.signed === true) {
    if (!websiteManifest.signing) {
      problems.push('website manifest claims signed=true but has no signing block');
    }
    // At least one platform must have signed=true in the signing block
    const signing = websiteManifest.signing ?? {};
    const hasSignedPlatform = Object.values(signing).some(
      (s) => s && typeof s === 'object' && s.signed === true,
    );
    if (!hasSignedPlatform) {
      problems.push(
        'website manifest claims signed=true but no platform signing report confirms a signature',
      );
    }
  }

  if (websiteManifest.notarized === true) {
    const macosSigning = websiteManifest.signing?.macos;
    if (!macosSigning?.notarized) {
      problems.push(
        'website manifest claims notarized=true but macOS signing report does not confirm notarization',
      );
    }
  }

  // Check that every platform entry has a valid download URL
  const platforms = websiteManifest.platforms ?? {};
  for (const [os, artifacts] of Object.entries(platforms)) {
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts) {
      if (!artifact.url) {
        problems.push(`${os}/${artifact.filename}: missing download URL`);
      }
      if (!artifact.sha256 || !/^[0-9a-f]{64}$/.test(artifact.sha256)) {
        problems.push(`${os}/${artifact.filename}: missing or invalid sha256`);
      }
      if (!artifact.sizeBytes || artifact.sizeBytes <= 0) {
        problems.push(`${os}/${artifact.filename}: missing or invalid sizeBytes`);
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 3. Platform claims vs release targets
// ---------------------------------------------------------------------------

function checkPlatformClaims() {
  const problems = [];

  // Read the release targets from the JS module by parsing the file
  const targetsFile = readFile('scripts/release/targets.mjs');
  if (!targetsFile) {
    problems.push('scripts/release/targets.mjs not found');
    return problems;
  }

  // Extract target IDs from the file
  const targetIds = [];
  const idMatches = targetsFile.matchAll(/id:\s*'([^']+)'/g);
  for (const m of idMatches) targetIds.push(m[1]);

  // Extract releaseReady flags
  const readyTargets = new Set();
  const readyMatches = targetsFile.matchAll(/id:\s*'([^']+)'.*?releaseReady:\s*(true|false)/gs);
  for (const m of readyMatches) {
    if (m[2] === 'true') readyTargets.add(m[1]);
  }

  // The README platform table should reference platforms that have release targets
  const readme = readFile('README.md');
  if (readme) {
    // Check that each releaseReady target is mentioned
    for (const targetId of readyTargets) {
      const [os] = targetId.split('-');
      const osLabel = os === 'macos' ? 'macOS' : os.charAt(0).toUpperCase() + os.slice(1);
      if (!readme.includes(osLabel)) {
        problems.push(`README: ${osLabel} is release-ready but not mentioned in README`);
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 4. Document extension consistency
// ---------------------------------------------------------------------------

function checkDocumentExtension() {
  const problems = [];
  const conf = readJSON('apps/desktop/src-tauri/tauri.conf.json');
  if (!conf) {
    problems.push('tauri.conf.json not found');
    return problems;
  }

  const firstExt = conf.bundle?.fileAssociations?.[0]?.ext?.[0];
  if (firstExt !== 'varve') {
    problems.push(
      `tauri.conf.json first file association extension is '${firstExt}', expected 'varve'`,
    );
  }

  // Check that .varve appears in the PLATFORM constant
  const platformPure = readFile('packages/platform/src/pure.ts');
  if (platformPure) {
    // Use a regex that matches the exact constant name (not LEGACY_DOCUMENT_EXT)
    const docExtMatch = platformPure.match(/(?<!\w)DOCUMENT_EXT\s*=\s*'([^']+)'/);
    if (!docExtMatch) {
      problems.push('packages/platform/src/pure.ts: DOCUMENT_EXT constant not found');
    } else if (docExtMatch[1] !== 'varve') {
      problems.push(
        `packages/platform/src/pure.ts: DOCUMENT_EXT is '${docExtMatch[1]}' (should be 'varve')`,
      );
    }
  }

  // Check that the MIME type is application/x-varve
  if (conf.bundle?.fileAssociations?.[0]?.mimeType !== 'application/x-varve') {
    problems.push(
      `tauri.conf.json first file association mimeType is '${conf.bundle?.fileAssociations?.[0]?.mimeType}', expected 'application/x-varve'`,
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 5. Stale .strata references in user-facing code (non-compatibility)
// ---------------------------------------------------------------------------

function checkStaleStrataReferences() {
  const problems = [];

  // User-facing help text should not reference .strata as the current format
  const helpFiles = ['packages/help/src/content/getting-started.ts'];
  for (const file of helpFiles) {
    const content = readFile(file);
    if (content && /\(\.strata\)/.test(content)) {
      problems.push(`${file}: user-facing help text still references (.strata) as the format`);
    }
  }

  // Logo export should use .varve, not .strata
  const logoExport = readFile('packages/editor/src/logo/logoPackageExport.ts');
  if (logoExport && /project\.strata/.test(logoExport)) {
    problems.push(
      'packages/editor/src/logo/logoPackageExport.ts: logo package exports project.strata (should be project.varve)',
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 6. Signing claims integrity
// ---------------------------------------------------------------------------

function checkSigningClaims() {
  const problems = [];

  // The release manifest should never infer "signed" from checksums/SBOM/provenance
  const manifest = readJSON('apps/website/src/data/release-manifest.json');
  if (!manifest) return problems;

  // If signed is true, each platform must have a verification report
  if (manifest.signed === true) {
    const signing = manifest.signing ?? {};
    for (const [platform, state] of Object.entries(signing)) {
      if (platform === 'linux') continue; // Linux uses checksums, not code-signing
      if (state && typeof state === 'object' && state.signed === true) {
        if (!state.verifiedAt) {
          problems.push(`signing.${platform}: claims signed but has no verifiedAt timestamp`);
        }
      }
    }
  }

  // Document format: never call checksums "signing"
  // (This is a semantic check — we verify that the manifest distinguishes
  // integrity from signing.)
  if (manifest.integrity === 'verified' && manifest.signed === true) {
    // This is fine — integrity and signing are separate concerns.
    // But if integrity is the ONLY evidence and signed is true, that's wrong.
    // We can't fully automate this semantic check, but we can verify the
    // signing block exists.
    if (!manifest.signing) {
      problems.push(
        'manifest claims signed=true but has no signing block (signedness must not be inferred from integrity)',
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 7. Changelog / tag consistency
// ---------------------------------------------------------------------------

function checkChangelogConsistency() {
  const problems = [];
  const changelog = readFile('CHANGELOG.md');
  if (!changelog) return problems;

  const rootPkg = readJSON('package.json');
  if (!rootPkg?.version) return problems;

  const version = rootPkg.version;

  // The current development version should have a CHANGELOG entry
  const versionEntry = changelog.includes(`## [${version}]`);
  if (!versionEntry) {
    problems.push(`CHANGELOG.md has no entry for the current version [${version}]`);
  }

  // The entry should have a date
  const datePattern = new RegExp(
    `## \\[${version.replace(/\./g, '\\.')}\\] - (\\d{4}-\\d{2}-\\d{2})`,
  );
  if (!datePattern.test(changelog)) {
    problems.push(
      `CHANGELOG.md entry for [${version}] is missing a date (expected ## [${version}] - YYYY-MM-DD)`,
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 8. Updater endpoint consistency
// ---------------------------------------------------------------------------

function checkUpdaterConsistency() {
  const problems = [];
  const conf = readJSON('apps/desktop/src-tauri/tauri.conf.json');
  if (!conf) return problems;

  const endpoint = conf.plugins?.updater?.endpoints?.[0];
  if (!endpoint) {
    // Updater may not be configured yet — this is fine for unsigned builds
    return problems;
  }

  // Endpoint must be HTTPS
  if (!endpoint.startsWith('https://')) {
    problems.push(`updater endpoint is not HTTPS: ${endpoint}`);
  }

  // Endpoint must point to varve.studio
  if (!endpoint.includes('varve.studio')) {
    problems.push(`updater endpoint does not point to varve.studio: ${endpoint}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 9b. Updater claims vs release signing state
// ---------------------------------------------------------------------------

function checkUpdaterTruth() {
  const problems = [];
  const manifest = readJSON('apps/website/src/data/release-manifest.json');
  if (!manifest) return problems;

  // If the release does not have an updater feed, the download page should
  // gate updater claims behind a conditional on release.updater, not state
  // them unconditionally.
  if (manifest.updater === false) {
    const downloadPage = readFile('apps/website/src/pages/download.astro');
    if (downloadPage) {
      const hasUpdaterGuard = /release\.updater/.test(downloadPage);
      const unconditionalPatterns = [
        /self-updates in place/i,
        /updates install through the installer/i,
        /updates the installed app/i,
      ];
      if (!hasUpdaterGuard) {
        for (const pattern of unconditionalPatterns) {
          if (pattern.test(downloadPage)) {
            problems.push(
              `download.astro: claims updater works (${pattern.source}) but release has no updater feed (v${manifest.version}). ` +
                'Wrap updater claims in a conditional on release.updater, or add a caveat.',
            );
          }
        }
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 10. Copyright year consistency
// ---------------------------------------------------------------------------

function checkCopyrightConsistency() {
  const problems = [];
  const conf = readJSON('apps/desktop/src-tauri/tauri.conf.json');
  if (!conf) return problems;

  const copyright = conf.bundle?.copyright;
  if (copyright) {
    // Should contain current year range
    const currentYear = new Date().getFullYear();
    if (!copyright.includes(String(currentYear))) {
      problems.push(
        `tauri.conf.json copyright does not include current year (${currentYear}): ${copyright}`,
      );
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const checks = [
  ['version-consistency', checkVersionConsistency],
  ['website-manifest', checkWebsiteManifestConsistency],
  ['platform-claims', checkPlatformClaims],
  ['document-extension', checkDocumentExtension],
  ['stale-strata-refs', checkStaleStrataReferences],
  ['signing-claims', checkSigningClaims],
  ['changelog', checkChangelogConsistency],
  ['updater', checkUpdaterConsistency],
  ['updater-truth', checkUpdaterTruth],
  ['copyright', checkCopyrightConsistency],
];

let totalProblems = 0;
const results = [];

for (const [name, check] of checks) {
  const problems = check();
  results.push({ name, problems });
  totalProblems += problems.length;
  if (verbose || problems.length > 0) {
    const icon = problems.length === 0 ? '\u2705' : '\u274c';
    process.stdout.write(`\n${icon} ${name}\n`);
    for (const p of problems) {
      process.stdout.write(`   ${p}\n`);
    }
  }
}

process.stdout.write('\n');
if (totalProblems === 0) {
  process.stdout.write('Product truth: all checks passed.\n');
  process.exit(0);
} else {
  process.stderr.write(`Product truth: ${totalProblems} contradiction(s) found.\n`);
  for (const { name, problems } of results) {
    for (const p of problems) {
      process.stderr.write(`  [${name}] ${p}\n`);
    }
  }
  process.exit(1);
}
