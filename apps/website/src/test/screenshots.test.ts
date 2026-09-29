import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseImage } from '../../../../scripts/screenshots/lib/image-analysis.mjs';

/**
 * Screenshot manifest invariants (the browser-free half of the pipeline —
 * scripts/screenshots/validate.mjs runs the same checks over the whole
 * repo, including docs references).
 *
 * Guards:
 *  1. the manifest shape, provenance and scene inventory,
 *  2. captured entries reference real, decodable PNGs with sane dimensions,
 *  3. crop/viewport/kind metadata is self-consistent,
 *  4. skipped entries carry a reason,
 *  5. the website references screenshots only through the manifest.
 */

const ROOT = path.resolve(__dirname, '..');
const manifestPath = path.join(ROOT, 'data', 'screenshot-manifest.json');
const REPO_ROOT = path.resolve(ROOT, '..', '..', '..');
const publicDir = path.join(REPO_ROOT, 'apps', 'website', 'public', 'screenshots');
const docsDir = path.join(REPO_ROOT, 'docs', 'screenshots', 'product');

interface ScreenshotScene {
  file?: string;
  alt?: string;
  caption?: string;
  feature?: string;
  theme?: string;
  kind?: string;
  status?: 'captured' | 'skipped';
  reason?: string;
  width?: number;
  height?: number;
  crop?: { x: number; y: number; width: number; height: number };
  viewport?: { width: number; height: number };
  scale?: number;
  sha256?: string;
  source?: string;
  provenanceUnknown?: boolean;
}

interface ScreenshotManifest {
  schemaVersion: number;
  scenes?: Record<string, ScreenshotScene>;
}

const KINDS = new Set(['full', 'detail', 'panel', 'wide']);

/** Whether a repo-relative path has uncommitted changes (shared checkout). */
function isDirty(relPath: string): boolean {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', relPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    // No git available: treat as committed so the check still enforces.
    return false;
  }
}

