import { describe, expect, it } from 'vitest';
import { appImageOnnxPackagingNotice, changelogReleaseState } from '../lib/release-availability';

const previousRelease = { hasRelease: true, version: '0.2.1' };
const publishedCandidate = { hasRelease: true, version: '0.5.0' };

describe('prepared notes versus published installers', () => {
  it('keeps prepared 0.5.0 notes unlinked while 0.2.1 remains the latest published release', () => {
    const history = ['0.5.0', '0.2.1', '0.1.0'].map((version) => ({
      version,
      ...changelogReleaseState(version, previousRelease),
    }));
    expect(history.filter((entry) => entry.latest).map((entry) => entry.version)).toEqual([
      '0.2.1',
    ]);
    expect(history[0]).toMatchObject({ published: false, latest: false, releaseUrl: null });
    expect(history[1]?.releaseUrl).toBe('https://github.com/K-Arthur/varve/releases/tag/v0.2.1');
    expect(history[2]).toMatchObject({ published: true, latest: false });
  });

  it('makes 0.5.0 the sole latest entry only after verified publication data includes it', () => {
    const history = ['0.5.0', '0.2.1'].map((version) => ({
      version,
      ...changelogReleaseState(version, publishedCandidate),
    }));
    expect(history.filter((entry) => entry.latest).map((entry) => entry.version)).toEqual([
      '0.5.0',
    ]);
    expect(history[0]?.releaseUrl).toBe('https://github.com/K-Arthur/varve/releases/tag/v0.5.0');
    expect(history[1]).toMatchObject({ published: true, latest: false });
  });

  it('does not advertise a candidate when release data is absent, malformed or only an RC', () => {
    for (const manifest of [
      { hasRelease: false, version: '0.5.0' },
      { hasRelease: true, version: 'release-0.5' },
      { hasRelease: true, version: '0.5.0-rc.1' },
    ]) {
      expect(changelogReleaseState('0.5.0', manifest)).toEqual({
        published: false,
        latest: false,
        releaseUrl: null,
      });
    }
  });
});

describe('version-specific ChromeOS AppImage guidance', () => {
  it('retains the verified 0.2.1 ONNX packaging warning and its Debian workaround', () => {
    const notice = appImageOnnxPackagingNotice(previousRelease);
    expect(notice).toMatch(/Published v0\.2\.1 AppImages omit the bundled native ONNX Runtime/);
    expect(notice).toContain('Use the .deb on ChromeOS.');
  });

  it('does not attribute the old defect to 0.5.0, a future release, or an absent release', () => {
    for (const manifest of [
      publishedCandidate,
      { hasRelease: true, version: '0.6.0' },
      { hasRelease: false, version: '0.2.1' },
    ]) {
      expect(appImageOnnxPackagingNotice(manifest)).toBeNull();
    }
  });
});
