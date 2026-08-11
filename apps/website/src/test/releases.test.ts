import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWebsiteReleaseData } from '../../../../scripts/release/website-release-data.mjs';

/**
 * The download page renders entirely from this generated manifest
 * (scripts/release/update-website-manifest.mjs). These tests guard the two
 * things that would embarrass us in public:
 *
 *  1. The "no release yet" state must be honest. Before the first tag there is
 *     nothing to download, and a page implying otherwise is worse than no page.
 *  2. Once a release exists, every advertised artifact must carry a real
 *     checksum and a URL that could actually resolve — publishing checksums is
 *     the entire mitigation available for unsigned builds, so they must be real.
 *
 * This previously tested public/releases.json: a hand-maintained file with
 * invented download sizes ("~200 MB") and an AUR command for a package that
 * does not exist, which the download page never read.
 */
const MANIFEST_PATH = path.resolve(__dirname, '../data/release-manifest.json');

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

const SHA256 = /^[0-9a-f]{64}$/;

interface ReleaseData {
  hasRelease: boolean;
  prerelease: boolean;
  version: string | null;
  integrity: string | null;
  platforms: Record<string, Array<Record<string, unknown>>>;
}

describe('website release manifest', () => {
  it('is valid JSON with a known schema version', () => {
    const data = loadManifest();
    expect(data.schemaVersion).toBe(2);
    expect(typeof data.hasRelease).toBe('boolean');
  });

  it('never claims notarised without signed', () => {
    const data = loadManifest();
    // An artifact advertised as signed that is not signed is worse than an
    // honestly unsigned one — it borrows trust it has not earned.
    expect(typeof data.signed).toBe('boolean');
    expect(typeof data.notarized).toBe('boolean');
    if (data.notarized) expect(data.signed).toBe(true);
  });

  it('advertises no downloads when there is no release', () => {
    const data = loadManifest();
    if (data.hasRelease) return;
    expect(data.version).toBeNull();
    expect(data.tag).toBeNull();
    expect(Object.keys(data.platforms)).toHaveLength(0);
  });

  it('describes every artifact completely when a release exists', () => {
    const data = loadManifest();
    if (!data.hasRelease) return;

    expect(typeof data.version).toBe('string');
    expect(data.tag).toMatch(/^v\d+\.\d+\.\d+/);
    expect(data.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.checksumsUrl).toContain(data.tag);

    const artifacts = Object.values(data.platforms).flat() as Array<Record<string, unknown>>;
    expect(artifacts.length).toBeGreaterThan(0);

    for (const artifact of artifacts) {
      expect(artifact.sha256).toMatch(SHA256);
      expect(artifact.url).toContain(`/releases/download/${data.tag}/`);
      // The filename carries the version by construction; if that drifts, every
      // published download link 404s.
      expect(String(artifact.filename)).toContain(String(data.version));
      expect(String(artifact.size)).toMatch(/^\d+(\.\d+)? (MB|GB)$/);
      expect(Number(artifact.sizeBytes)).toBeGreaterThan(0);
    }
  });

  it('gives every unsigned artifact a caveat where the OS will block it', () => {
    const data = loadManifest();
    if (!data.hasRelease || data.signed) return;

    const artifacts = Object.values(data.platforms).flat() as Array<Record<string, string>>;
    for (const artifact of artifacts) {
      // Windows and macOS both refuse unsigned binaries by default. A user who
      // hits that wall with no explanation concludes the download is malware.
      if (artifact.format === 'nsis' || artifact.format === 'msi' || artifact.format === 'dmg') {
        expect(artifact.caveat, `${artifact.filename} needs an unsigned-build caveat`).toBeTruthy();
      }
    }
  });
});

