import type { UpdateAction, UpdateInfo, UpdateState } from './updateTypes';

function currentUpdate(state: UpdateState): UpdateInfo | undefined {
  if ('update' in state) return state.update;
  return undefined;
}

export function transitionUpdateState(state: UpdateState, action: UpdateAction): UpdateState {
  switch (action.type) {
    case 'check-started':
      if (
        ![
          'consent-required',
          'disabled',
          'idle',
          'up-to-date',
          'deferred',
          'cancelled',
          'error',
        ].includes(state.kind)
      ) {
        return invalidTransition(
          state,
          'A check cannot start while an update operation is active.',
        );
      }
      return { kind: 'checking', source: action.source };
    case 'no-update':
      if (state.kind !== 'checking')
        return invalidTransition(state, 'No-update requires a pending check.');
      return { kind: 'up-to-date', checkedAt: action.checkedAt };
    case 'update-found':
      if (state.kind !== 'checking')
        return invalidTransition(state, 'An update can only be found while checking.');
      return { kind: 'update-available', update: action.update };
    case 'download-started':
      if (state.kind !== 'update-available')
        return invalidTransition(state, 'Download requires an available update.');
      return {
        kind: 'downloading',
        update: state.update,
        downloadedBytes: 0,
        totalBytes: action.totalBytes,
      };
    case 'download-progress':
      if (state.kind !== 'downloading')
        return invalidTransition(state, 'Progress requires an active download.');
      if (action.downloadedBytes < state.downloadedBytes) {
        return invalidTransition(state, 'Download progress cannot move backwards.');
      }
      return { ...state, downloadedBytes: action.downloadedBytes };
    case 'download-finished':
      if (state.kind !== 'downloading')
        return invalidTransition(state, 'A download must finish before verification.');
      return { kind: 'verifying', update: state.update };
    case 'verification-succeeded':
      if (state.kind !== 'verifying')
        return invalidTransition(state, 'Verification requires a completed download.');
      return { kind: 'ready-to-install', update: state.update };
    case 'install-started':
      if (state.kind === 'ready-to-install') return { kind: 'installing', update: state.update };
      return invalidTransition(state, 'Install requires a verified update.');
    case 'install-succeeded':
      if (state.kind !== 'installing')
        return invalidTransition(state, 'Install completion requires an active install.');
      return { kind: 'restart-required', update: state.update };
    case 'defer':
      if (state.kind === 'update-available' || state.kind === 'ready-to-install') {
        return { kind: 'deferred', update: state.update };
      }
      return invalidTransition(state, 'Only an available or ready update can be deferred.');
    case 'cancel':
      if (!['downloading', 'verifying', 'ready-to-install'].includes(state.kind)) {
        return invalidTransition(state, 'Only an active or ready update can be cancelled.');
      }
      return { kind: 'cancelled', update: currentUpdate(state) };
    case 'failed':
      if (['unsupported', 'externally-managed'].includes(state.kind)) return state;
      return { kind: 'error', error: action.error, update: currentUpdate(state) };
  }
}

function invalidTransition(state: UpdateState, message: string): UpdateState {
  return {
    kind: 'error',
    error: { code: 'busy', message, detail: `Invalid update transition from ${state.kind}.` },
    update: currentUpdate(state),
  };
}
