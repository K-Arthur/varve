import { describe, expect, it } from 'vitest';
import {
  computeThumbnailIdentity,
  DEFAULT_THUMBNAIL_POLICY,
  isCanonicalThumbnailKey,
  THUMBNAIL_VARIANTS,
  type ThumbnailIdentity,
  type ThumbnailSourceSpec,
  type ThumbnailVariant,
  thumbnailSourceKey,
  thumbnailVariantKey,
} from './contracts';

const RENDERER = 'test-renderer-1';

function identityFor(
  docKey: string,
  revision: string,
  source: ThumbnailSourceSpec,
  variant: ThumbnailVariant = THUMBNAIL_VARIANTS['home-card'],
): ThumbnailIdentity {
  return computeThumbnailIdentity({
    docKey,
    revisionHash: revision,
    source,
    variant,
    rendererVersion: RENDERER,
  });
}

describe('thumbnail identity — determinism', () => {
  it('produces identical keys for identical inputs', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' });
    const b = identityFor('doc-a', 'rev1', { type: 'automatic' });
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(b.key);
  });

  it('is stable across serialization order changes of the selection', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'selection', nodeIds: ['n3', 'n1', 'n2'] });
    const b = identityFor('doc-a', 'rev1', { type: 'selection', nodeIds: ['n2', 'n3', 'n1'] });
    expect(a.key).toBe(b.key);
  });

  it('rounds region coordinates deterministically', () => {
    const a = identityFor('doc-a', 'rev1', {
      type: 'region',
      region: { x: 10.0004, y: 0, w: 100.0006, h: 50 },
    });
    const b = identityFor('doc-a', 'rev1', {
      type: 'region',
      region: { x: 10, y: 0, w: 100.001, h: 50 },
    });
    expect(a.key).toBe(b.key);
  });
});

describe('thumbnail identity — collision prevention', () => {
  it('distinguishes documents', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' });
    const b = identityFor('doc-b', 'rev1', { type: 'automatic' });
    expect(a.key).not.toBe(b.key);
  });

  it('distinguishes revisions of the same document', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' });
    const b = identityFor('doc-a', 'rev2', { type: 'automatic' });
    expect(a.key).not.toBe(b.key);
  });

  it('distinguishes same revision rendered from different sources', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' });
    const b = identityFor('doc-a', 'rev1', { type: 'page', pageId: 'p1' });
    const c = identityFor('doc-a', 'rev1', { type: 'frame', nodeId: 'n1' });
    const d = identityFor('doc-a', 'rev1', { type: 'selection', nodeIds: ['n1'] });
    const e = identityFor('doc-a', 'rev1', {
      type: 'region',
      region: { x: 0, y: 0, w: 10, h: 10 },
    });
    const keys = new Set([a.key, b.key, c.key, d.key, e.key]);
    expect(keys.size).toBe(5);
  });

  it('distinguishes page and frame targets even with equal ids', () => {
    // pageId and nodeId live in the same id space in some documents — a bare
    // id key would collide; the typed key must not.
    const a = identityFor('doc-a', 'rev1', { type: 'page', pageId: 'x1' });
    const b = identityFor('doc-a', 'rev1', { type: 'frame', nodeId: 'x1' });
    expect(a.key).not.toBe(b.key);
  });

  it('distinguishes the same source rendered into different sizes', () => {
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' }, THUMBNAIL_VARIANTS['home-card']);
    const b = identityFor('doc-a', 'rev1', { type: 'automatic' }, THUMBNAIL_VARIANTS['home-list']);
    const c = identityFor(
      'doc-a',
      'rev1',
      { type: 'automatic' },
      THUMBNAIL_VARIANTS['version-history'],
    );
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
  });

  it('distinguishes renderer versions (schema change invalidates old images)', () => {
    const a = computeThumbnailIdentity({
      docKey: 'doc-a',
      revisionHash: 'rev1',
      source: { type: 'automatic' },
      variant: THUMBNAIL_VARIANTS['home-card'],
      rendererVersion: '1',
    });
    const b = computeThumbnailIdentity({
      docKey: 'doc-a',
      revisionHash: 'rev1',
      source: { type: 'automatic' },
      variant: THUMBNAIL_VARIANTS['home-card'],
      rendererVersion: '2',
    });
    expect(a.key).not.toBe(b.key);
  });

  it('distinguishes background policy changes on the same variant role', () => {
    const variantA: ThumbnailVariant = {
      ...THUMBNAIL_VARIANTS['home-card'],
      background: { type: 'transparent' },
    };
    const variantB: ThumbnailVariant = {
      ...THUMBNAIL_VARIANTS['home-card'],
      background: { type: 'solid', color: '#ffffff' },
    };
    const a = identityFor('doc-a', 'rev1', { type: 'automatic' }, variantA);
    const b = identityFor('doc-a', 'rev1', { type: 'automatic' }, variantB);
    expect(a.key).not.toBe(b.key);
  });
});

describe('thumbnail identity — key format', () => {
  it('prefixes canonical keys and rejects legacy bare hashes', () => {
    const k = identityFor('doc-a', 'rev1', { type: 'automatic' }).key;
    expect(isCanonicalThumbnailKey(k)).toBe(true);
    expect(isCanonicalThumbnailKey('a1b2c3d4')).toBe(false);
  });

  it('composes every part into the key', () => {
    const id = identityFor('doc-a', 'rev1', { type: 'page', pageId: 'p1' });
    expect(id.key).toContain('v2');
    expect(id.key).toContain('local');
    expect(id.key).toContain('doc-a');
    expect(id.key).toContain('rev1');
    expect(id.key).toContain('page:p1');
    expect(id.key).toContain('home-card:256x192:contain');
    expect(id.key).toContain('test-renderer-1');
  });
});

describe('thumbnail source keys', () => {
  it('serializes every source kind distinctly', () => {
    const keys = [
      thumbnailSourceKey({ type: 'automatic' }),
      thumbnailSourceKey({ type: 'page', pageId: 'p' }),
      thumbnailSourceKey({ type: 'frame', nodeId: 'n' }),
      thumbnailSourceKey({ type: 'selection', nodeIds: ['n'] }),
      thumbnailSourceKey({ type: 'region', region: { x: 0, y: 0, w: 1, h: 1 } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('thumbnail variants', () => {
  it('defines every role with sane bounds', () => {
    for (const [role, v] of Object.entries(THUMBNAIL_VARIANTS)) {
      expect(v.role).toBe(role);
      expect(v.width).toBeGreaterThan(0);
      expect(v.height).toBeGreaterThan(0);
      expect(v.devicePixelRatio).toBeGreaterThanOrEqual(1);
    }
  });

  it('serializes variants deterministically and distinctly', () => {
    const keys = Object.values(THUMBNAIL_VARIANTS).map(thumbnailVariantKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('thumbnail policy', () => {
  it('denies network access structurally', () => {
    expect(DEFAULT_THUMBNAIL_POLICY.networkAccess).toBe('denied');
    expect(DEFAULT_THUMBNAIL_POLICY.encrypted).toBe(false);
  });
});
