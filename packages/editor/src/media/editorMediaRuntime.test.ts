/**
 * Editor media runtime tests — session sync, per-usage frame resolution,
 * presented stamp, and resolver installation.
 */

import { getMediaRegistry } from '@varve/engine';
import type { Document } from '@varve/scene';
import { createDocument, makeImageShapeNode } from '@varve/scene';
import type { AnimatedAssetMetadata } from '@varve/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDefaultMediaFrameResolver } from '../render/sceneToEngine';
import {
  dataUrlToBytes,
  installMediaFrameResolver,
  resetMediaRuntime,
  resolveFillFrame,
  syncMediaSessions,
  tickMediaPresentation,
} from './editorMediaRuntime';

// 1x1 transparent PNG (valid, static)
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      blend: 'source',
      disposal: 'none',
    },
    {
      index: 2,
      durationMs: 20,
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      blend: 'source',
      disposal: 'none',
    },
  ],
  decoderVersion: 1,
};

function documentWithAnimatedImage(): Document {
  let doc = createDocument('media-test');
  const node = makeImageShapeNode('img1', {
    src: PNG_DATA_URL,
    w: 64,
    h: 64,
    imageWidth: 64,
    imageHeight: 64,
  });
  doc = { ...doc, nodes: { ...doc.nodes, [node.id]: node } } as Document;
  const asset = {
    id: 'asset-media-1',
    storage: 'embedded' as const,
    mimeType: 'image/gif',
    dataUrl: PNG_DATA_URL,
    naturalWidth: 64,
    naturalHeight: 64,
    byteLength: dataUrlToBytes(PNG_DATA_URL).length,
    hash: 'media1',
    animated,
  };
  doc = { ...doc, assets: { 'asset-media-1': asset } } as Document;
  const n = doc.nodes.img1;
  if (n && n.kind === 'shape' && n.fills?.[0]?.image) {
    n.fills[0].image.assetId = 'asset-media-1';
  }
  return doc;
}

beforeEach(() => {
  resetMediaRuntime();
  clearDefaultMediaFrameResolver();
  vi.restoreAllMocks();
});

afterEach(() => {
  resetMediaRuntime();
  clearDefaultMediaFrameResolver();
});

describe('syncMediaSessions', () => {
  it('acquires sessions for animated assets only', () => {
    const doc = documentWithAnimatedImage();
    syncMediaSessions(doc);
    expect(getMediaRegistry().get('asset-media-1')).toBeDefined();
  });

  it('is a no-op for documents without animated assets', () => {
    const plain = createDocument('plain');
    syncMediaSessions(plain);
    expect(getMediaRegistry().stats.sessions).toBe(0);
  });
});

describe('resolveFillFrame', () => {
  it('resolves frames from media time through the usage settings', () => {
    const doc = documentWithAnimatedImage();
    syncMediaSessions(doc);
    const node = doc.nodes.img1;
    const fill = node?.fills?.[0];
    expect(fill).toBeDefined();
    expect(resolveFillFrame(node!, fill!, doc, 0)).toBe(0);
    expect(resolveFillFrame(node!, fill!, doc, 40)).toBe(1);
    expect(resolveFillFrame(node!, fill!, doc, 150)).toBe(2);
    expect(resolveFillFrame(node!, fill!, doc, 170)).toBe(0); // wrapped
  });

  it('uses the poster frame when the session is missing', () => {
    const doc = documentWithAnimatedImage();
    const node = doc.nodes.img1;
    const fill = node?.fills?.[0];
    const withPoster = doc.assets!['asset-media-1']!;
    void withPoster;
    // no session registered — poster (0)
    expect(resolveFillFrame(node!, fill!, doc, 200)).toBe(0);
  });
});

describe('tickMediaPresentation', () => {
  it('advances the presented stamp only when resolved frames change', () => {
    const doc = documentWithAnimatedImage();
    syncMediaSessions(doc);
    const stamp0 = tickMediaPresentation(doc, 0);
    const stamp1 = tickMediaPresentation(doc, 10); // same frame 0
    expect(stamp1).toBe(stamp0);
    const stamp2 = tickMediaPresentation(doc, 40); // frame 1
    expect(stamp2).toBeGreaterThan(stamp1);
    const stamp3 = tickMediaPresentation(doc, 41); // still frame 1
    expect(stamp3).toBe(stamp2);
  });
});

describe('installMediaFrameResolver', () => {
  it('installs the default sceneToEngine resolver idempotently', () => {
    installMediaFrameResolver();
    installMediaFrameResolver();
    // resolver installed without throwing; teardown clears it
    clearDefaultMediaFrameResolver();
  });
});
