import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUpdaterFeed } from './generate-updater-feed.mjs';

const dir = mkdtempSync(join(tmpdir(), 'varve-updater-feed-'));
const artifact = join(dir, 'Varve-0.2.0-linux-x86_64.AppImage');
writeFileSync(artifact, Buffer.from('signed appimage bytes'));
writeFileSync(`${artifact}.sig`, 'signature-content\n');

const feed = buildUpdaterFeed({
  dir,
  version: '0.2.0',
  channel: 'stable',
  baseUrl: 'https://github.com/K-Arthur/varve/releases/download/v0.2.0',
});
assert.equal(feed.platforms['linux-x86_64'].signature, 'signature-content');
assert.match(feed.platforms['linux-x86_64'].url, /Varve-0\.2\.0-linux-x86_64\.AppImage$/);

assert.throws(
  () =>
    buildUpdaterFeed({ dir, version: '0.2.0', channel: 'stable', baseUrl: 'http://insecure.test' }),
  /HTTPS/,
);

// Nightly is a valid generator channel (builds on demand), but it must never
// leak into stable/beta output — the client endpoint per channel is the
// isolation boundary (docs/release/update-strategy.md §5).
const nightlyArtifact = join(dir, 'Varve-0.2.0-nightly.1-linux-x86_64.AppImage');
writeFileSync(nightlyArtifact, Buffer.from('nightly appimage bytes'));
writeFileSync(`${nightlyArtifact}.sig`, 'signature-content\n');
const nightly = buildUpdaterFeed({
  dir,
  version: '0.2.0-nightly.1',
  channel: 'nightly',
  baseUrl: 'https://nightly.example.invalid/varve',
});
assert.equal(nightly.platforms['linux-x86_64'].signature, 'signature-content');

console.log('generate-updater-feed tests passed');
