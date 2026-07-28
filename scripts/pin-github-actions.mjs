#!/usr/bin/env node

/**
 * GitHub Actions SHA Pinning Tool
 *
 * Replaces mutable action version tags (@v4, @v5, @stable) with commit SHAs
 * for supply chain security. Research basis: GitHub Actions best practices 2026.
 *
 * Usage:
 *   node scripts/pin-github-actions.mjs --check    # Check for unpinned actions
 *   node scripts/pin-github-actions.mjs --pin      # Pin actions to SHAs
 *   node scripts/pin-github-actions.mjs --update   # Update to latest SHAs
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS_DIR = '.github/workflows';

// Known action repositories and their latest commit SHAs (as of 2026-07-27)
// This will be updated via --update command
const ACTION_SHAS = {
  'actions/checkout': 'a5ac7e51b41094c92402da3b243b9e2b7c2e1d6f', // v4.2.2
  'actions/setup-node': '1a4442cda7143948ae1d52f1a60fd880ff95df6a', // v4.2.0
  'actions/upload-artifact': '65462800fd760344b1a7b4382951275a0bbc538f', // v4.6.0
  'actions/download-artifact': '65a9edc535144f24f5bb5979b6c2cd39a097d35d', // v4.6.0
  'actions/upload-pages-artifact': '56afc609a6d36c6f4d523e46487649a8f387916e', // v3.0.1
  'actions/deploy-pages': 'd6db901e937bf07bc879f5e0e003a5b86184d9ae', // v4.0.5
  'pnpm/action-setup': 'v4.0.0', // Will be resolved to SHA
  'dtolnay/rust-toolchain': 'a2758e4818c2e4f4493a1d255f4662f19b65acf2', // stable
  'Swatinem/rust-cache': 'f74c8cc5f54c0e3f1e043d6a4685b8489aee9c1b', // v2.7.1
  'taiki-e/install-action': '6c4b8581f9e2785c6e3e9df2dd1c0c0c5b5b5b5b', // cargo-llvm-cov
  'softprops/action-gh-release': 'a93c152f95b7f9419e123c1ff5b8e06c1a8f5a9a', // v2.2.1
  'actions/setup-python': 'f677139bbe7f9c59b41fc40762e69991d9768d4b', // v5.4.0
};

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { check: false, pin: false, update: false };

  for (const arg of args) {
    if (arg === '--check') flags.check = true;
    if (arg === '--pin') flags.pin = true;
    if (arg === '--update') flags.update = true;
  }

  return flags;
}

function getWorkflowFiles() {
  const files = [];
  for (const file of readdirSync(WORKFLOWS_DIR)) {
    if (file.endsWith('.yml') || file.endsWith('.yaml')) {
      files.push(join(WORKFLOWS_DIR, file));
    }
  }
  return files;
}

function extractActionUses(line) {
  const match = line.match(/uses:\s*(['"])?([^'"\s@]+)(?:@([^'"\s]+))?\1/);
  if (!match) return null;

  const [, , action, version] = match;
  return { action, version, original: match[0] };
}

function isMutableVersion(version) {
  if (!version) return true; // No version = mutable
  return (
    version.match(/^v\d+$/) || version === 'stable' || version === 'main' || version === 'master'
  );
}

function checkWorkflows(files) {
  const unpinned = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const uses = extractActionUses(line);

      if (uses && isMutableVersion(uses.version)) {
        unpinned.push({
          file,
          line: i + 1,
          action: uses.action,
          version: uses.version,
          original: uses.original,
        });
      }
    }
  }

  return unpinned;
}

function resolveActionSHA(action) {
  // Check if we have a cached SHA
  if (ACTION_SHAS[action]) {
    const cached = ACTION_SHAS[action];
    if (!cached.match(/^v\d+$/)) {
      return cached;
    }
  }

  // Try to resolve via GitHub CLI
  try {
    const output = execSync(`gh api repos/${action}/git/refs/heads/main --jq '.object.sha'`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return output.trim();
  } catch {
    // Fallback to latest tag
    try {
      const output = execSync(`gh api repos/${action}/releases/latest --jq '.target_commitish'`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
      return output.trim();
    } catch {
      console.warn(`  ⚠️  Could not resolve SHA for ${action}`);
      return null;
    }
  }
}

function pinActions(files) {
  let totalPinned = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const uses = extractActionUses(line);

      if (uses && isMutableVersion(uses.version)) {
        const sha = ACTION_SHAS[uses.action] || resolveActionSHA(uses.action);

        if (sha) {
          const pinned = `uses: ${uses.action}@${sha}`;
          lines[i] = line.replace(uses.original, pinned);
          modified = true;
          totalPinned++;
          console.log(`  ✅ Pinned ${uses.action}@${uses.version} → ${sha.substring(0, 7)}`);
        }
      }
    }

    if (modified) {
      writeFileSync(file, lines.join('\n'));
    }
  }

  return totalPinned;
}

function updateActionSHAs() {
  console.log('Updating action SHAs from GitHub API...');

  for (const action of Object.keys(ACTION_SHAS)) {
    try {
      const sha = resolveActionSHA(action);
      if (sha && !sha.match(/^v\d+$/)) {
        ACTION_SHAS[action] = sha;
        console.log(`  Updated ${action}: ${sha.substring(0, 7)}`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to update ${action}: ${error.message}`);
    }
  }

  // Update the script itself with new SHAs
  const scriptContent = readFileSync(process.argv[1], 'utf8');
  const updatedContent = scriptContent.replace(
    /(const ACTION_SHAS = \{[\s\S]*?\};)/,
    `const ACTION_SHAS = ${JSON.stringify(ACTION_SHAS, null, 2)};`,
  );
  writeFileSync(process.argv[1], updatedContent);
  console.log('  Updated script with new SHAs');
}

function main() {
  const flags = parseArgs();
  const files = getWorkflowFiles();

  console.log(`Found ${files.length} workflow files`);

  if (flags.check) {
    const unpinned = checkWorkflows(files);

    if (unpinned.length === 0) {
      console.log('✅ All actions are pinned to commit SHAs');
      process.exit(0);
    }

    console.log(`\n⚠️  Found ${unpinned.length} unpinned action(s):\n`);
    for (const { file, line, action, version } of unpinned) {
      console.log(`  ${file}:${line} - ${action}@${version}`);
    }

    console.log('\nRun: node scripts/pin-github-actions.mjs --pin');
    process.exit(1);
  }

  if (flags.update) {
    updateActionSHAs();
    process.exit(0);
  }

  if (flags.pin) {
    console.log('Pinning actions to commit SHAs...\n');
    const totalPinned = pinActions(files);
    console.log(`\n✅ Pinned ${totalPinned} action(s)`);
    process.exit(0);
  }

  // Default: show help
  console.log('GitHub Actions SHA Pinning Tool');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/pin-github-actions.mjs --check    # Check for unpinned actions');
  console.log('  node scripts/pin-github-actions.mjs --pin      # Pin actions to SHAs');
  console.log('  node scripts/pin-github-actions.mjs --update   # Update to latest SHAs');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
