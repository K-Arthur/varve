#!/usr/bin/env node
/**
 * Generate the static JSON consumed by Tauri's updater plugin.
 *
 * This runs after the release trust gate and before final checksums. It only
 * emits targets whose Tauri updater bundle and detached signature both exist,
 * and it refuses to publish a feed entry for a missing or empty signature.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TARGETS = [
  { key: 'linux-x86_64', filename: (v) => `Varve-${v}-linux-x86_64.AppImage` },
  { key: 'linux-aarch64', filename: (v) => `Varve-${v}-linux-aarch64.AppImage` },
  { key: 'windows-x86_64', filename: (v) => `Varve-${v}-windows-x86_64.exe` },
  { key: 'windows-aarch64', filename: (v) => `Varve-${v}-windows-aarch64.exe` },
  { key: 'darwin-aarch64', filename: (v) => `Varve-${v}-macos-aarch64.app.tar.gz` },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}
export function buildUpdaterFeed({
  dir,
  version,
  channel,
  baseUrl,
  notes = '',
  publishedAt = null,
}) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid updater feed version: ${version}`);
  }
  if (!['stable', 'beta', 'nightly'].includes(channel)) {
    throw new Error(`Invalid updater feed channel: ${channel}`);
  }
  if (!/^https:\/\//.test(baseUrl)) throw new Error('Updater feed base URL must use HTTPS');

  const platforms = {};
  for (const target of TARGETS) {
    const filename = target.filename(version);
    const artifact = join(dir, filename);
    if (!existsSync(artifact)) continue;
    if (!statSync(artifact).isFile() || statSync(artifact).size === 0) {
      throw new Error(`Updater artifact is empty or not a file: ${filename}`);
    }
    const signature = `${artifact}.sig`;
    if (!existsSync(signature) || !statSync(signature).isFile() || statSync(signature).size === 0) {
      throw new Error(`Updater artifact ${filename} is missing its non-empty .sig`);
    }
    const signatureContent = readFileSync(signature, 'utf8').trim();
    if (!signatureContent) throw new Error(`Updater signature is empty: ${filename}.sig`);
    platforms[target.key] = {
      url: `${baseUrl.replace(/\/$/, '')}/${encodeURI(filename)}`,
      signature: signatureContent,
    };
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error('No signed Tauri updater artifacts were found; refusing to write a feed');
  }
  return {
    version,
    notes,
    ...(publishedAt ? { pub_date: publishedAt } : {}),
    platforms,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolve(args.dir ?? 'dist/release');
  const version =
    args.version ?? JSON.parse(readFileSync(join(dir, 'release-manifest.json'), 'utf8')).version;
  const channel = args.channel ?? 'stable';
  const baseUrl =
    args['base-url'] ?? `https://github.com/K-Arthur/varve/releases/download/v${version}`;
  const output = resolve(args.out ?? join(dir, `varve-update-${channel}.json`));
  const feed = buildUpdaterFeed({
    dir,
    version,
    channel,
    baseUrl,
    notes: args.notes ?? '',
    publishedAt: args['published-at'] ?? null,
  });
  writeFileSync(output, `${JSON.stringify(feed, null, 2)}\n`);
  process.stdout.write(
    `Updater feed written: ${output}\nTargets: ${Object.keys(feed.platforms).join(', ')}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
