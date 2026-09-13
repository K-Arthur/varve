/**
 * Privacy-preserving platform/architecture recommendation for the download
 * page.
 *
 * Everything here is pure: the functions take explicit inputs (user agent,
 * touch points, screen size) and return plain values, so the recommendation
 * logic is unit-testable without a browser and the page never needs any
 * network call or stored identity to recommend a download. The browser hint
 * is treated as exactly that — a hint — and every consumer labels it as a
 * recommendation with a manual override.
 */

export type DetectedPlatform = 'linux' | 'macos' | 'windows' | 'chromeos' | 'unknown';
export type DetectedArch = 'arm64' | 'x64' | 'unknown';

export interface DetectionResult {
  /** True for known crawlers/bots: no recommendation, no tab preselect. */
  bot: boolean;
  /** True when the UA hides platform tokens entirely: no recommendation. */
  reducedUa: boolean;
  /**
   * True for phones/tablets: no desktop-installer recommendation. The page
   * must still offer the browser route; this flag never hides it.
   */
  mobile: boolean;
  /**
   * True when the UA is ChromeOS (CrOS). A touch Chromebook is not a tablet:
   * it gets its own route (browser/app + optional Linux), and its architecture
   * is read from the UA for the optional Linux ARM64/x86_64 package.
   */
  chromeos: boolean;
  platform: DetectedPlatform;
  /**
   * Architecture hint from the UA. Never 'x64' for macOS: browsers report
   * "Intel Mac OS X" on Apple Silicon too, so an x64 hint is ambiguous there
   * (Intel Mac vs. Apple Silicon under Rosetta) and must not be claimed.
   * `macArchHint` carries that raw hint for honest wording instead.
   */
  arch: DetectedArch;
  macArchHint: 'x64' | 'arm64' | 'none';
}

const MOBILE_PATTERN = /android|iphone|ipad|ipod|mobile|tablet|webos|iemobile|opera mini/i;

/**
 * ChromeOS identifies itself with a `CrOS` token and otherwise looks like
 * X11 Linux. It is deliberately checked before the mobile pattern and is
 * excluded from `isMobileOrTablet`: a Chromebook can be a touch device, but
 * it is not a phone/tablet and it has its own access routes.
 */
export function isChromeOS(ua: string): boolean {
  return /\bCrOS\b/.test(ua);
}

const BOT_PATTERN =
  /googlebot|bingbot|duckduckbot|petalbot|yandex|baiduspider|semrush|sogou|exabot|ia_archiver|archive\.org|facebookexternalhit|twitterbot|linkedinbot|slurp|uptimerobot|headlesschrome|phantomjs|curl|wget|python-requests|python-urllib/i;

export interface DetectionInput {
  userAgent: string;
  maxTouchPoints: number;
  screenWidth: number;
  screenHeight: number;
  /**
   * Low-entropy UA client hint platform (Chromium only). Used to catch
   * ChromeOS and Android when the user agent itself is reduced or when
   * "request desktop site" strips the mobile token. Denied/unavailable
   * hints simply leave the manual chooser in charge.
   */
  uaDataPlatform?: string;
  /** Low-entropy UA client hint: true on phones/tablets. */
  uaDataMobile?: boolean;
}

