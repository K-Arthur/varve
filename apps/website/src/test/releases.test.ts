import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RELEASES_PATH = path.resolve(__dirname, '../../public/releases.json');

function loadReleases() {
  return JSON.parse(fs.readFileSync(RELEASES_PATH, 'utf-8'));
}

describe('releases.json', () => {
  it('has a latest version entry', () => {
    const data = loadReleases();
    expect(data.latest).toBeDefined();
    expect(typeof data.latest.version).toBe('string');
    expect(data.latest.version.length).toBeGreaterThan(0);
  });

  it('has platform entries', () => {
    const data = loadReleases();
    expect(data.platforms).toBeDefined();
    expect(data.platforms.linux).toBeDefined();
    expect(data.platforms.macos).toBeDefined();
    expect(data.platforms.windows).toBeDefined();
  });

  it('lists Linux x86_64 packages', () => {
    const data = loadReleases();
    const linux = data.platforms.linux.x86_64;
    expect(linux.appimage).toBeDefined();
    expect(linux.deb).toBeDefined();
    expect(linux.rpm).toBeDefined();
    expect(linux.aur).toBeDefined();
    expect(linux.appimage.recommended).toBe(true);
    expect(linux.appimage.url).toContain('github.com');
  });

  it('lists macOS universal package', () => {
    const data = loadReleases();
    const macos = data.platforms.macos.universal;
    expect(macos.dmg).toBeDefined();
    expect(macos.dmg.recommended).toBe(true);
    expect(macos.dmg.url).toContain('github.com');
  });

  it('lists Windows x86_64 packages', () => {
    const data = loadReleases();
    const windows = data.platforms.windows.x86_64;
    expect(windows.msi).toBeDefined();
    expect(windows.nsis).toBeDefined();
    expect(windows.msi.recommended).toBe(true);
  });

  it('has system requirements for all platforms', () => {
    const data = loadReleases();
    expect(data.systemRequirements.linux).toBeDefined();
    expect(data.systemRequirements.macos).toBeDefined();
    expect(data.systemRequirements.windows).toBeDefined();
  });

  it('has integrity information', () => {
    const data = loadReleases();
    expect(data.integrity).toBeDefined();
    expect(typeof data.integrity.checksums).toBe('boolean');
    expect(typeof data.integrity.codeSigning).toBe('boolean');
  });
});

describe('sitemap.xml', () => {
  it('exists and is valid XML', () => {
    const sitemapPath = path.resolve(__dirname, '../../public/sitemap.xml');
    const content = fs.readFileSync(sitemapPath, 'utf-8');
    expect(content).toContain('<?xml');
    expect(content).toContain('<urlset');
    expect(content).toContain('strata.design');
    expect(content).toContain('</urlset>');
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
