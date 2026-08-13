import {
  authorityState,
  canBackgroundCheck,
  canDownloadAutomatically,
  compareVersions,
  isChannelMatch,
  isCheckDue,
  normalizeUpdatePreferences,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FAILURE_BACKOFF_MS,
} from './updatePolicy';
import { transitionUpdateState } from './updateStateMachine';
import type {
  PackagingContext,
  UpdateError,
  UpdateInfo,
  UpdatePreferences,
  UpdatePreferencesStore,
  UpdateProvider,
  UpdateState,
  VerifiedUpdate,
} from './updateTypes';
import { isActiveUpdateState } from './updateWindowSync';

export interface UpdateClock {
  now(): number;
}

const systemClock: UpdateClock = { now: () => Date.now() };

export class UpdateCoordinator {
  private state: UpdateState = { kind: 'consent-required' };
  private preferences: UpdatePreferences;
  private context: PackagingContext | null = null;
  private verified: VerifiedUpdate | null = null;
  private readonly listeners = new Set<(state: UpdateState) => void>();

  constructor(
    private readonly provider: UpdateProvider,
    private readonly preferenceStore: UpdatePreferencesStore,
    private readonly clock: UpdateClock = systemClock,
  ) {
    this.preferences = normalizeUpdatePreferences(preferenceStore.load());
  }

  getState(): UpdateState {
    return this.state;
  }

  getPreferences(): UpdatePreferences {
    return { ...this.preferences, skippedVersions: { ...this.preferences.skippedVersions } };
  }

  getContext(): PackagingContext | null {
    return this.context;
  }

  /**
   * Mirror state broadcast by another window. A local active operation wins
   * over mirrored active/remote states; identical state is a no-op.
   */
  synchronize(remote: UpdateState): UpdateState {
    if (isActiveUpdateState(this.state.kind) && isActiveUpdateState(remote.kind)) {
      return this.state;
    }
    if (JSON.stringify(this.state) === JSON.stringify(remote)) return this.state;
    return this.publish(remote);
  }

  /**
   * Adopt preferences changed in another window. Unlike `setPreferences` this
   * never triggers consent transitions — the owning window already applied
   * them; followers only persist the same values.
   */
  adoptPreferences(preferences: UpdatePreferences): UpdatePreferences {
    this.preferences = normalizeUpdatePreferences(preferences);
    this.preferenceStore.save(this.preferences);
    return this.getPreferences();
  }

  /** Recover from a mirrored active state whose owning window disappeared. */
  resetStaleOperation(): UpdateState {
    if (!isActiveUpdateState(this.state.kind)) return this.state;
    return this.publish({ kind: 'idle' });
  }

