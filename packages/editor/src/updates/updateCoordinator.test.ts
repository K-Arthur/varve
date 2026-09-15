import { describe, expect, it } from 'vitest';
import { UpdateCoordinator } from './updateCoordinator';
import type {
  DownloadedUpdate,
  DownloadProgress,
  PackagingContext,
  UpdateInfo,
  UpdatePreferences,
  UpdatePreferencesStore,
  UpdateProvider,
  VerifiedUpdate,
} from './updateTypes';

const context: PackagingContext = {
  platform: 'linux',
  architecture: 'x86_64',
  packageType: 'appimage',
  currentVersion: '0.1.1',
  channel: 'stable',
  updateAuthority: 'self-managed',
  installLocation: 'writable',
  runtimeSupported: true,
  buildLabel: 'x86_64 AppImage',
};

const update: UpdateInfo = {
  version: '0.2.0',
  notes: 'Security fixes',
  publishedAt: null,
  channel: 'stable',
  target: 'linux-x86_64',
};

class MemoryPreferences implements UpdatePreferencesStore {
  value: UpdatePreferences = {
    schemaVersion: 1,
    consentPromptSeen: false,
    consent: 'manual',
    installOnQuit: false,
    channel: 'stable',
    skippedVersions: {},
    lastCheckedAt: null,
    nextEligibleCheckAt: null,
  };

  load(): UpdatePreferences {
    return this.value;
  }

  save(value: UpdatePreferences): void {
    this.value = value;
  }
}

class FakeProvider implements UpdateProvider {
  checks = 0;
  downloads = 0;
  installs = 0;
  relaunches = 0;

  async getPackagingContext(): Promise<PackagingContext> {
    return context;
  }

  async check(): Promise<UpdateInfo | null> {
    this.checks += 1;
    return update;
  }

  async download(
    _update: UpdateInfo,
    onProgress: (progress: DownloadProgress) => void,
  ): Promise<DownloadedUpdate> {
    this.downloads += 1;
    onProgress({ downloadedBytes: 10, totalBytes: 10 });
    return { __brand: 'DownloadedUpdate' };
  }

  async verify(): Promise<VerifiedUpdate> {
    return { __brand: 'VerifiedUpdate' };
  }

  async install(): Promise<void> {
    this.installs += 1;
  }

  async relaunch(): Promise<void> {
    this.relaunches += 1;
  }
}

describe('UpdateCoordinator', () => {
  it('does not perform a background request without consent, while manual check remains available', async () => {
    const provider = new FakeProvider();
    const coordinator = new UpdateCoordinator(provider, new MemoryPreferences(), {
      now: () => 1000,
    });
    await coordinator.initialize();
    await coordinator.check('background');
    expect(provider.checks).toBe(0);
    await coordinator.check('manual');
    expect(provider.checks).toBe(1);
    expect(coordinator.getState()).toMatchObject({ kind: 'update-available', update });
  });

  it('downloads, verifies, and installs only after explicit consent/operations', async () => {
    const provider = new FakeProvider();
    const preferences = new MemoryPreferences();
    const coordinator = new UpdateCoordinator(provider, preferences, { now: () => 1000 });
    coordinator.setPreferences({ consent: 'notify' });
    await coordinator.initialize();
    await coordinator.check('manual');
    expect(provider.downloads).toBe(0);
    await coordinator.download();
    expect(coordinator.getState()).toMatchObject({ kind: 'ready-to-install', update });
    await coordinator.install();
    expect(provider.installs).toBe(1);
    expect(coordinator.getState()).toMatchObject({ kind: 'restart-required', update });
    await coordinator.relaunch();
    expect(provider.relaunches).toBe(1);
  });

  it('automatically downloads only in download-automatically mode', async () => {
    const provider = new FakeProvider();
    const coordinator = new UpdateCoordinator(provider, new MemoryPreferences(), {
      now: () => 1000,
    });
    coordinator.setPreferences({ consent: 'download-automatically' });
    await coordinator.initialize();
    await coordinator.check('background');
    expect(provider.downloads).toBe(1);
    expect(coordinator.getState()).toMatchObject({ kind: 'ready-to-install', update });
  });

  it('re-enabling consent leaves the disabled state', () => {
    const coordinator = new UpdateCoordinator(new FakeProvider(), new MemoryPreferences(), {
      now: () => 1000,
    });
    coordinator.setPreferences({ consent: 'manual' });
    expect(coordinator.getState().kind).toBe('disabled');
    coordinator.setPreferences({ consent: 'notify' });
    expect(coordinator.getState().kind).toBe('idle');
  });

  it('skip-version suppresses the offer and defers the state', async () => {
    const provider = new FakeProvider();
    const coordinator = new UpdateCoordinator(provider, new MemoryPreferences(), {
      now: () => 1000,
    });
    await coordinator.initialize();
    await coordinator.check('manual');
    expect(coordinator.getState()).toMatchObject({ kind: 'update-available' });
    coordinator.skipVersion();
    expect(coordinator.getState().kind).toBe('deferred');
    expect(coordinator.getPreferences().skippedVersions.stable).toBe('0.2.0');
    await coordinator.check('manual');
    expect(coordinator.getState().kind).toBe('up-to-date');
  });

  it('mirrors remote state but keeps a local active operation authoritative', async () => {
    const coordinator = new UpdateCoordinator(new FakeProvider(), new MemoryPreferences(), {
      now: () => 1000,
    });
    const remote = {
      kind: 'downloading',
      update,
      downloadedBytes: 10,
      totalBytes: 100,
    } as const;
    coordinator.synchronize(remote);
    expect(coordinator.getState()).toEqual(remote);
    const active = coordinator.synchronize({ kind: 'checking', source: 'manual' } as never);
    expect(active).toEqual(remote);
    const idempotent = coordinator.synchronize(remote);
    expect(idempotent).toEqual(remote);
  });

  it('recovers from a stale mirrored active operation', async () => {
    const coordinator = new UpdateCoordinator(new FakeProvider(), new MemoryPreferences(), {
      now: () => 1000,
    });
    coordinator.synchronize({ kind: 'downloading', update, downloadedBytes: 1, totalBytes: 10 });
    expect(coordinator.resetStaleOperation().kind).toBe('idle');
  });

  it('cancels an in-flight download and discards the completed transfer', async () => {
    const provider = new FakeProvider();
    const coordinator = new UpdateCoordinator(provider, new MemoryPreferences(), {
      now: () => 1000,
    });
    await coordinator.initialize();
    await coordinator.check('manual');
    const downloadPromise = coordinator.download();
    expect(coordinator.getState().kind).toBe('downloading');
    const cancelled = coordinator.cancel();
    expect(cancelled.kind).toBe('cancelled');
    await downloadPromise;
    expect(coordinator.getState().kind).toBe('cancelled');
    expect(coordinator.getState()).not.toMatchObject({ kind: 'ready-to-install' });
  });

  it('cancelling from ready-to-install discards the verified handle', async () => {
    const coordinator = new UpdateCoordinator(new FakeProvider(), new MemoryPreferences(), {
      now: () => 1000,
    });
    await coordinator.initialize();
    await coordinator.check('manual');
    await coordinator.download();
    expect(coordinator.getState()).toMatchObject({ kind: 'ready-to-install' });
    coordinator.cancel();
    expect(coordinator.getState().kind).toBe('cancelled');
    const result = await coordinator.install();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.error.code).toBe('busy');
  });
});
