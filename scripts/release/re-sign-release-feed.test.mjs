import assert from 'node:assert/strict';
import { resolveResignRepo } from './re-sign-release-feed.mjs';

assert.equal(
  resolveResignRepo({ repo: 'acme/varve' }, () => 'ignored/slug'),
  'acme/varve',
);
assert.equal(
  resolveResignRepo({}, () => 'K-Arthur/varve'),
  'K-Arthur/varve',
);
assert.throws(() => resolveResignRepo({ repo: 'not-a-slug' }), /Invalid GitHub repository slug/);
assert.throws(() => resolveResignRepo({}, () => 'bad'), /Invalid GitHub repository slug/);

console.log('re-sign-release-feed.test.mjs — all tests passed');
