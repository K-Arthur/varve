/**
 * Worker command transport cost: data-URL IR vs resource-handle IR.
 *
 * A worker command carries the render IR through structured clone. Before
 * the resource-handle migration the IR embedded the full base64 payload per
 * placement; after it, the IR carries a short handle and the bitmap is
 * transferred separately (missing-only delta). This bench measures the
 * postMessage-side cost difference (structuredClone in Node stands in for
 * the transfer's clone phase).
 */
import { bench, describe } from 'vitest';
import { createEngine } from '../engine';
import { registerImageResourceHandle, resetImageResourceRegistry } from '../imageResourceRegistry';
import type { SceneNode } from '../types';

function largeDataUrl(bytes = 2 * 1024 * 1024): string {
  const base64 = 'iVBORw0KGgo'.repeat(Math.ceil(bytes / 10)).slice(0, Math.ceil(bytes / 3) * 4);
  return `data:image/png;base64,${base64}`;
}

function imageFillNode(src: string, assetId?: string): SceneNode {
  return {
    id: 'n1',
    name: 'photo',
    transform: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'rect', x: 0, y: 0, w: 800, h: 533 },
    opacity: 1,
    blendMode: 'normal',
    fills: [
      {
        type: 'image',
        image: {
          src,
          ...(assetId ? { assetId } : {}),
          fit: 'fill',
          x: 0,
          y: 0,
          scale: 1,
          imageWidth: 4000,
          imageHeight: 3000,
        },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
  };
}

describe('worker IR transport (structured clone)', () => {
  bench('legacy IR with embedded data URL (2 MiB photo)', async () => {
    const payload = largeDataUrl();
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({
      nodes: Array.from({ length: 10 }, () => imageFillNode(payload)),
    });
    structuredClone(ir);
  });

  bench('handle IR with short resource id', async () => {
    resetImageResourceRegistry();
    const handle = 'asset-abcdef0123456789';
    registerImageResourceHandle(handle, largeDataUrl());
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({
      nodes: Array.from({ length: 10 }, () => imageFillNode(handle, handle)),
    });
    structuredClone(ir);
  });

  bench('handle IR, 100 placements of one asset', async () => {
    resetImageResourceRegistry();
    const handle = 'asset-abcdef0123456789';
    registerImageResourceHandle(handle, largeDataUrl());
    const eng = await createEngine('stub');
    const ir = await eng.buildIr({
      nodes: Array.from({ length: 100 }, () => imageFillNode(handle, handle)),
    });
    structuredClone(ir);
  });
});
