import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Screenshot manifest invariants (the browser-free half of the pipeline —
 * scripts/screenshots/validate.mjs runs the same checks over the whole
 * repo, including docs references).
 *
 * Guards:
 *  1. the manifest shape and scene inventory,
 *  2. captured entries reference real, non-empty PNGs with sane dimensions,
 *  3. skipped entries carry a reason,
 *  4. the website references only captured scenes.
 */

const ROOT = path.resolve(__dirname, '..');
const manifestPath = path.join(ROOT, 'data', 'screenshot-manifest.json');
const publicDir = path.join(ROOT, '..', '..', '..', 'apps', 'website', 'public', 'screenshots');

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (sig.some((b, i) => buf[i] !== b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

interface ScreenshotScene {
  file?: string;
  alt?: string;
  caption?: string;
  feature?: string;
  theme?: string;
  status?: 'captured' | 'skipped';
  reason?: string;
  width?: number;
  height?: number;
}

interface ScreenshotManifest {
  schemaVersion: number;
  scenes?: Record<string, ScreenshotScene>;
}

describe('screenshot manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ScreenshotManifest;

  it('has a schema version and a scenes inventory', () => {
    expect(manifest.schemaVersion).toBeGreaterThanOrEqual(1);
    const scenes = Object.values(manifest.scenes ?? {});
    expect(scenes.length).toBeGreaterThanOrEqual(4);
  });

  it('every scene declares file/alt/caption/feature/theme and a status', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      expect(scene.file, `${id}.file`).toMatch(/\.png$/);
      expect(scene.alt, `${id}.alt`).toBeTruthy();
      expect(scene.caption, `${id}.caption`).toBeTruthy();
      expect(scene.feature, `${id}.feature`).toBeTruthy();
      expect(['light', 'dark'], `${id}.theme`).toContain(scene.theme);
      expect(['captured', 'skipped'], `${id}.status`).toContain(scene.status);
    }
  });

  it('captured scenes reference existing non-empty PNGs with sane dimensions', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status !== 'captured' || !scene.file) continue;
      const buf = fs.readFileSync(path.join(publicDir, scene.file));
      expect(buf.length, `${id} non-zero`).toBeGreaterThan(0);
      const dims = pngSize(buf);
      expect(dims, `${id} valid png`).not.toBeNull();
      // Full frames are 1440x900; cropped detail scenes are smaller by
      // design but still have to be readable at the size the site shows them.
      expect(dims!.width, `${id} width`).toBeGreaterThanOrEqual(280);
      expect(dims!.height, `${id} height`).toBeGreaterThanOrEqual(260);
      if (scene.width) expect(scene.width, `${id}.width`).toBe(dims!.width);
      if (scene.height) expect(scene.height, `${id}.height`).toBe(dims!.height);
    }
  });

  it('skipped scenes carry a reason', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status === 'skipped') {
        expect(scene.reason, `${id}.reason`).toBeTruthy();
      }
    }
  });

  it('website sources reference only captured scenes', () => {
    const captured = new Set(
      Object.values(manifest.scenes ?? {})
        .filter((s) => s.status === 'captured')
        .map((s) => s.file),
    );
    const dirs = ['components', 'layouts', 'pages', 'lib', 'styles'];
    const files = dirs.flatMap((d) => {
      const abs = path.join(ROOT, d);
      if (!fs.existsSync(abs)) return [];
      const walk = (dir: string): string[] =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
          );
      return walk(abs);
    });
    const refs = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\/screenshots\/([a-z0-9-]+\.png)/g)) refs.add(m[1]!);
    }
    for (const ref of refs) {
      expect(captured, `reference /screenshots/${ref}`).toContain(ref);
    }
  });
});
