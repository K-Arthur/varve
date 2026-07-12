import { awaitExportsReady, createEngine } from '@strata/engine';
import { createDocument, makeShapeNode } from '@strata/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportNodeAsRaster } from './export';

vi.mock('@strata/engine', async () => {
  const actual = await vi.importActual<typeof import('@strata/engine')>('@strata/engine');
  return { ...actual, awaitExportsReady: vi.fn(actual.awaitExportsReady) };
});

function buildDoc() {
  const doc = createDocument('Export', true);
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Box' });
  return { doc: { ...doc, rootChildren: ['n1'], nodes: { n1: node } }, node };
}

describe('exportNodeAsRaster', () => {
  afterEach(() => {
    vi.mocked(awaitExportsReady).mockClear();
  });

  it('awaits font readiness before rendering, so exports never race a font swap', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, doc, eng, { format: 'image/png', scale: 1 });

    expect(awaitExportsReady).toHaveBeenCalledTimes(1);
  });

  it('produces an untampered blob and no warnings for an in-limit export', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    const { blob, warnings } = await exportNodeAsRaster(node, doc, eng, {
      format: 'image/png',
      scale: 1,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(warnings).toEqual([]);
  });

  it('clamps the effective scale and reports a warning when the requested size exceeds the conservative canvas limit', async () => {
    const doc = createDocument('Export', true);
    // 20000 world units at scale 2 => 40000px, well past the 16384px WebKit floor.
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 20000, h: 100 },
      { name: 'Huge' },
    );
    const bigDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };
    const eng = await createEngine('stub');

    const { blob, warnings } = await exportNodeAsRaster(node, bigDoc, eng, {
      format: 'image/png',
      scale: 2,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/16384px canvas limit/);
    expect(warnings[0]).toMatch(/scaled down/);
  });

  it('raises an actionable error instead of a raw DOMException when the canvas is tainted by a cross-origin image', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    const proto = OffscreenCanvas.prototype as unknown as {
      convertToBlob: () => Promise<Blob>;
    };
    const original = proto.convertToBlob;
    proto.convertToBlob = () => Promise.reject(new DOMException('tainted', 'SecurityError'));

    try {
      await expect(
        exportNodeAsRaster(node, doc, eng, { format: 'image/png', scale: 1 }),
      ).rejects.toThrow(/cross-origin image/);
    } finally {
      proto.convertToBlob = original;
    }
  });
});
