/**
 * Data-URL regression gate: render IR must carry the short canonical
 * resource handle, not the multi-megabyte base64 payload. Records the
 * serialized IR size difference so the improvement stays measurable.
 */
import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import { registerImageResourceHandle, resetImageResourceRegistry } from '../imageResourceRegistry';
import type { SceneNode } from '../types';

/** Build a ~2 MiB fake base64 payload (deterministic, no real decode). */
function largeDataUrl(mime = 'image/png', bytes = 2 * 1024 * 1024): string {
  const base64 = 'iVBORw0KGgo'.repeat(Math.ceil(bytes / 10)).slice(0, Math.ceil(bytes / 3) * 4);
  return `data:${mime};base64,${base64}`;
}

function imageFillNode(src: string, assetId?: string): SceneNode {
  const node: SceneNode = {
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
  return node;
}

describe('render IR data-URL regression', () => {
  it('IR carries the short handle and not the payload for canonical assets', async () => {
    resetImageResourceRegistry();
    const handle = 'asset-abcdef0123456789';
    const payload = largeDataUrl();
    registerImageResourceHandle(handle, payload);

    const eng = await createEngine('stub');
    const legacyIr = await eng.buildIr({ nodes: [imageFillNode(payload)] });
    const handleIr = await eng.buildIr({ nodes: [imageFillNode(handle, handle)] });

    const legacyBytes = JSON.stringify(legacyIr).length;
    const handleBytes = JSON.stringify(handleIr).length;

    expect(JSON.stringify(handleIr)).not.toContain('base64,');
    expect(JSON.stringify(handleIr)).toContain(handle);
    // The handle IR must be orders of magnitude smaller than the payload IR.
    expect(handleBytes).toBeLessThan(legacyBytes / 100);
    // And the payload never travels through the IR.
    expect(handleBytes).toBeLessThan(payload.length / 10);
    resetImageResourceRegistry();
  });

  it('structured-clone cost drops with handles (transfer payload comparison)', async () => {
    resetImageResourceRegistry();
    const handle = 'asset-abcdef0123456789';
    const payload = largeDataUrl();
    registerImageResourceHandle(handle, payload);

    const eng = await createEngine('stub');
    const legacyIr = await eng.buildIr({ nodes: [imageFillNode(payload)] });
    const handleIr = await eng.buildIr({ nodes: [imageFillNode(handle, handle)] });

    const cloneLegacy = structuredClone(legacyIr);
    const cloneHandle = structuredClone(handleIr);
    expect(cloneLegacy).toHaveLength(legacyIr.length);
    expect(cloneHandle).toHaveLength(handleIr.length);

    const legacyCloneBytes = new TextEncoder().encode(JSON.stringify(cloneLegacy)).length;
    const handleCloneBytes = new TextEncoder().encode(JSON.stringify(cloneHandle)).length;
    expect(handleCloneBytes).toBeLessThan(legacyCloneBytes / 100);
    resetImageResourceRegistry();
  });

  it('shared asset references collapse to one short identity in the IR', async () => {
    resetImageResourceRegistry();
    const handle = 'asset-abcdef0123456789';
    const payload = largeDataUrl();
    registerImageResourceHandle(handle, payload);
    const eng = await createEngine('stub');
    // 100 placements of one asset: the IR repeats a 22-char handle, not a
    // 2.8 MiB payload 100 times.
    const nodes = Array.from({ length: 100 }, (_, i) => imageFillNode(handle, handle));
    const ir = await eng.buildIr({ nodes });
    const bytes = new TextEncoder().encode(JSON.stringify(ir)).length;
    const legacyNodes = Array.from({ length: 100 }, (_, i) => imageFillNode(payload));
    const legacyIr = await eng.buildIr({ nodes: legacyNodes });
    const legacyBytes = new TextEncoder().encode(JSON.stringify(legacyIr)).length;
    expect(bytes).toBeLessThan(legacyBytes / 1000);
    expect(bytes).toBeLessThan(100 * 500);
    resetImageResourceRegistry();
  });
});
