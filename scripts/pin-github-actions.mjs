#!/usr/bin/env node

/**
 * GitHub Actions SHA Pinning Tool
 *
 * Replaces mutable action version references (@v4, @stable, @main, or a
 * branch/tool ref such as @cargo-llvm-cov) with commit SHAs for supply chain
 * security, and VERIFIES every pinned SHA actually resolves upstream.
 *
 * On 2026-08-01 every workflow in this repo was pinned to fabricated SHAs
 * (none of the 40-char hashes existed in the upstream action repos), which
 * killed every job at the "Set up job" step. The --verify mode is the
 * regression guard: it resolves each pinned SHA against the GitHub API and
 * fails when a SHA does not exist.
 *
 * Research basis:
 *   - GitHub Actions security hardening: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
 *   - OpenSSF Scorecard "Pinned-Dependencies" check
 *
 * Usage:
 *   node scripts/pin-github-actions.mjs --check    # static: no mutable refs, SHA length + hex
 *   node scripts/pin-github-actions.mjs --verify   # network: every pinned SHA resolves upstream
 *   node scripts/pin-github-actions.mjs --pin      # resolve mutable refs to SHAs (network)
 *   node scripts/pin-github-actions.mjs --update   # re-resolve all SHA pins to latest tags
 *
 * CI wiring: `--verify` should run on every push/PR that touches workflows.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKFLOWS_DIR = '.github/workflows';

// Authoritative pin table. Each entry maps the action repo to the full 40-char
// SHA of the release we use. These SHAs were resolved from the GitHub API on
// 2026-08-01 and verified (action.yml present at the commit).
//
// 2026-08-06: actions/checkout moved v4.2.2 -> v6.0.3 (commit
// df4cb1c069e1874edd31b4311f1884172cec0e10) because v4 targets Node 20, which
// GitHub deprecated on hosted runners (2025-09-19 announcement; every run now
// logs "actions/checkout@<sha> targets Node 20 but is being forced to run on
// Node 24"). v6.0.3 runs on node24 natively. v6.1.0+ backports the
// `allow-unsafe-pr-checkout` BREAKING change; this repo does not use
// pull_request_target, so v6.0.3 is the conservative choice.
const ACTION_SHAS = {
  'actions/checkout': 'df4cb1c069e1874edd31b4311f1884172cec0e10', // v6.0.3 (node24)
  'actions/setup-node': '1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a', // v4.2.0
  'actions/upload-artifact': '65c4c4a1ddee5b72f698fdd19549f0f0fb45cf08', // v4.6.0
  'actions/download-artifact': 'd3f86a106a0bac45b974a628896c90dbdf5c8093', // v4.3.0
  'actions/upload-pages-artifact': '56afc609e74202658d3ffba0e8f6dda462b719fa', // v3.0.1
  'actions/deploy-pages': 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e', // v4.0.5
  'actions/setup-python': '42375524e23c412d93fb67b49958b491fce71c38', // v5.4.0
  'dtolnay/rust-toolchain': '4cda84d5c5c54efe2404f9d843567869ab1699d4', // stable branch head
  'Swatinem/rust-cache': '3cf7f8cc28d1b4e7d01e3783be10a97d55d483c8', // v2.7.1
  'taiki-e/install-action': '6a1bd70eaac3c8bdf093356838d7ee09fda951cf', // v2
  'softprops/action-gh-release': 'c95fe1489396fe8a9eb87c0abf8aa5b2ef267fda', // v2.2.1
  'pnpm/action-setup': 'fe02b34f77f8bc703788d5817da081398fad5dd2', // v4.0.0
};

const SHA_RE = /^[0-9a-f]{40}$/;

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = { check: false, pin: false, update: false, verify: false };

  for (const arg of args) {
    if (arg === '--check') flags.check = true;
    if (arg === '--pin') flags.pin = true;
    if (arg === '--update') flags.update = true;
    if (arg === '--verify') flags.verify = true;
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
  return { action, version: version || null, original: match[0] };
}

// A reference is only "pinned" when it is a full 40-char hex SHA. Everything
// else (@v4, @v4.0.0, @stable, @main, @cargo-llvm-cov, no ref) is mutable.
function isMutableVersion(version) {
  if (!version) return true;
  return !SHA_RE.test(version);
}

async function resolveRefSHA(repo, ref, token) {
  // Prefer the tag object, then dereference annotated tags to the commit.
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: token ? `Bearer ${token}` : undefined,
  };
  const base = `https://api.github.com/repos/${repo}/git/refs/tags/${ref}`;

  let res;
  try {
    res = await fetch(base, { headers });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const refData = await res.json();
  const oid = refData.object?.sha;
  if (!oid) return null;
  if (refData.object?.type === 'commit') return oid;

  // Annotated tag: dereference to the underlying commit.
  try {
    const tagRes = await fetch(`https://api.github.com/repos/${repo}/git/tags/${oid}`, {
      headers,
    });
    if (!tagRes.ok) return oid;
    const tagData = await tagRes.json();
    return tagData.object?.sha || oid;
  } catch {
    return oid;
  }
}

async function resolveBranchSHA(repo, branch, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: token ? `Bearer ${token}` : undefined,
  };
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/branches/${branch}`, {
      headers,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.commit?.sha || null;
  } catch {
    return null;
  }
}

async function resolveActionSHA(action, ref, token) {
  if (ref && SHA_RE.test(ref)) return ref;

  if (ref && (ref === 'main' || ref === 'master')) {
    return resolveBranchSHA(action, ref, token);
  }

  if (ref && (ref === 'stable' || ref === 'nightly')) {
    return resolveBranchSHA(action, ref, token);
  }

  if (ref) {
    return resolveRefSHA(action, ref, token);
  }

  // No ref at all — fall back to the default branch.
  return resolveBranchSHA(action, 'main', token) || resolveBranchSHA(action, 'master', token);
}

// Returns true when the commit exists upstream AND carries action.yml.
async function verifyPinnedSHA(action, sha) {
  const actionYml = await fetch(`https://raw.githubusercontent.com/${action}/${sha}/action.yml`, {
    redirect: 'follow',
  });
  if (actionYml.ok) return { ok: true, why: '' };
  const actionYaml = await fetch(`https://raw.githubusercontent.com/${action}/${sha}/action.yaml`, {
    redirect: 'follow',
  });
  if (actionYaml.ok) return { ok: true, why: '' };
  return {
    ok: false,
    why: `no action.yml/action.yaml at commit (HTTP ${actionYml.status}/${actionYaml.status})`,
  };
}

async function collectUses() {
  const files = getWorkflowFiles();
  const uses = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim().startsWith('#') || line.trim().startsWith('#')) continue;
      const use = extractActionUses(line);
      if (use) {
        uses.push({ file, line: i + 1, ...use });
      }
    }
  }
  return uses;
}

async function runCheck() {
  const uses = await collectUses();
  const problems = [];
  const seen = new Set();

  for (const u of uses) {
    const key = `${u.action}@${u.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isMutableVersion(u.version)) {
      problems.push(
        `${u.file}:${u.line} - ${u.action}@${u.version || '(none)'} is NOT pinned to a SHA`,
      );
    }
  }

  if (problems.length === 0) {
    console.log('All action references are pinned to 40-char SHAs.');
    return true;
  }

  console.log(`${problems.length} unpinned action reference(s):`);
  for (const p of problems) console.log(`  ${p}`);
  return false;
}

async function runVerify() {
  const uses = await collectUses();
  const failures = [];
  const checked = new Set();
  let total = 0;

  for (const u of uses) {
    const key = `${u.action}@${u.version}`;
    if (!u.version || !SHA_RE.test(u.version)) continue;
    if (checked.has(key)) continue;
    checked.add(key);
    total += 1;
    const result = await verifyPinnedSHA(u.action, u.version);
    if (!result.ok) {
      failures.push(`${u.file}:${u.line} - ${key} does NOT resolve upstream: ${result.why}`);
    }
  }

  if (failures.length === 0) {
    console.log(`Verified ${total} unique pinned SHA(s) resolve upstream with action metadata.`);
    return true;
  }

  console.error(`${failures.length} fabricated/non-resolving pinned SHA(s):`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('A fabricated SHA kills every job at the "Set up job" step. Fix with:');
  console.error('  node scripts/pin-github-actions.mjs --pin');
  return false;
}

async function runPin() {
  const files = getWorkflowFiles();
  const uses = await collectUses();
  const token = getToken();
  let totalPinned = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n');
    let modified = false;

    for (const u of uses) {
      if (u.file !== file) continue;

      // Authoritative table wins: force-correct any ref (mutable tag OR
      // fabricated SHA) to the verified table SHA. This repairs the
      // 2026-08-01 outage where all workflows carried fake 40-char SHAs.
      const tableSha = ACTION_SHAS[u.action];
      let sha = tableSha;
      if (!sha) {
        if (!isMutableVersion(u.version)) continue;
        sha = await resolveActionSHA(u.action, u.version, token);
      }

      if (sha && SHA_RE.test(sha)) {
        const pinned = `uses: ${u.action}@${sha}`;
        lines[u.line - 1] = lines[u.line - 1].replace(u.original, pinned);
        modified = true;
        totalPinned += 1;
        console.log(`  Pinned ${u.action}@${u.version || '(none)'} -> ${sha.substring(0, 7)}`);
      } else {
        console.warn(
          `  WARN: could not resolve ${u.action}@${u.version || '(none)'}; leaving as-is`,
        );
      }
    }

    if (modified) {
      writeFileSync(file, lines.join('\n'));
    }
  }

  if (totalPinned > 0) {
    console.log(`\nPinned ${totalPinned} reference(s).`);
  } else {
    console.log('No mutable references to pin.');
  }
  return true;
}

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execSync('gh auth token', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim();
  } catch {
    return null;
  }
}

function showHelp() {
  console.log('GitHub Actions SHA Pinning Tool');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/pin-github-actions.mjs --check    # static pin check (no network)');
  console.log(
    '  node scripts/pin-github-actions.mjs --verify   # resolve every SHA upstream (network)',
  );
  console.log(
    '  node scripts/pin-github-actions.mjs --pin      # pin mutable refs to SHAs (network)',
  );
  console.log('  node scripts/pin-github-actions.mjs --update   # re-resolve pins to latest tags');
}

async function main() {
  const flags = parseArgs();
  const files = getWorkflowFiles();
  console.log(`Found ${files.length} workflow file(s)`);

  if (flags.check) {
    const ok = await runCheck();
    process.exit(ok ? 0 : 1);
  }

  if (flags.verify) {
    const ok = await runVerify();
    process.exit(ok ? 0 : 1);
  }

  if (flags.pin) {
    await runPin();
    process.exit(0);
  }

  if (flags.update) {
    console.log('--update is implemented as --pin with a refreshed ACTION_SHAS table. Run --pin.');
    await runPin();
    process.exit(0);
  }

  showHelp();
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`pin-github-actions failed: ${err.message}`);
    process.exit(1);
  });
}

export { ACTION_SHAS, extractActionUses, isMutableVersion, SHA_RE, verifyPinnedSHA };
