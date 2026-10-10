import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertReleaseTag, resolveMsixSourceTag } from './resolve-tag.mjs';

describe('MSIX source tag', () => {
  it('packages a dispatched tag, including published 0.5.0', () => {
    assert.equal(
      resolveMsixSourceTag({
        eventName: 'workflow_dispatch',
        dispatchTag: 'v0.5.0',
        latestReleaseTag: 'v0.5.1',
      }),
      'v0.5.0',
    );
  });

  it('defaults an empty dispatch input to the latest published release', () => {
    assert.equal(
      resolveMsixSourceTag({
        eventName: 'workflow_dispatch',
        dispatchTag: '',
        latestReleaseTag: 'v0.5.0',
      }),
      'v0.5.0',
    );
  });

  it('uses the pushed tag for tag events', () => {
    assert.equal(
      resolveMsixSourceTag({
        eventName: 'push',
        refName: 'v0.5.1',
      }),
      'v0.5.1',
    );
  });

  it('rejects a missing latest release when dispatch has no tag', () => {
    assert.throws(
      () =>
        resolveMsixSourceTag({
          eventName: 'workflow_dispatch',
          dispatchTag: '   ',
          latestReleaseTag: '',
        }),
      /latest GitHub release/,
    );
  });

  it('accepts stable and prerelease version tags', () => {
    assert.equal(assertReleaseTag('v0.5.0'), 'v0.5.0');
    assert.equal(assertReleaseTag('v0.5.1-rc.1'), 'v0.5.1-rc.1');
    assert.throws(() => assertReleaseTag('master'), /not a Varve release tag/);
  });
});
