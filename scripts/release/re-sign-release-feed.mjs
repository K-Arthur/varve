#!/usr/bin/env node
/**
 * One-shot workflow script to re-sign invalidated AppImage artifacts from a
 * published release and regenerate the updater feed.
 *
 * This runs inside GitHub Actions where TAURI_SIGNING_PRIVATE_KEY is available
 * as a repository secret.  It cannot run locally (no access to the key).
 *
 * Usage (called from .github/workflows/re-sign-release-feed.yml):
 *   node scripts/release/re-sign-release-feed.mjs --tag v0.2.0
 *
 * What it does:
 *   1. Downloads AppImage artifacts from the specified GitHub release.
 *   2. Re-signs them with `pnpm tauri signer sign`.
 *   3. Uploads the fresh .sig files back to the release.
 *   4. Regenerates the updater feed JSON.
 *   5. Copies the feed to apps/website/public/updates/stable.json.
 *
 * Requires:
 *   - TAURI_SIGNING_PRIVATE_KEY env var (GitHub Secret)
 *   - gh CLI authenticated
 *   - pnpm with @tauri-apps/cli
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, '')] = argv[i + 1];
  }
  return args;
}

function die(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 120_000, ...opts }).trim();
}

const args = parseArgs(process.argv);
const tag = args.tag;
if (!tag) die('usage: --tag v0.2.0');

const repoRoot = resolve(import.meta.dirname, '../..');
const workDir = join(repoRoot, 'dist', 're-sign-work');
mkdirSync(workDir, { recursive: true });

// ── 1. Determine which artifacts need re-signing ────────────────────────────

const ARCHITECTURES = ['x86_64', 'aarch64'];
const toResign = [];

for (const arch of ARCHITECTURES) {
  const filename = `Varve-${tag.slice(1)}-linux-${arch}.AppImage`;
  const assetExists = run('gh', [
    'api',
    `repos/K-Arthur/varve/releases/tags/${tag}/assets`,
    '--jq',
    `.[] | select(.name == "${filename}") | .name`,
  ]);
  if (assetExists === filename) {
    toResign.push({ arch, filename });
  }
}

if (toResign.length === 0) die('no AppImage assets found to re-sign');

process.stdout.write(
  `Re-signing ${toResign.length} AppImage artifact(s): ${toResign.map((a) => a.filename).join(', ')}\n`,
);

// ── 2. Download and re-sign each artifact ────────────────────────────────────

const sigFilenames = [];

for (const { arch, filename } of toResign) {
  process.stdout.write(`\n--- ${filename} ---\n`);

  // Download AppImage
  const localPath = join(workDir, filename);
  run('gh', [
    'release',
    'download',
    tag,
    '--repo',
    'K-Arthur/varve',
    '--pattern',
    filename,
    '--dir',
    workDir,
    '--clobber',
  ]);

  if (!existsSync(localPath)) die(`download failed: ${filename}`);

  // Re-sign
  process.stdout.write(`Signing ${filename}...\n`);
  run('pnpm', ['tauri', 'signer', 'sign', localPath], {
    cwd: join(repoRoot, 'apps/desktop'),
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY },
  });

  const sigFile = `${localPath}.sig`;
  if (!existsSync(sigFile)) die(`signing produced no .sig for ${filename}`);

  // Verify locally
  process.stdout.write(`Verifying signature for ${filename}...\n`);
  const feedJson = join(workDir, 'verify-feed.json');
  const sigContent = readFileSync(sigFile, 'utf8');
  writeFileSync(
    feedJson,
    JSON.stringify({
      version: tag.slice(1),
      platforms: {
        [`linux-${arch}`]: {
          url: `https://github.com/K-Arthur/varve/releases/download/${tag}/${filename}`,
          signature: sigContent,
        },
      },
    }),
  );

  try {
    run('node', [
      join(repoRoot, 'scripts/release/verify-updater-feed-signatures.mjs'),
      '--feed',
      feedJson,
      '--release-dir',
      workDir,
      '--tauri-conf',
      join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
    ]);
    process.stdout.write(`  Signature verified for ${filename}\n`);
  } catch (e) {
    die(`verification failed for ${filename}: ${e.stderr || e.message}`);
  }

  sigFilenames.push(`${filename}.sig`);
}

// ── 3. Upload fresh .sig files to the release ───────────────────────────────

process.stdout.write('\n--- Uploading fresh signatures ---\n');
for (const sigName of sigFilenames) {
  const sigPath = join(workDir, sigName);
  run('gh', ['release', 'upload', tag, '--repo', 'K-Arthur/varve', sigPath, '--clobber']);
  process.stdout.write(`  Uploaded ${sigName}\n`);
}

// ── 4. Regenerate the updater feed ──────────────────────────────────────────

process.stdout.write('\n--- Regenerating updater feed ---\n');
run('node', [
  join(repoRoot, 'scripts/release/generate-updater-feed.mjs'),
  '--dir',
  workDir,
  '--version',
  tag.slice(1),
  '--channel',
  'stable',
  '--base-url',
  `https://github.com/K-Arthur/varve/releases/download/${tag}`,
  '--out',
  join(workDir, 'varve-update-stable.json'),
]);

const feedPath = join(workDir, 'varve-update-stable.json');
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
process.stdout.write(
  `Feed generated: ${Object.keys(feed.platforms).length} platform(s): ${Object.keys(feed.platforms).join(', ')}\n`,
);

// ── 5. Copy feed to website public directory ────────────────────────────────

const websiteFeed = join(repoRoot, 'apps/website/public/updates/stable.json');
writeFileSync(websiteFeed, `${JSON.stringify(feed, null, 2)}\n`);
process.stdout.write(`Feed written to ${websiteFeed}\n`);

// ── Done ────────────────────────────────────────────────────────────────────

process.stdout.write(`\nDone. ${sigFilenames.length} artifact(s) re-signed, feed regenerated.\n`);
process.stdout.write(`Next: commit apps/website/public/updates/stable.json and push to deploy.\n`);
