import { describe, expect, it } from 'vitest';
import {
  authorityState,
  canBackgroundCheck,
  canDownloadAutomatically,
  compareVersions,
  DEFAULT_UPDATE_PREFERENCES,
  isCheckDue,
  normalizeUpdatePreferences,
} from './updatePolicy';

describe('update policy', () => {
  it('defaults to manual consent and never enables install-on-quit', () => {
    expect(normalizeUpdatePreferences(null)).toEqual(DEFAULT_UPDATE_PREFERENCES);
    expect(canBackgroundCheck(DEFAULT_UPDATE_PREFERENCES)).toBe(false);
  });

  it('keeps download permission separate from check permission', () => {
    const notify = normalizeUpdatePreferences({ consent: 'notify', installOnQuit: true });
    const automatic = normalizeUpdatePreferences({
      consent: 'download-automatically',
      installOnQuit: true,
    });
    expect(canBackgroundCheck(notify)).toBe(true);
    expect(canDownloadAutomatically(notify)).toBe(false);
    expect(canDownloadAutomatically(automatic)).toBe(true);
    expect(automatic.installOnQuit).toBe(true);
  });

  it('compares semantic versions instead of strings', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('not-a-version', '1.0.0')).toBeNull();
  });

  it('throttles background checks and supports failure backoff timestamps', () => {
    const preferences = normalizeUpdatePreferences({
      consent: 'notify',
      nextEligibleCheckAt: 1000,
    });
    expect(isCheckDue(preferences, 999)).toBe(false);
    expect(isCheckDue(preferences, 1000)).toBe(true);
  });

  it('separates package authority from operating system', () => {
    const managed = authorityState({
      platform: 'linux',
      architecture: 'x86_64',
      packageType: 'deb',
      currentVersion: '0.1.1',
      channel: 'stable',
      updateAuthority: 'package-manager-managed',
      installLocation: 'writable',
      runtimeSupported: true,
      buildLabel: 'x86_64 deb',
    });
    expect(managed).toEqual({ kind: 'externally-managed', authority: 'package-manager-managed' });
  });
});
