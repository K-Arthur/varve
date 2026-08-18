import { describe, expect, it } from 'vitest';
import {
  type DetectionInput,
  detect,
  detectArch,
  detectPlatform,
  isMobileOrTablet,
  orderArchitectures,
  primaryFormatFor,
  recommendationCopy,
} from '../lib/download-detection';

const DESKTOP = { maxTouchPoints: 0, screenWidth: 1920, screenHeight: 1080 };

function input(ua: string, overrides: Partial<DetectionInput> = {}): DetectionInput {
  return { userAgent: ua, ...DESKTOP, ...overrides };
}

describe('detectPlatform', () => {
  it('detects Linux, macOS, and Windows from UA tokens', () => {
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0')).toBe('linux');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')).toBe(
      'macos',
    );
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0')).toBe(
      'windows',
    );
  });

  it('treats mobile UAs as unknown platform (no desktop recommendation)', () => {
    expect(
      detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15'),
    ).toBe('unknown');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0')).toBe('unknown');
  });

  it('returns unknown for privacy-reduced UAs without platform tokens', () => {
    expect(detectPlatform('Mozilla/5.0')).toBe('unknown');
    expect(detectPlatform('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe('unknown');
  });
});

describe('detectArch', () => {
  it('detects arm64 and x64 tokens', () => {
    expect(detectArch('Mozilla/5.0 (X11; Linux aarch64) Firefox/128.0')).toBe('arm64');
    expect(detectArch('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0')).toBe('x64');
    expect(detectArch('Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0')).toBe('x64');
  });
});

describe('isMobileOrTablet', () => {
  it('detects UA-based mobile devices', () => {
    expect(
      isMobileOrTablet(input('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605.1.15')),
    ).toBe(true);
  });

  it('detects touch tablets from touch points and geometry', () => {
    expect(
      isMobileOrTablet(
        input('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', {
          maxTouchPoints: 10,
          screenWidth: 834,
          screenHeight: 1112,
        }),
      ),
    ).toBe(true);
    // A touch laptop with a laptop-sized landscape screen is not a tablet:
    // neither 1440x900 nor a common 1366x768 laptop may trigger the notice.
    expect(
      isMobileOrTablet(
        input('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', {
          maxTouchPoints: 10,
          screenWidth: 1440,
          screenHeight: 900,
        }),
      ),
    ).toBe(false);
    expect(
      isMobileOrTablet(
        input('Mozilla/5.0 (X11; Linux x86_64)', {
          maxTouchPoints: 10,
          screenWidth: 1366,
          screenHeight: 768,
        }),
      ),
    ).toBe(false);
  });
});

describe('detect (integration)', () => {
  it('flags bots and skips recommendations', () => {
    const result = detect(
      input('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
    );
    expect(result.bot).toBe(true);
    expect(result.platform).toBe('unknown');
    expect(recommendationCopy(result)).toBeNull();
  });

  it('flags headless test browsers as bots so they get no banner', () => {
    const result = detect(
      input(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0 Safari/537.36',
      ),
    );
    expect(result.bot).toBe(true);
    expect(recommendationCopy(result)).toBeNull();
  });

  it('never claims an architecture on macOS, even with an Intel hint', () => {
    const result = detect(input('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0'));
    expect(result.platform).toBe('macos');
    expect(result.arch).toBe('unknown');
    expect(result.macArchHint).toBe('x64');
  });

  it('promotes ARM64 for an ARM64 Linux device', () => {
    const result = detect(input('Mozilla/5.0 (X11; Linux aarch64) Firefox/128.0'));
    expect(result.platform).toBe('linux');
    expect(result.arch).toBe('arm64');
  });

  it('leaves mobile visitors without a platform recommendation', () => {
    const result = detect(input('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0'));
    expect(result.mobile).toBe(true);
    expect(result.platform).toBe('unknown');
    expect(recommendationCopy(result)).toBeNull();
  });

  it('flags reduced UAs (no platform tokens) so no platform is claimed', () => {
    const result = detect(
      input('Mozilla/5.0 (unrecognized; rv:128.0) Gecko/20100101 Firefox/128.0'),
    );
    expect(result.reducedUa).toBe(true);
    expect(recommendationCopy(result)).toBeNull();
  });
});

describe('orderArchitectures', () => {
  it('keeps x86_64 first by default (dominant architecture)', () => {
    expect(orderArchitectures(['aarch64', 'x86_64'], 'unknown')).toEqual(['x86_64', 'aarch64']);
    expect(orderArchitectures(['aarch64', 'x86_64'], 'x64')).toEqual(['x86_64', 'aarch64']);
  });

  it('promotes ARM64 only for a matching device', () => {
    expect(orderArchitectures(['aarch64', 'x86_64'], 'arm64')).toEqual(['aarch64', 'x86_64']);
  });

  it('is stable and never drops architectures', () => {
    expect(orderArchitectures(['aarch64', 'x86_64', 'riscv64'], 'arm64')).toEqual([
      'aarch64',
      'x86_64',
      'riscv64',
    ]);
  });
});

describe('primaryFormatFor', () => {
  it('prefers .deb on Linux, falling back to AppImage', () => {
    expect(primaryFormatFor('linux', ['appimage', 'deb', 'rpm'])).toBe('deb');
    expect(primaryFormatFor('linux', ['appimage', 'rpm'])).toBe('appimage');
  });

  it('takes the first published format elsewhere', () => {
    expect(primaryFormatFor('macos', ['dmg'])).toBe('dmg');
    expect(primaryFormatFor('windows', ['nsis'])).toBe('nsis');
    expect(primaryFormatFor('windows', ['msi', 'nsis'])).toBe('msi');
  });
});

describe('recommendationCopy', () => {
  it('labels the result as a best guess, not a certainty', () => {
    const copy = recommendationCopy(detect(input('Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0')));
    expect(copy).toMatch(/recommend/);
    expect(copy).toMatch(/best guess/);
    expect(copy).toMatch(/x86_64/);
  });

  it('mentions Apple Silicon only, with the Rosetta caveat for x64 hints', () => {
    const copy = recommendationCopy(
      detect(input('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0')),
    );
    expect(copy).toMatch(/macOS/);
    expect(copy).toMatch(/Apple Silicon only/);
    // The Intel hint is explained as ambiguous (Intel vs Rosetta), never claimed.
    expect(copy).toMatch(/can\u2019t tell an Intel Mac from Apple Silicon under Rosetta/);
  });

  it('still warns Apple-Silicon-only when macOS reports no architecture at all', () => {
    const copy = recommendationCopy(detect(input('Mozilla/5.0 (Macintosh) Safari/605.1.15')));
    expect(copy).toMatch(/Apple Silicon only/);
    expect(copy).toMatch(/About This Mac/);
    expect(copy).not.toMatch(/ARM64|ARM 64/);
  });

  it('returns null for unknown/reduced/bot/mobile cases', () => {
    expect(recommendationCopy(detect(input('Mozilla/5.0')))).toBeNull();
    expect(recommendationCopy(detect(input('Mozilla/5.0 (compatible; Googlebot/2.1)')))).toBeNull();
  });
});
