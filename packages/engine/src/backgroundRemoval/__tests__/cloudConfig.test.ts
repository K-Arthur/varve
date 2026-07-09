import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadCloudConfig, resetCloudConfig, saveCloudConfig } from '../cloudConfig';

beforeEach(() => {
  localStorage.clear();
});

describe('cloudConfig', () => {
  it('returns null when storage is empty', () => {
    expect(loadCloudConfig()).toBeNull();
  });

  it('round-trip save/load preserves values', () => {
    const config = {
      apiUrl: 'https://api.strata.dev/v1/remove-background',
      apiKey: 'sk-test-key-12345',
      timeout: 60000,
      maxRetries: 3,
      usePreview: false,
      maxDimension: 1024,
      enabled: true,
    };
    saveCloudConfig(config);

    const loaded = loadCloudConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiUrl).toBe(config.apiUrl);
    expect(loaded!.apiKey).toBe(config.apiKey);
    expect(loaded!.timeout).toBe(60000);
    expect(loaded!.maxRetries).toBe(3);
    expect(loaded!.usePreview).toBe(false);
    expect(loaded!.maxDimension).toBe(1024);
    expect(loaded!.enabled).toBe(true);
  });

  it('reset clears config and load returns null', () => {
    saveCloudConfig({
      apiUrl: 'https://example.com/api',
      apiKey: 'key123',
      timeout: 30000,
      maxRetries: 2,
      usePreview: true,
      maxDimension: 2048,
      enabled: true,
    });
    expect(loadCloudConfig()).not.toBeNull();

    resetCloudConfig();
    expect(loadCloudConfig()).toBeNull();
  });

  it('partial stored config merges with defaults', () => {
    localStorage.setItem(
      'strata-bg-cloud-config',
      JSON.stringify({ apiUrl: 'https://custom.api/rmbg', apiKey: 'abc' }),
    );

    const loaded = loadCloudConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.apiUrl).toBe('https://custom.api/rmbg');
    expect(loaded!.apiKey).toBe('abc');
    expect(loaded!.timeout).toBe(DEFAULT_CONFIG.timeout);
    expect(loaded!.maxRetries).toBe(DEFAULT_CONFIG.maxRetries);
    expect(loaded!.usePreview).toBe(DEFAULT_CONFIG.usePreview);
    expect(loaded!.maxDimension).toBe(DEFAULT_CONFIG.maxDimension);
    expect(loaded!.enabled).toBe(DEFAULT_CONFIG.enabled);
  });

  it('handles corrupt JSON gracefully by returning null', () => {
    localStorage.setItem('strata-bg-cloud-config', 'not-valid-json');
    expect(loadCloudConfig()).toBeNull();
  });
});
