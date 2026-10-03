#!/usr/bin/env node
// Fetch one matching published 0.2.1 installer; verify actual bytes against its integrity metadata.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { normalizeArchitecture } from '../targets.mjs';
import { verifyReleaseIntegrity } from '../verify-release-data.mjs';
export function selectPublishedInstaller({ release, manifest, checksumsText, target, format }) {
  assert.equal(release.draft, false, 'Old baseline must be published');
  assert.equal(release.tag_name, 'v0.2.1', 'Use the requested published baseline');
  assert.match(target, /^(linux|windows|macos)-(x86_64|aarch64)$/);
  const [os, arch] = target.split('-');
  const { artifacts } = verifyReleaseIntegrity({
    tag: release.tag_name,
    manifest,
    checksumsText,
    assetNames: release.assets.map((a) => a.name),
  });
  const candidates = artifacts.filter(
    (a) => a.os === os && normalizeArchitecture(a.arch) === arch && a.format === format,
  );
  assert.equal(candidates.length, 1, 'One matching published native installer required');
  const artifact = candidates[0],
    assets = release.assets.filter((a) => a.name === artifact.filename);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].size, artifact.sizeBytes, 'Published asset byte count');
  return { artifact, asset: assets[0] };
}
export function verifyPublishedBytes(bytes, artifact) {
  assert.equal(bytes.length, artifact.sizeBytes, 'Actual old installer size');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, artifact.sha256, 'Actual old installer SHA-256');
  return sha256;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values: v } = parseArgs({
    options: {
      repo: { type: 'string' },
      target: { type: 'string' },
      format: { type: 'string' },
      out: { type: 'string' },
    },
  });
  assert.match(v.repo ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(v.target && v.format && v.out);
  const out = resolve(v.out);
  mkdirSync(out, { recursive: true });
  const headers = {
    'User-Agent': 'varve-native-production-qualification',
    Accept: 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const api = await fetch(`https://api.github.com/repos/${v.repo}/releases/tags/v0.2.1`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(api.ok, true, 'Published release metadata request failed');
  const release = await api.json();
  async function assetBytes(name, maxBytes) {
    const assets = release.assets.filter((a) => a.name === name);
    assert.equal(assets.length, 1, `One ${name} asset required`);
    const asset = assets[0];
    assert.ok(asset.size > 0 && asset.size <= maxBytes, 'Bounded published asset size');
    const expected = `https://github.com/${v.repo}/releases/download/v0.2.1/${encodeURIComponent(name)}`;
    assert.equal(
      asset.browser_download_url,
      expected,
      'Published source URL must match this repository/tag',
    );
    const response = await fetch(expected, { signal: AbortSignal.timeout(120_000) });
    assert.equal(response.ok, true, `Published ${name} request failed`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, asset.size, 'Downloaded published byte count');
    return bytes;
  }
  const manifestBytes = await assetBytes('release-manifest.json', 2_000_000),
    sumsBytes = await assetBytes('SHA256SUMS.txt', 2_000_000);
  const { artifact } = selectPublishedInstaller({
    release,
    manifest: JSON.parse(manifestBytes),
    checksumsText: sumsBytes.toString(),
    target: v.target,
    format: v.format,
  });
  const bytes = await assetBytes(artifact.filename, 512_000_000),
    sha256 = verifyPublishedBytes(bytes, artifact);
  writeFileSync(join(out, artifact.filename), bytes);
  writeFileSync(
    join(out, 'published-upgrade.json'),
    JSON.stringify(
      {
        tag: release.tag_name,
        publishedAt: release.published_at,
        target: v.target,
        artifact: artifact.filename,
        sha256,
        sizeBytes: bytes.length,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Verified published ${artifact.filename}: ${sha256}`);
}
