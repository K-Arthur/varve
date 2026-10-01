import { describe, expect, it } from 'vitest';
import { publishedFeatureVersion } from '../lib/feature-release';

describe('published feature availability', () => {
  it('keeps a feature in preview until a release containing it is published', () => {
    expect(publishedFeatureVersion('0.5.0', { hasRelease: true, version: '0.2.1' })).toBeNull();
    expect(publishedFeatureVersion('0.5.0', { hasRelease: false, version: '0.5.0' })).toBeNull();
  });

  it('uses the published release version to expose included experimental features', () => {
    expect(publishedFeatureVersion('0.5.0', { hasRelease: true, version: '0.5.0' })).toBe('0.5.0');
    expect(publishedFeatureVersion('0.5.0', { hasRelease: true, version: '0.6.0' })).toBe('0.6.0');
  });

  it('orders prerelease versions below their matching release', () => {
    expect(
      publishedFeatureVersion('0.5.0', { hasRelease: true, version: '0.5.0-rc.1' }),
    ).toBeNull();
  });

  it('fails closed for malformed version metadata', () => {
    expect(
      publishedFeatureVersion('0.5.0', { hasRelease: true, version: 'release-0.5' }),
    ).toBeNull();
  });
});
