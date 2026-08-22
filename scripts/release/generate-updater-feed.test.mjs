import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUpdaterFeed } from './generate-updater-feed.mjs';

const dir = mkdtempSync(join(tmpdir(), 'varve-updater-feed-'));

// Create test artifacts for all supported targets
const targets = [
  { name: 'Varve-0.2.0-linux-x86_64.AppImage', platform: 'linux-x86_64' },
  { name: 'Varve-0.2.0-linux-aarch64.AppImage', platform: 'linux-aarch64' },
  { name: 'Varve-0.2.0-windows-x86_64.exe', platform: 'windows-x86_64' },
  { name: 'Varve-0.2.0-windows-aarch64.exe', platform: 'windows-aarch64' },
  { name: 'Varve-0.2.0-macos-aarch64.app.tar.gz', platform: 'darwin-aarch64' },
];

for (const t of targets) {
  const artifact = join(dir, t.name);
  writeFileSync(artifact, Buffer.from(`signed ${t.platform} bytes`));
  writeFileSync(`${artifact}.sig`, `signature-${t.platform}\n`);
}

const feed = buildUpdaterFeed({
  dir,
  version: '0.2.0',
  channel: 'stable',
  baseUrl: 'https://github.com/K-Arthur/varve/releases/download/v0.2.0',
});

// Verify all targets are present
for (const t of targets) {
  assert.ok(feed.platforms[t.platform], `feed should contain ${t.platform}`);
  assert.match(feed.platforms[t.platform].url, new RegExp(`${t.name.replace('.', '\\.')}$`));
}
assert.equal(feed.platforms['linux-x86_64'].signature, 'signature-linux-x86_64');
assert.equal(feed.platforms['linux-aarch64'].signature, 'signature-linux-aarch64');
assert.equal(feed.platforms['darwin-aarch64'].signature, 'signature-darwin-aarch64');

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
