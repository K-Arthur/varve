import { describe, expect, it } from 'vitest';
import { transitionUpdateState } from './updateStateMachine';
import type { UpdateInfo, UpdateState } from './updateTypes';

const update: UpdateInfo = {
  version: '0.2.0',
  notes: 'Fixes',
  publishedAt: null,
  channel: 'stable',
  target: 'linux-x86_64',
};

describe('update state machine', () => {
  it('accepts the check, download, verify, install lifecycle', () => {
    let state: UpdateState = { kind: 'idle' };
    state = transitionUpdateState(state, { type: 'check-started', source: 'manual' });
    state = transitionUpdateState(state, { type: 'update-found', update });
    state = transitionUpdateState(state, { type: 'download-started', totalBytes: 100 });
    state = transitionUpdateState(state, { type: 'download-progress', downloadedBytes: 100 });
    state = transitionUpdateState(state, { type: 'download-finished' });
    state = transitionUpdateState(state, { type: 'verification-succeeded' });
    state = transitionUpdateState(state, { type: 'install-started' });
    state = transitionUpdateState(state, { type: 'install-succeeded' });
    expect(state).toEqual({ kind: 'restart-required', update });
  });

  it('rejects invalid combinations instead of producing conflicting booleans', () => {
    const state = transitionUpdateState({ kind: 'idle' }, { type: 'install-started' });
    expect(state.kind).toBe('error');
    if (state.kind === 'error') expect(state.error.code).toBe('busy');
  });

  it('does not allow download progress to go backwards', () => {
    const downloading = transitionUpdateState(
      { kind: 'update-available', update },
      { type: 'download-started', totalBytes: 100 },
    );
    const state = transitionUpdateState(downloading, {
      type: 'download-progress',
      downloadedBytes: 10,
    });
    expect(state.kind).toBe('downloading');
    const invalid = transitionUpdateState(state, {
      type: 'download-progress',
      downloadedBytes: 9,
    });
    expect(invalid.kind).toBe('error');
  });
});
