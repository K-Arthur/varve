import { describe, expect, it } from 'vitest';
import { createDocument, makeShapeNode } from './document';
import { DocumentCodec } from './documentCodec';
import {
  createDocumentIconAsset,
  iconAssetIdFor,
  isIconAssetReferenced,
  validateIconAsset,
} from './iconAsset';

const SANITIZED_SVG = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    ...createDocumentIconAsset('home', 'mdi', SANITIZED_SVG, { providerId: 'iconify' }),
    ...overrides,
  };
}

describe('validateIconAsset', () => {
  it('accepts a well-formed asset', () => {
    expect(validateIconAsset(makeAsset())).toBeNull();
  });

  it('rejects non-objects and empty ids', () => {
    expect(validateIconAsset(null)).not.toBeNull();
    expect(validateIconAsset('svg')).not.toBeNull();
    expect(validateIconAsset(makeAsset({ id: '' }))).not.toBeNull();
  });

  it('rejects invalid storage modes and missing svg', () => {
    expect(validateIconAsset(makeAsset({ storageMode: 'inline' }))).not.toBeNull();
    expect(validateIconAsset(makeAsset({ svg: '' }))).not.toBeNull();
  });

  it('allows free-form provenance fields', () => {
    const asset = makeAsset({ licence: 'MIT', attribution: 'Material Design Icons', tags: ['ui'] });
    expect(validateIconAsset(asset)).toBeNull();
  });
});

describe('iconAssetIdFor', () => {
  it('is deterministic and prefix-safe', () => {
    expect(iconAssetIdFor('mdi', 'abc')).toBe(iconAssetIdFor('mdi', 'abc'));
    expect(iconAssetIdFor('mdi', 'abc')).not.toBe(iconAssetIdFor('mdi', 'def'));
    expect(iconAssetIdFor('My Pack!', 'abc')).toMatch(/^icon-my-pack-/);
  });
});

describe('isIconAssetReferenced', () => {
  it('detects node references', () => {
    const doc = {
      nodes: {
        a: { iconAssetId: 'icon-x-1' },
        b: { iconAssetId: 'icon-y-2' },
      },
    };
    expect(isIconAssetReferenced(doc, 'icon-x-1')).toBe(true);
    expect(isIconAssetReferenced(doc, 'icon-z-3')).toBe(false);
  });
});

describe('DocumentCodec iconAssets round-trip', () => {
  it('preserves iconAssets through encode/decode', () => {
    const doc = createDocument('icons', true);
    const asset = makeAsset();
    const withAsset = { ...doc, iconAssets: { [asset.id]: asset } };
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 24, h: 24 }, { name: 'Icon' });
    const nodeDoc = {
      ...withAsset,
      nodes: { ...withAsset.nodes, n1: { ...node, iconAssetId: asset.id } },
      rootChildren: [...withAsset.rootChildren, 'n1'],
    };

    const json = DocumentCodec.encode(nodeDoc);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.iconAssets?.[asset.id]).toBeDefined();
    expect(decoded.document.iconAssets?.[asset.id]?.providerId).toBe('iconify');
    expect(decoded.document.nodes.n1?.iconAssetId).toBe(asset.id);
  });

  it('prunes icon assets that are no longer referenced', () => {
    const doc = createDocument('icons', true);
    const referenced = makeAsset({ id: 'icon-ref-1' });
    const orphaned = makeAsset({ id: 'icon-orphan-2' });
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 24, h: 24 }, { name: 'Icon' });
    const withAsset = {
      ...doc,
      iconAssets: { [referenced.id]: referenced, [orphaned.id]: orphaned },
      nodes: { ...doc.nodes, n1: { ...node, iconAssetId: referenced.id } },
      rootChildren: [...doc.rootChildren, 'n1'],
    };

    const json = DocumentCodec.encode(withAsset);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.iconAssets?.[referenced.id]).toBeDefined();
    expect(decoded.document.iconAssets?.[orphaned.id]).toBeUndefined();
  });

  it('drops structurally invalid assets with a warning', () => {
    const doc = createDocument('icons', true);
    const asset = makeAsset({ id: 'icon-bad-1' });
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 24, h: 24 }, { name: 'Icon' });
    const withAsset = {
      ...doc,
      iconAssets: {
        [asset.id]: { ...asset, svg: 42 },
      },
      nodes: { ...doc.nodes, n1: { ...node, iconAssetId: asset.id } },
      rootChildren: [...doc.rootChildren, 'n1'],
    };

    const normalized = DocumentCodec.normalize(
      withAsset as unknown as Parameters<typeof DocumentCodec.normalize>[0],
    );
    expect(normalized.document.iconAssets).toBeUndefined();
    expect(normalized.warnings.some((w) => w.code === 'document.invalid-icon-asset')).toBe(true);
  });
});
