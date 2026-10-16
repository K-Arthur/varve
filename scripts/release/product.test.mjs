import assert from 'node:assert/strict';
import { releaseDownloadBaseUrl, repoHttpsUrl, repoSlug } from './product.mjs';

const original = process.env.GITHUB_REPOSITORY;

function restore() {
  if (original === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = original;
}

try {
  process.env.GITHUB_REPOSITORY = 'varvedesign/varve';
  assert.equal(repoSlug(), 'varvedesign/varve');
  assert.equal(repoHttpsUrl(), 'https://github.com/varvedesign/varve');
  assert.equal(
    releaseDownloadBaseUrl('0.5.1'),
    'https://github.com/varvedesign/varve/releases/download/v0.5.1',
  );
  assert.equal(
    releaseDownloadBaseUrl('v0.5.1'),
    'https://github.com/varvedesign/varve/releases/download/v0.5.1',
  );

  process.env.GITHUB_REPOSITORY = 'K-Arthur/varve';
  assert.equal(
    releaseDownloadBaseUrl('v0.2.0'),
    'https://github.com/K-Arthur/varve/releases/download/v0.2.0',
  );
} finally {
  restore();
}

console.log('product.test.mjs — all tests passed');
