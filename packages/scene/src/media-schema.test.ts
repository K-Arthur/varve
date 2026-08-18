/**
 * Schema 2.20: animated-media metadata — migration, asset validation, and
 * round-trip behavior.
 */

import type { AnimatedAssetMetadata } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import {
  createEmbeddedAsset,
  findOrCreateEmbeddedAsset,
  validateAnimatedAssetMetadata,
} from './assets';
import { createDocument } from './document';
import { migrateDocument } from './version';

const animated: AnimatedAssetMetadata = {
  kind: 'gif',
  frameCount: 3,
  durationMs: 160,
  loopCount: 'infinite',
  width: 64,
  height: 64,
  frames: [
    {
      index: 0,
      durationMs: 40,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      blend: 'source',
      disposal: 'none',
    },
    {
      index: 1,
      durationMs: 100,
      x: 8,
      y: 8,
      width: 16,
      height: 16,
      blend: 'source',
      disposal: 'background',
    },
    {
      index: 2,
      durationMs: 20,
      x: 32,
      y: 32,
      width: 16,
      height: 16,
      blend: 'over',
      disposal: 'previous',
    },
  ],
  decoderVersion: 1,
};

describe('migration 2.19 → 2.20', () => {
  it('stamps the version additively without touching old documents', () => {
    const raw = {
      formatVersion: '2.19',
      nodes: { n1: { id: 'n1', kind: 'shape' } },
      assets: {
        'asset-1': {
          id: 'asset-1',
          storage: 'embedded',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          naturalWidth: 10,
          naturalHeight: 10,
          byteLength: 4,
          hash: 'abc',
        },
      },
    };
    const migrated = migrateDocument(raw);
    expect(migrated?.formatVersion).toBe('2.21');
    // static asset unchanged — no animated structures fabricated
    expect(
      (migrated?.assets as Record<string, { animated?: unknown }> | undefined)?.['asset-1']
        ?.animated,
    ).toBeUndefined();
  });

  it('preserves animated metadata across the chain', () => {
    const doc = createDocument('t');
    const { document } = findOrCreateEmbeddedAsset(doc, {
      dataUrl: 'data:image/gif;base64,QUJDRA==',
      mimeType: 'image/gif',
      naturalWidth: 64,
      naturalHeight: 64,
      animated,
    });
    const asset = document.assets?.[Object.keys(document.assets ?? {})[0] ?? ''];
    expect(asset?.animated).toEqual(animated);
  });
});

describe('validateAnimatedAssetMetadata', () => {
  it('accepts valid metadata', () => {
    expect(validateAnimatedAssetMetadata('a', animated)).toBeNull();
  });

  it('rejects malformed metadata', () => {
    expect(validateAnimatedAssetMetadata('a', { ...animated, frameCount: 1 })).toMatch(
      /frameCount/,
    );
    expect(
      validateAnimatedAssetMetadata('a', {
        ...animated,
        frames: animated.frames.slice(0, 2),
      }),
    ).toMatch(/frameCount/);
    expect(validateAnimatedAssetMetadata('a', { ...animated, kind: 'jpeg' as never })).toMatch(
      /kind/,
    );
    const badRectFrames = animated.frames.map((f, i) => (i === 0 ? { ...f, width: 100 } : f));
    expect(
      validateAnimatedAssetMetadata('a', {
        ...animated,
        frames: badRectFrames,
      }),
    ).toMatch(/canvas bounds/);
    const badDisposalFrames = animated.frames.map((f, i) =>
      i === 0 ? { ...f, disposal: 'keep' as never } : f,
    );
    expect(
      validateAnimatedAssetMetadata('a', {
        ...animated,
        frames: badDisposalFrames,
      }),
    ).toMatch(/disposal/);
  });
});

describe('createEmbeddedAsset carries animated metadata', () => {
  it('round-trips the field and dedups by content', () => {
    const a = createEmbeddedAsset({
      dataUrl: 'data:image/gif;base64,QUJDRA==',
      mimeType: 'image/gif',
      naturalWidth: 64,
      naturalHeight: 64,
      animated,
    });
    expect(a.animated).toEqual(animated);
    const b = createEmbeddedAsset({
      dataUrl: 'data:image/gif;base64,QUJDRA==',
      mimeType: 'image/gif',
      naturalWidth: 64,
      naturalHeight: 64,
    });
    expect(a.id).toBe(b.id); // dedup by bytes regardless of animated block
  });
});