export function detectPlatform(ua: string): DetectedPlatform {
  if (isChromeOS(ua)) return 'chromeos';
  if (MOBILE_PATTERN.test(ua)) return 'unknown';
  if (ua.includes('Linux') && !ua.includes('Mac')) return 'linux';
  if (ua.includes('Mac')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  return 'unknown';
}

export function detectArch(ua: string): DetectedArch {
  if (/arm64|aarch64|armv8|; arm/i.test(ua)) return 'arm64';
  if (/x86_64|x64|win64|amd64|intel/i.test(ua)) return 'x64';
  return 'unknown';
}

/**
 * True for phones/tablets, from UA tokens or touch+geometry. The geometry
 * rule must not catch small landscape laptops: a 1366x768 or 1280x800 touch
 * laptop is a desktop machine, so the threshold is width-based (< 1280 CSS
 * px), which excludes every common laptop size while catching portrait and
 * landscape tablets (768..1194 wide).
 */
export function isMobileOrTablet(input: DetectionInput): boolean {
  if (isChromeOS(input.userAgent)) return false;
  // iPadOS reports a Macintosh user agent in desktop mode. No Mac has a
  // touchscreen, so any touch points on a Macintosh UA identify an iPad —
  // which must never be handed the macOS disk image. (Chromium's touch
  // emulation and some digitizers report a single point.)
  if (input.maxTouchPoints > 0 && /Macintosh/.test(input.userAgent)) return true;
  return (
    MOBILE_PATTERN.test(input.userAgent) || (input.maxTouchPoints > 1 && input.screenWidth < 1280)
  );
}

export function detect(input: DetectionInput): DetectionResult {
  const bot = BOT_PATTERN.test(input.userAgent);
  const uaDataPlatform = (input.uaDataPlatform ?? '').toLowerCase();
  const hintChromeOs = uaDataPlatform.includes('chrome os') || uaDataPlatform.includes('chromeos');
  const hintMobile =
    input.uaDataMobile === true || uaDataPlatform === 'android' || uaDataPlatform === 'ios';
  const chromeos = hintChromeOs || isChromeOS(input.userAgent);
  const mobile = chromeos ? false : isMobileOrTablet(input) || hintMobile;
  let platform = detectPlatform(input.userAgent);
  if (chromeos) platform = 'chromeos';
  const reducedUa = platform === 'unknown' && !mobile && !bot;

  let arch: DetectedArch = 'unknown';
  let macArchHint: DetectionResult['macArchHint'] = 'none';
  if (platform === 'macos') {
    const hint = detectArch(input.userAgent);
    macArchHint = hint === 'unknown' ? 'none' : hint;
  } else {
    arch = detectArch(input.userAgent);
  }

  return { bot, reducedUa, mobile, chromeos, platform, arch, macArchHint };
}

/**
 * Order the architecture rows of a platform column.
 *
 * x86_64 is visually first by default (the dominant supported architecture);
 * detection may promote ARM64 only when the device hints at it. Unknown
 * architectures sink to the end. Never removes an architecture.
 */
export function orderArchitectures(
  architectures: string[],
  recommendedArch: DetectedArch,
): string[] {
  const rank = (arch: string) => {
    const key = arch.toLowerCase();
    if (key === 'x86_64' || key === 'amd64' || key === 'x64')
      return recommendedArch === 'arm64' ? 2 : 0;
    if (key === 'arm64' || key === 'aarch64') return recommendedArch === 'arm64' ? 0 : 1;
    return 3;
  };
  return [...architectures].sort((a, b) => rank(a) - rank(b));
}

/**
 * The single rule for which artifact format is the "primary download" of a
 * platform, shared by the quick grid and the detailed sections so the two can
 * never disagree. Linux prefers the AppImage (universal: runs on any distro
 * without root or a package manager, the safest default for a cross-distro
 * audience) and falls back to .deb; other platforms take the first published
 * format.
 */
export function primaryFormatFor(platform: string, formats: string[]): string {
  if (platform === 'linux') {
    if (formats.includes('appimage')) return 'appimage';
    if (formats.includes('deb')) return 'deb';
  }
  return formats[0] ?? '';
}

/**
 * Copy for the download-recommendation banner. The wording always frames the
 * result as a browser-based guess, never a certainty, and the arch is only
 * mentioned when the UA actually says it.
 */
export function recommendationCopy(result: DetectionResult): string | null {
  if (result.bot || result.mobile || result.reducedUa || result.platform === 'unknown') {
    return null;
  }
  if (result.platform === 'chromeos') {
    const archNote =
      result.arch === 'arm64'
        ? ' This device reports <strong>ARM64</strong>, which matches the Linux ARM64 package if you enable Linux.'
        : result.arch === 'x64'
          ? ' This device reports <strong>x86_64</strong>, which matches the Linux x86_64 package if you enable Linux.'
          : '';
    return `This looks like a <strong>Chromebook</strong>. The recommended route is <strong>Varve in your browser</strong>${archNote} The Chromebook guide compares the browser, installed app, and Linux routes.`;
  }
  const platformName =
    result.platform === 'linux' ? 'Linux' : result.platform === 'macos' ? 'macOS' : 'Windows';
  const macNote =
    result.macArchHint === 'arm64'
      ? ' (Apple Silicon)'
      : result.macArchHint === 'x64'
        ? ' — this release is Apple Silicon only, and a browser \u201cIntel\u201d hint can\u2019t tell an Intel Mac from Apple Silicon under Rosetta; check Apple menu > About This Mac'
        : ' — this release is Apple Silicon only; browsers can\u2019t reliably report a Mac\u2019s processor, so check Apple menu > About This Mac';
  const archPart =
    result.platform === 'macos'
      ? macNote
      : result.arch === 'arm64'
        ? ' (ARM64)'
        : result.arch === 'x64'
          ? ' (x86_64)'
          : '';
  return `Based on your browser, we recommend <strong>${platformName}</strong>${archPart}. This is a best guess — you can choose any other platform or architecture below.`;
}