describe('release data states (shared builder)', () => {
  // The download page renders from the shape produced by
  // scripts/release/website-release-data.mjs. These fixture tests pin every
  // state the page must handle: stable, prerelease, and the integrity failures
  // that must hide download cards rather than invent data.
  const HASH = 'a'.repeat(64);
  const HASH_OTHER = 'b'.repeat(64);

  const artifact = (overrides: Record<string, unknown> = {}) => ({
    filename: 'Varve-0.1.0-linux-x86_64.AppImage',
    os: 'linux',
    arch: 'x86_64',
    format: 'appimage',
    sizeBytes: 1024,
    sha256: HASH,
    ...overrides,
  });

  const manifest = (artifacts: Array<Record<string, unknown>>, version = '0.1.0') => ({
    schemaVersion: 1,
    version,
    generatedAt: '2026-08-06T00:00:00.000Z',
    signed: false,
    notarized: false,
    artifacts,
  });

  const checksums = (artifacts: Array<Record<string, unknown>>) =>
    `${artifacts.map((a) => `${a.sha256}  ${a.filename}`).join('\n')}\n`;

  it('stable release state', () => {
    const data = buildWebsiteReleaseData({
      repo: 'K-Arthur/varve',
      tag: 'v0.1.0',
      manifest: manifest([artifact()]),
      checksumsText: checksums([artifact()]),
      sbomFilenames: ['varve-0.1.0-sbom.cdx.json'],
    }) as ReleaseData;
    expect(data.hasRelease).toBe(true);
    expect(data.prerelease).toBe(false);
    expect(data.version).toBe('0.1.0');
    expect(data.integrity).toBe('verified');
    expect(data.platforms.linux).toHaveLength(1);
  });

  it('prerelease state is labelled as such', () => {
    const data = buildWebsiteReleaseData({
      repo: 'K-Arthur/varve',
      tag: 'v0.1.0-alpha.1',
      manifest: manifest([artifact()], '0.1.0-alpha.1'),
      checksumsText: checksums([artifact()]),
      sbomFilenames: [],
    }) as ReleaseData;
    expect(data.prerelease).toBe(true);
  });

  it('hash mismatch state throws (never advertises)', () => {
    const broken = checksums([artifact({ sha256: HASH_OTHER })]);
    expect(() =>
      buildWebsiteReleaseData({
        repo: 'K-Arthur/varve',
        tag: 'v0.1.0',
        manifest: manifest([artifact()]),
        checksumsText: broken,
        sbomFilenames: [],
      }),
    ).toThrow(/does not match SHA256SUMS/);
  });

  it('missing checksum for an advertised artifact throws', () => {
    expect(() =>
      buildWebsiteReleaseData({
        repo: 'K-Arthur/varve',
        tag: 'v0.1.0',
        manifest: manifest([artifact()]),
        checksumsText: '',
        sbomFilenames: [],
      }),
    ).toThrow(/\(absent\)/);
  });

  it('unknown artifact format throws', () => {
    expect(() =>
      buildWebsiteReleaseData({
        repo: 'K-Arthur/varve',
        tag: 'v0.1.0',
        manifest: manifest([artifact({ format: 'flatpak' })]),
        checksumsText: checksums([artifact({ format: 'flatpak' })]),
        sbomFilenames: [],
      }),
    ).toThrow(/unknown format/);
  });

  it('committed manifest is internally consistent about its version', () => {
    const data = loadManifest();
    // The committed manifest is refreshed by the release pipeline
    // (scripts/release/fetch-website-release.mjs on release.published, or
    // update-website-manifest.mjs for local rehearsals).
    //
    // These assertions deliberately check the *invariant* rather than a
    // literal version. Pinning the expected version to a string meant every
    // release had to remember to edit this test, and when that was missed the
    // committed manifest sat a release behind while the test still passed —
    // which is exactly how the site shipped 0.1.0 download links after 0.1.1
    // was published. Consistency checks catch real drift (a tag that does not
    // match its version, URLs pointing at a different release) without going
    // stale on their own.
    expect(data.hasRelease).toBe(true);
    expect(data.integrity).toBe('verified');
    expect(data.version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/);
    expect(data.tag).toBe(`v${data.version}`);
    expect(data.checksumsUrl).toContain(`/${data.tag}/`);
    expect(data.releaseUrl).toContain(`/${data.tag}`);
  });
});

describe('robots.txt', () => {
  it('is generated from the configured site (not a static file)', () => {
    const robotsSource = path.resolve(__dirname, '../pages/robots.txt.ts');
    const content = fs.readFileSync(robotsSource, 'utf-8');
    expect(content).toContain('User-agent: *');
    expect(content).toContain('Allow: /');
    // The sitemap location must be derived from the site config, never
    // hardcoded — a stale host here is invisible to browsers and breaks SEO.
    expect(content).not.toContain('k-arthur.github.io');
    expect(content).toContain("siteUrl('/sitemap.xml')");
    // The static file must not exist: it would silently shadow the endpoint.
    expect(fs.existsSync(path.resolve(__dirname, '../../public/robots.txt'))).toBe(false);
  });
});
