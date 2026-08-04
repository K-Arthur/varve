import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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

describe('website release manifest', () => {
  it('is valid JSON with a known schema version', () => {
    const data = loadManifest();
    expect(data.schemaVersion).toBe(1);
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

describe('robots.txt', () => {
  it('exists and allows all', () => {
    const robotsPath = path.resolve(__dirname, '../../public/robots.txt');
    const content = fs.readFileSync(robotsPath, 'utf-8');
    expect(content).toContain('User-agent: *');
    expect(content).toContain('Allow: /');
  });
});