describe('screenshot manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ScreenshotManifest;

  it('has a schema version and a scenes inventory', () => {
    expect(manifest.schemaVersion).toBeGreaterThanOrEqual(1);
    const scenes = Object.values(manifest.scenes ?? {});
    expect(scenes.length).toBeGreaterThanOrEqual(4);
  });

  it('records the provenance of the run that produced it', () => {
    const provenance = manifest as unknown as {
      sourceRevision?: string;
      sourceDigest?: string;
      captureTool?: string;
    };
    // A record without provenance cannot be checked against the code it
    // depicts, which is how a screenshot silently goes stale.
    expect(provenance.sourceRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.captureTool).toBeTruthy();
  });

  it('every scene declares file/alt/caption/feature/theme/kind and a status', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      expect(scene.file, `${id}.file`).toMatch(/\.png$/);
      expect(scene.alt, `${id}.alt`).toBeTruthy();
      expect(scene.caption, `${id}.caption`).toBeTruthy();
      expect(scene.feature, `${id}.feature`).toBeTruthy();
      expect(['light', 'dark'], `${id}.theme`).toContain(scene.theme);
      expect(['captured', 'skipped'], `${id}.status`).toContain(scene.status);
      expect(KINDS, `${id}.kind`).toContain(scene.kind);
      // A file name must never be a path: it is used to build a URL and a
      // filesystem path on both the producer and the consumer side.
      expect(path.basename(scene.file as string), `${id}.file is a bare name`).toBe(scene.file);
    }
  });

  it('scene file names are unique', () => {
    const seen = new Map<string, string>();
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (!scene.file) continue;
      expect(seen.has(scene.file), `${scene.file} used by ${seen.get(scene.file)} and ${id}`).toBe(
        false,
      );
      seen.set(scene.file, id);
    }
  });

  it('captured scenes reference existing, decodable PNGs with sane dimensions', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status !== 'captured' || !scene.file) continue;
      const buf = fs.readFileSync(path.join(publicDir, scene.file));
      expect(buf.length, `${id} non-zero`).toBeGreaterThan(0);
      const analysis = analyseImage(buf);
      expect(analysis.errors, `${id}: ${analysis.errors.join('; ')}`).toEqual([]);
      expect(analysis.format, `${id} format`).toBe('png');
      // Full frames are 1440x900; cropped detail scenes are smaller by
      // design but still have to be readable at the size the site shows them.
      expect(analysis.width, `${id} width`).toBeGreaterThanOrEqual(280);
      expect(analysis.height, `${id} height`).toBeGreaterThanOrEqual(260);
      expect(scene.width, `${id}.width`).toBe(analysis.width);
      expect(scene.height, `${id}.height`).toBe(analysis.height);
      const docsPath = path.join(docsDir, scene.file);
      expect(fs.existsSync(docsPath), `${id} canonical docs copy`).toBe(true);
      expect(fs.readFileSync(docsPath).equals(buf), `${id} copies match`).toBe(true);
      expect(scene.sha256, `${id}.sha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(createHash('sha256').update(buf).digest('hex'), `${id} bytes match hash`).toBe(
        scene.sha256,
      );
    }
  });

  it('crop and viewport metadata agree with the captured file', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status !== 'captured') continue;
      // A scene produced by an external spec owns its own viewport (the spec
      // chooses it); this pipeline only owns the geometry of scenes it
      // captures itself.
      if (scene.source) continue;
      const viewport = scene.viewport ?? { width: 1440, height: 900 };
      if (scene.viewport) {
        expect(scene.viewport.width, `${id} viewport width`).toBeGreaterThan(0);
        expect(scene.viewport.height, `${id} viewport height`).toBeGreaterThan(0);
      }
      if (!scene.crop) {
        // An uncropped scene is the whole viewport.
        expect(scene.width, `${id} uncropped width`).toBe(viewport.width);
        expect(scene.height, `${id} uncropped height`).toBe(viewport.height);
        continue;
      }
      const { x, y, width, height } = scene.crop;
      expect(width, `${id} crop width`).toBe(scene.width);
      expect(height, `${id} crop height`).toBe(scene.height);
      // A crop wider or taller than its own viewport is a mis-recorded
      // capture, not a stylistic choice.
      expect(x + width, `${id} crop fits viewport width`).toBeLessThanOrEqual(viewport.width);
      expect(y + height, `${id} crop fits viewport height`).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('a scene whose producer is an external spec points at a real file', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.source === undefined) continue;
      expect(typeof scene.source, `${id}.source`).toBe('string');
      expect(
        fs.existsSync(path.join(REPO_ROOT, scene.source as string)),
        `${id}.source (${scene.source}) exists`,
      ).toBe(true);
    }
  });

  it('panels are narrow and wides are short, so the fit policy is meaningful', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status !== 'captured' || !scene.kind || !scene.width || !scene.height) continue;
      if (scene.kind === 'panel') {
        expect(scene.width, `${id} panel is narrow`).toBeLessThanOrEqual(360);
      }
      if (scene.kind === 'wide') {
        expect(scene.height, `${id} wide is short`).toBeLessThanOrEqual(320);
      }
    }
  });

  it('skipped scenes carry a reason', () => {
    for (const [id, scene] of Object.entries(manifest.scenes ?? {})) {
      if (scene.status === 'skipped') {
        expect(scene.reason, `${id}.reason`).toBeTruthy();
      }
    }
  });

  it('website sources reference screenshots only through the manifest', () => {
    // A literal `/screenshots/<file>` path in a component is the defect this
    // guards: the page keeps its hand-written alt and caption while the
    // capture underneath it is renamed, re-cropped, or replaced. Screenshot
    // URLs may only be built by `lib/screenshot.ts`, and the workflow video
    // (which is not a manifest scene) is the single documented exception.
    const allowed = new Set([
      path.join(ROOT, 'lib', 'screenshot.ts'),
      path.join(ROOT, 'lib', 'screenshot.test.ts'),
      path.join(ROOT, 'pages', 'product.astro'),
    ]);
    const literal = /\/screenshots\/([a-z0-9-]+\.(?:png|webp|webm|mp4))/g;
    const dirs = ['components', 'layouts', 'pages', 'lib'];
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
        );
    const offenders: string[] = [];
    for (const dir of dirs) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        if (allowed.has(file)) continue;
        if (!/\.(astro|ts|tsx)$/.test(file)) continue;
        // A file another task is mid-edit on is not this test's business until
        // it is committed: `scripts/screenshots/validate.mjs` fails on any
        // reference in a committed file, and commit/CI is where that must
        // break, not a shared working tree.
        if (isDirty(path.relative(REPO_ROOT, file))) continue;
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(literal)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} → ${match[1]}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
