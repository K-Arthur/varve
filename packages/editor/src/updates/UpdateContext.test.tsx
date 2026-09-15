// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UpdateCoordinatorProvider } from './UpdateContext';
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

class FakeProvider implements UpdateProvider {
  checks = 0;
  downloads = 0;

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
    onProgress({ downloadedBytes: 50, totalBytes: 100 });
    return { __brand: 'DownloadedUpdate' };
  }

  async verify(): Promise<VerifiedUpdate> {
    return { __brand: 'VerifiedUpdate' };
  }

  async install(): Promise<void> {}

  async relaunch(): Promise<void> {}
}

class LocalStore implements UpdatePreferencesStore {
  constructor(private value: UpdatePreferences | null = null) {}

  load(): UpdatePreferences {
    return (
      this.value ?? {
        schemaVersion: 1,
        consentPromptSeen: false,
        consent: 'manual',
        installOnQuit: false,
        channel: 'stable',
        skippedVersions: {},
        lastCheckedAt: null,
        nextEligibleCheckAt: null,
      }
    );
  }

  save(value: UpdatePreferences): void {
    this.value = value;
  }
}

function renderProvider(store?: LocalStore) {
  return render(
    <UpdateCoordinatorProvider
      provider={new FakeProvider()}
      preferenceStore={store ?? new LocalStore()}
    >
      <button type="button">child</button>
    </UpdateCoordinatorProvider>,
  );
}

describe('UpdateCoordinatorProvider consent flow', () => {
  it('shows the consent dialog once on first run and records the choice', async () => {
    const store = new LocalStore();
    renderProvider(store);
    expect(await screen.findByText('Keep Varve up to date?')).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Automatically check for updates'));

    await waitFor(() => expect(screen.getByText('Keep Varve up to date?')).not.toBeVisible());
    expect(store.load().consent).toBe('notify');
    expect(store.load().consentPromptSeen).toBe(true);
  });

  it('never interprets dismissing the dialog as consent', async () => {
    const store = new LocalStore();
    renderProvider(store);
    fireEvent.click(await screen.findByText('Not now'));
    await waitFor(() => expect(store.load().consent).toBe('manual'));
    expect(store.load().consentPromptSeen).toBe(true);
  });

  it('does not re-prompt a user who already declined', async () => {
    const store = new LocalStore({
      schemaVersion: 1,
      consentPromptSeen: true,
      consent: 'manual',
      installOnQuit: false,
      channel: 'stable',
      skippedVersions: {},
      lastCheckedAt: null,
      nextEligibleCheckAt: null,
    });
    renderProvider(store);
    await waitFor(() => expect(screen.getByText('Keep Varve up to date?')).not.toBeVisible());
  });

  it('performs no background checks without consent', async () => {
    const provider = new FakeProvider();
    render(
      <UpdateCoordinatorProvider
        provider={provider}
        preferenceStore={
          new LocalStore({
            schemaVersion: 1,
            consentPromptSeen: true,
            consent: 'manual',
            installOnQuit: false,
            channel: 'stable',
            skippedVersions: {},
            lastCheckedAt: null,
            nextEligibleCheckAt: null,
          })
        }
      >
        <button type="button">child</button>
      </UpdateCoordinatorProvider>,
    );
    await waitFor(() => expect(provider.checks).toBe(0));
  });
});