  subscribe(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<UpdateState> {
    this.context = await this.provider.getPackagingContext();
    const authority = authorityState(this.context);
    if (authority.kind === 'unsupported')
      return this.publish({ kind: 'unsupported', reason: authority.reason });
    if (authority.kind === 'externally-managed') return this.publish(authority);
    return this.publish(
      this.preferences.consent === 'manual' ? { kind: 'consent-required' } : { kind: 'idle' },
    );
  }

  setPreferences(patch: Partial<UpdatePreferences>): UpdatePreferences {
    this.preferences = normalizeUpdatePreferences({ ...this.preferences, ...patch });
    this.preferenceStore.save(this.preferences);
    if (
      this.preferences.consent === 'manual' &&
      ['consent-required', 'idle'].includes(this.state.kind)
    ) {
      this.publish({ kind: 'disabled' });
    } else if (
      this.preferences.consent !== 'manual' &&
      ['consent-required', 'disabled'].includes(this.state.kind)
    ) {
      this.publish({ kind: 'idle' });
    }
    return this.getPreferences();
  }

  async check(source: 'manual' | 'background' = 'manual'): Promise<UpdateState> {
    if (
      source === 'background' &&
      (!canBackgroundCheck(this.preferences) || !isCheckDue(this.preferences, this.clock.now()))
    ) {
      return this.state;
    }
    if (!this.context) await this.initialize();
    if (this.state.kind === 'unsupported' || this.state.kind === 'externally-managed')
      return this.state;
    if (source === 'background' && !canBackgroundCheck(this.preferences)) return this.state;
    this.publish(transitionUpdateState(this.state, { type: 'check-started', source }));
    try {
      const update = await this.provider.check(this.preferences.channel);
      const checkedAt = this.clock.now();
      this.preferences = {
        ...this.preferences,
        lastCheckedAt: checkedAt,
        nextEligibleCheckAt: checkedAt + UPDATE_CHECK_INTERVAL_MS,
      };
      this.preferenceStore.save(this.preferences);
      if (!update)
        return this.publish(transitionUpdateState(this.state, { type: 'no-update', checkedAt }));
      const result = this.acceptCandidate(update);
      if (result?.code === 'no-update')
        return this.publish(transitionUpdateState(this.state, { type: 'no-update', checkedAt }));
      if (result)
        return this.publish(transitionUpdateState(this.state, { type: 'failed', error: result }));
      const next = transitionUpdateState(this.state, { type: 'update-found', update });
      this.publish(next);
      if (source === 'background' && canDownloadAutomatically(this.preferences))
        await this.download();
      return this.state;
    } catch (error) {
      this.preferences = {
        ...this.preferences,
        nextEligibleCheckAt: this.clock.now() + UPDATE_FAILURE_BACKOFF_MS,
      };
      this.preferenceStore.save(this.preferences);
      return this.publish(
        transitionUpdateState(this.state, {
          type: 'failed',
          error: normalizeError(error, 'network'),
        }),
      );
    }
  }

  async download(): Promise<UpdateState> {
    if (this.state.kind !== 'update-available')
      return this.fail('busy', 'No update is available to download.');
    const update = this.state.update;
    try {
      const downloaded = await this.provider.download(update, (progress) => {
        this.publish(
          transitionUpdateState(this.state, {
            type: this.state.kind === 'update-available' ? 'download-started' : 'download-progress',
            ...(this.state.kind === 'update-available'
              ? { totalBytes: progress.totalBytes }
              : { downloadedBytes: progress.downloadedBytes }),
          } as never),
        );
      });
      // Providers report completion only after the last byte is durable.
      if (this.state.kind === 'update-available') {
        this.publish(
          transitionUpdateState(this.state, { type: 'download-started', totalBytes: null }),
        );
      }
      this.publish(transitionUpdateState(this.state, { type: 'download-finished' }));
      this.verified = await this.provider.verify(downloaded, update);
      return this.publish(transitionUpdateState(this.state, { type: 'verification-succeeded' }));
    } catch (error) {
      const normalized = normalizeError(error, 'download-failed');
      return this.fail(normalized.code, normalized.message);
    }
  }

  async install(): Promise<UpdateState> {
    if (this.state.kind !== 'ready-to-install' || !this.verified)
      return this.fail('busy', 'No verified update is ready to install.');
    const update = this.state.update;
    this.publish(transitionUpdateState(this.state, { type: 'install-started' }));
    try {
      await this.provider.install(this.verified, update);
      this.verified = null;
      return this.publish(transitionUpdateState(this.state, { type: 'install-succeeded' }));
    } catch (error) {
      const normalized = normalizeError(error, 'install-failed');
      return this.fail(normalized.code, normalized.message);
    }
  }

  async relaunch(): Promise<UpdateState> {
    if (this.state.kind !== 'restart-required')
      return this.fail('restart-failed', 'No installed update is waiting for a restart.');
    try {
      await this.provider.relaunch();
      return this.state;
    } catch (error) {
      const normalized = normalizeError(error, 'restart-failed');
      return this.fail(normalized.code, normalized.message);
    }
  }

  defer(): UpdateState {
    return this.publish(transitionUpdateState(this.state, { type: 'defer' }));
  }

  skipVersion(): UpdatePreferences {
    if (
      this.state.kind === 'update-available' ||
      this.state.kind === 'ready-to-install' ||
      this.state.kind === 'deferred'
    ) {
      this.setPreferences({
        skippedVersions: {
          ...this.preferences.skippedVersions,
          [this.preferences.channel]: this.state.update.version,
        },
      });
      if (this.state.kind === 'update-available' || this.state.kind === 'ready-to-install') {
        // A skipped version is suppressed by `acceptCandidate` on the next
        // check; leaving the state as available would keep offering the
        // download the user just declined.
        this.publish(transitionUpdateState(this.state, { type: 'defer' }));
      }
    }
    return this.getPreferences();
  }

  resetSkippedVersions(): UpdatePreferences {
    return this.setPreferences({ skippedVersions: {} });
  }

  private acceptCandidate(update: UpdateInfo): UpdateError | null {
    if (!this.context)
      return { code: 'unsupported-build', message: 'Update context is unavailable.' };
    if (!isChannelMatch(this.preferences.channel, update.channel))
      return {
        code: 'invalid-metadata',
        message: 'The update channel does not match this installation.',
      };
    const comparison = compareVersions(update.version, this.context.currentVersion);
    if (comparison === null)
      return { code: 'invalid-version', message: 'The update version is not valid.' };
    if (comparison <= 0) return { code: 'no-update', message: 'No newer version is available.' };
    if (this.preferences.skippedVersions[this.preferences.channel] === update.version)
      return { code: 'no-update', message: 'This version was skipped.' };
    return null;
  }

  private fail(code: UpdateError['code'], message: string): UpdateState {
    return this.publish(
      transitionUpdateState(this.state, { type: 'failed', error: { code, message } }),
    );
  }

  private publish(state: UpdateState): UpdateState {
    this.state = state;
    for (const listener of this.listeners) listener(state);
    return state;
  }
}

function normalizeError(error: unknown, fallback: UpdateError['code']): UpdateError {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return {
      code: error.code as UpdateError['code'],
      message:
        'message' in error && typeof error.message === 'string'
          ? error.message
          : 'The update operation failed.',
    };
  }
  return {
    code: fallback,
    message: error instanceof Error ? error.message : 'The update operation failed.',
  };
}
