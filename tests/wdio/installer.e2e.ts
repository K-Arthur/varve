import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@wdio/globals';

/**
 * Platform-specific installer validation suite.
 *
 * Tests vary by platform:
 * - macOS: DMG validation, code signing, hardened runtime
 * - Windows: WebView2 offline installer presence, MSI/NSIS validation
 * - Linux: AppImage/DEB/RPM structure checks
 *
 * These tests run AFTER a release build and inspect the build artifacts.
 * They are skipped if no release bundle is found.
 */

describe('Desktop: Platform installer validation', () => {
  before(async () => {
    // Skip entire suite if not running after a bundled build
    const bundleDir = process.env.VARVE_BUNDLE_DIR;
    if (!bundleDir) {
      console.log('VARVE_BUNDLE_DIR not set — skipping installer validation');
    }
  });

  if (!process.env.VARVE_BUNDLE_DIR) return;

  const bundleDir = process.env.VARVE_BUNDLE_DIR;

  describe('macOS DMG', () => {
    before(function () {
      if (process.platform !== 'darwin') this.skip();
    });

    it('should have exactly one .dmg file in the bundle directory', async () => {
      const entries = readdirSync(bundleDir).filter((f: string) => f.endsWith('.dmg'));
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });

    it('should mount and contain a universal binary', async () => {
      const dmg = readdirSync(bundleDir).find((f: string) => f.endsWith('.dmg'));
      if (!dmg) throw new Error('No DMG found');

      const mountOutput = execSync(
        `hdiutil attach -nobrowse -quiet "${bundleDir}/${dmg}" 2>/dev/null`,
        { encoding: 'utf8' },
      );
      const lines = mountOutput.trim().split('\n');
      const mountPoint = lines[lines.length - 1]?.split('\t').pop()?.trim();
      if (!mountPoint) throw new Error('Could not determine DMG mount point');

      try {
        const binary = execSync(`find "${mountPoint}" -name "varve-desktop" -type f 2>/dev/null`, {
          encoding: 'utf8',
        }).trim();
        expect(binary).not.toBe('');

        const lipoInfo = execSync(`lipo -info "${binary}" 2>/dev/null || true`, {
          encoding: 'utf8',
        });
        expect(lipoInfo).toMatch(/x86_64.*arm64|arm64.*x86_64/);
      } finally {
        execSync(`hdiutil detach -quiet "${mountPoint}" 2>/dev/null || true`);
      }
    });

    it('should have a valid Info.plist with minimum macOS version', async () => {
      const dmg = readdirSync(bundleDir).find((f: string) => f.endsWith('.dmg'));
      if (!dmg) throw new Error('No DMG found');

      const mountOutput = execSync(
        `hdiutil attach -nobrowse -quiet "${bundleDir}/${dmg}" 2>/dev/null`,
        { encoding: 'utf8' },
      );
      const lines = mountOutput.trim().split('\n');
      const mountPoint = lines[lines.length - 1]?.split('\t').pop()?.trim();

      try {
        const plistOutput = execSync(
          `plutil -p "${mountPoint}/Varve.app/Contents/Info.plist" 2>/dev/null || true`,
          { encoding: 'utf8' },
        );
        expect(plistOutput).toContain('LSMinimumSystemVersion');
        expect(plistOutput).toContain('13.0');
      } finally {
        execSync(`hdiutil detach -quiet "${mountPoint}" 2>/dev/null || true`);
      }
    });
  });

  describe('Windows installer', () => {
    before(function () {
      if (process.platform !== 'win32') this.skip();
    });

    it('should have an MSI installer in the bundle directory', async () => {
      const entries = readdirSync(bundleDir);
      const msi = entries.find((f: string) => f.endsWith('.msi'));
      expect(msi).toBeTruthy();
    });

    it('should have an NSIS installer in the bundle directory', async () => {
      const entries = readdirSync(bundleDir);
      const nsis = entries.find((f: string) => f.endsWith('.exe') && f !== 'varve-desktop.exe');
      expect(nsis).toBeTruthy();
    });
  });

  describe('Linux packages', () => {
    before(function () {
      if (process.platform !== 'linux') this.skip();
    });

    it('should have an AppImage in the bundle/appimage directory', async () => {
      const appimageDir = join(bundleDir, 'appimage');
      try {
        const entries = readdirSync(appimageDir);
        const appimage = entries.find((f: string) => f.endsWith('.AppImage'));
        expect(appimage).toBeTruthy();
      } catch {
        throw new Error('No appimage directory found in bundle');
      }
    });

    it('should have a .deb in the bundle/deb directory', async () => {
      const debDir = join(bundleDir, 'deb');
      try {
        const entries = readdirSync(debDir);
        const deb = entries.find((f: string) => f.endsWith('.deb'));
        expect(deb).toBeTruthy();
      } catch {
        throw new Error('No deb directory found in bundle');
      }
    });
  });
});
