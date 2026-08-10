import { awaitExportsReady, createEngine, createRasterSurface } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  createTextStyle,
  imageFill,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  patternFill,
  solidFill,
} from '@varve/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportNodeAsPdf, exportNodeAsRaster } from './export';

const { imageLoad, imageState, resetImageState } = vi.hoisted(() => {
  const loaded = new Set<string>();
  return {
    imageLoad: vi.fn(async (source: string) => {
      loaded.add(source);
      return document.createElement('img');
    }),
    imageState: (source: string) => (loaded.has(source) ? 'loaded' : 'idle'),
    resetImageState: () => loaded.clear(),
  };
});

vi.mock('@varve/engine', async () => {
  const actual = await vi.importActual<typeof import('@varve/engine')>('@varve/engine');
  return {
    ...actual,
    awaitExportsReady: vi.fn(actual.awaitExportsReady),
    createRasterSurface: vi.fn(actual.createRasterSurface),
    // Stateful cache surface for the export settlement barrier: loads are
    // recorded (so tests can assert every required source was requested)
    // and settle immediately flips the source to the loaded state.
    getImageCache: vi.fn(() => ({
      load: imageLoad,
      isLoaded: (source: string) => imageState(source) === 'loaded',
      state: (source: string) => imageState(source),
      get: (source: string) =>
        imageState(source) === 'loaded' ? { state: 'loaded', image: null } : undefined,
    })),
  };
});

function buildDoc() {
  const doc = createDocument('Export', true);
  const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { name: 'Box' });
  return { doc: { ...doc, rootChildren: ['n1'], nodes: { n1: node } }, node };
}

describe('exportNodeAsRaster', () => {
  afterEach(() => {
    vi.mocked(awaitExportsReady).mockClear();
    imageLoad.mockClear();
    resetImageState();
    vi.mocked(createRasterSurface).mockClear();
    delete (window as unknown as Record<string, unknown>).__TAURI__;
  });

  it('normalizes translated artwork to the native PDF page origin', async () => {
    const doc = createDocument('PDF', true);
    const node = makeShapeNode(
      'pdf-shape',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
      { name: 'PDF shape', transform: [1, 0, 0, 1, 120, 75] },
    );
    const pdfDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    const invoke = vi.fn(async (_command: string, _payload?: unknown) => [37, 80, 68, 70]);
    (window as unknown as Record<string, unknown>).__TAURI__ = { core: { invoke } };

    await exportNodeAsPdf(node, pdfDoc, 1);

    const payload = invoke.mock.calls[0]?.[1] as { nodes: Array<{ transform: number[] }> };
    expect(payload.nodes[0]?.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('exports a simple shape through the browser PDF fallback without a native bridge', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    const result = await exportNodeAsPdf(node, doc, 1, eng);

    expect(new TextDecoder().decode(result.bytes.slice(0, 4))).toBe('%PDF');
    expect(result.filename).toBe('Box.pdf');
  });

  it('falls back to rasterized PNG-in-PDF for image fills (native PDF cannot embed raster image fills with alpha)', async () => {
    const doc = createDocument('PDF', true);
    const base = makeShapeNode('pdf-gradient', { kind: 'rect', x: 0, y: 0, w: 40, h: 30 });
    const node = {
      ...base,
      fills: [imageFill('data:image/png;base64,AAAA', { fit: 'fill' })],
    };
    const pdfDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: { invoke: vi.fn(async () => [37, 80, 68, 70]) },
    };

    const result = await exportNodeAsPdf(node, pdfDoc, 1);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.filename).toMatch(/\.pdf$/);
  });

  it('falls back to rasterized PNG-in-PDF for text nodes (native PDF text outlining not wired)', async () => {
    const doc = createDocument('PDF text', true);
    const node = makeTextNode('pdf-text', 'Actual words', { w: 120, h: 32 });
    const pdfDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: { invoke: vi.fn(async () => [37, 80, 68, 70]) },
    };

    const result = await exportNodeAsPdf(node, pdfDoc, 1);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('falls back to rasterized PNG-in-PDF for fill/stroke alpha and blend semantics', async () => {
    const doc = createDocument('PDF transparency', true);
    const base = makeShapeNode('pdf-alpha', { kind: 'rect', x: 0, y: 0, w: 40, h: 30 });
    const node = {
      ...base,
      fills: [
        solidFill(
          { space: 'rgb', r: 255, g: 0, b: 0, a: 128 },
          { opacity: 0.75, blendMode: 'multiply' },
        ),
      ],
      strokes: [
        {
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 128 },
          weight: 2,
          align: 'center' as const,
          dashPattern: [],
          dashOffset: 0,
          cap: 'butt' as const,
          join: 'miter' as const,
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    const pdfDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: { invoke: vi.fn(async () => [37, 80, 68, 70]) },
    };

    const result = await exportNodeAsPdf(node, pdfDoc, 1);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
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

  it('creates an opaque raster surface when a configuration disables transparency', async () => {
    const { doc, node } = buildDoc();
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, doc, eng, {
      format: 'image/png',
      scale: 1,
      transparency: false,
      matteColor: [255, 255, 255, 255],
    });

    expect(createRasterSurface).toHaveBeenCalledWith(20, 10, { alpha: false });
  });

  it('clamps the effective scale and reports a warning when the requested size exceeds the portable allocation policy', async () => {
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
    expect(warnings[0]).toMatch(/portable raster safety policy/);
    expect(warnings[0]).toMatch(/scaled down/);
  });

  it('clamps by total pixel area even when neither dimension exceeds the axis limit', async () => {
    const doc = createDocument('Export', true);
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 10_000, h: 10_000 },
      { name: 'Large square' },
    );
    const bigDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };
    const eng = await createEngine('stub');

    const { warnings } = await exportNodeAsRaster(node, bigDoc, eng, {
      format: 'image/png',
      scale: 1,
    });

    expect(warnings[0]).toMatch(/total pixels/);
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

  it('produces a valid export blob for a shape with image fills', async () => {
    const doc = createDocument('Export', true);
    const baseNode = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 64, h: 64 },
      { name: 'Photo' },
    );
    const node = {
      ...baseNode,
      fills: [
        imageFill(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          { fit: 'fill' },
        ),
      ],
    };
    const imgDoc = { ...doc, rootChildren: ['n1'], nodes: { n1: node } };
    const eng = await createEngine('stub');

    const { blob, warnings } = await exportNodeAsRaster(node, imgDoc, eng, {
      format: 'image/png',
      scale: 1,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(warnings).toEqual([]);
    expect(imageLoad).toHaveBeenCalledWith(node.fills[0]?.image?.src);
  });

  it('exports a frame with every visible descendant in world coordinates', async () => {
    let doc = createDocument('Nested export', true);
    const frame = makeFrameNode('frame', {
      name: 'Frame',
      transform: [1, 0, 0, 1, 100, 50],
      w: 300,
      h: 200,
      children: [],
    });
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
      { name: 'Child', transform: [1, 0, 0, 1, 20, 25] },
    );
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, child);
    const eng = await createEngine('stub');
    const buildIr = vi.spyOn(eng, 'buildIr');

    await exportNodeAsRaster(frame, doc, eng, { format: 'image/png', scale: 1 });

    const exported = buildIr.mock.calls[0]?.[0].nodes;
    expect(exported?.map((item) => item.id)).toEqual(['frame', 'child']);
    expect(exported?.[0]?.transform).toEqual([1, 0, 0, 1, 100, 50]);
    expect(exported?.[1]?.transform).toEqual([1, 0, 0, 1, 120, 75]);
  });

  it('allocates the exact declared frame size instead of cropping to legacy placeholder bounds', async () => {
    let doc = createDocument('A4 export', true);
    const frame = makeFrameNode('a4', {
      name: 'A4',
      w: 393,
      h: 852,
      transform: [1, 0, 0, 1, -67, -561],
    });
    doc = addNode(doc, frame);
    const eng = await createEngine('stub');

    await exportNodeAsRaster(frame, doc, eng, { format: 'image/png', scale: 1 });

    expect(createRasterSurface).toHaveBeenCalledWith(393, 852, { alpha: true });
  });

  it('pads raster bounds so an outer effect is not cropped', async () => {
    const doc = createDocument('Effect export', true);
    const base = makeShapeNode('shadow', { kind: 'rect', x: 0, y: 0, w: 40, h: 30 });
    const node = {
      ...base,
      effects: [
        {
          type: 'dropShadow' as const,
          x: 10,
          y: 5,
          blur: 8,
          spread: 2,
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    };
    const effectDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, effectDoc, eng, { format: 'image/png', scale: 1 });

    expect(createRasterSurface).toHaveBeenCalledWith(112, 102, { alpha: true });
  });

  it('uses floor/ceil extents so fractional transforms cannot clip the last pixel', async () => {
    const doc = createDocument('Fractional export', true);
    const node = makeShapeNode(
      'fractional',
      { kind: 'rect', x: 0, y: 0, w: 10.2, h: 9.2 },
      { transform: [1, 0, 0, 1, 0.4, 0.4] },
    );
    const fractionalDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, fractionalDoc, eng, { format: 'image/png', scale: 1 });

    expect(createRasterSurface).toHaveBeenCalledWith(11, 10, { alpha: true });
  });

  it('exports group content successfully when group-level effects are present', async () => {
    // replayScene.ts's group branch (compositeIsolated) handles group-level
    // effects via offscreen compositing — no special warning is needed.
    let doc = createDocument('Group effect export', true);
    const group = {
      ...makeGroupNode('group'),
      effects: [{ type: 'layerBlur' as const, radius: 8, visible: true }],
    };
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 });
    doc = addNode(doc, group);
    doc = addChild(doc, group.id, child);
    const eng = await createEngine('stub');

    const { blob, warnings } = await exportNodeAsRaster(group, doc, eng, {
      format: 'image/png',
      scale: 1,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(warnings).toEqual([]);
  });

  it('loads every visible image, pattern tile, and background-removal mask before export', async () => {
    const doc = createDocument('Resource export', true);
    const base = makeShapeNode('photo', { kind: 'rect', x: 0, y: 0, w: 40, h: 30 });
    const node = {
      ...base,
      fills: [imageFill('image-a'), imageFill('image-b'), patternFill('pattern-tile')],
      backgroundRemoval: {
        maskDataUrl: 'alpha-mask',
        method: 'quick' as const,
        confidence: 1,
        appliedAt: 1,
      },
    };
    const resourceDoc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, resourceDoc, eng, { format: 'image/png', scale: 1 });

    expect(imageLoad.mock.calls.map(([src]) => src).sort()).toEqual([
      'alpha-mask',
      'image-a',
      'image-b',
      'pattern-tile',
    ]);
  });

  it('falls back to rasterized PNG-in-PDF for group compositing and masks', async () => {
    let doc = createDocument('PDF group', true);
    const group = {
      ...makeGroupNode('group', { opacity: 0.5 }),
      mask: { type: 'alpha' as const, sourceNodeId: 'child', visible: true },
    };
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 40, h: 30 });
    doc = addNode(doc, group);
    doc = addChild(doc, group.id, child);
    (window as unknown as Record<string, unknown>).__TAURI__ = {
      core: { invoke: vi.fn(async () => [37, 80, 68, 70]) },
    };

    const result = await exportNodeAsPdf(group, doc, 1);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('uses the strict text wire contract for text nested in an exported frame', async () => {
    let doc = createDocument('Nested text export', true);
    const frame = makeFrameNode('frame', { children: [], w: 240, h: 160 });
    const text = makeTextNode('text', 'Exported text', {
      transform: [1, 0, 0, 1, 12, 18],
      w: 180,
      h: 60,
      textMode: 'area',
    });
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, text);
    const eng = await createEngine('stub');
    const buildIr = vi.spyOn(eng, 'buildIr');

    await exportNodeAsRaster(frame, doc, eng, { format: 'image/png', scale: 1 });

    const textNode = buildIr.mock.calls[0]?.[0].nodes.find((item) => item.id === text.id);
    const shape = textNode?.shape as unknown as Record<string, unknown> | undefined;
    expect(shape?.kind).toBe('text');
    expect(shape?.w).toBe(180);
    expect(shape?.h).toBe(60);
    expect(awaitExportsReady).toHaveBeenCalledWith([
      {
        family: 'IBM Plex Sans Variable',
        weight: 400,
        style: 'normal',
        text: 'Exported text',
      },
    ]);
  });

  it('waits for resolved text-style and rich-run fonts, not stale raw node fonts', async () => {
    let doc = createDocument('Styled text export', true);
    const styled = createTextStyle(doc, 'Display', {
      fontFamily: 'Styled Family',
      fontSize: 48,
      fontWeight: 700,
    });
    doc = styled.doc;
    const base = makeTextNode('styled-text', 'Base text', {
      fontFamily: 'Raw Family',
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Styled ', format: { fontFamily: 'Run Family', fontWeight: 600 } },
              { text: 'inherit' },
            ],
          },
        ],
      },
    });
    const node = { ...base, styleId: styled.style.id };
    doc = { ...doc, rootChildren: [node.id], nodes: { [node.id]: node } };
    const eng = await createEngine('stub');

    await exportNodeAsRaster(node, doc, eng, { format: 'image/png', scale: 1 });

    expect(awaitExportsReady).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ family: 'Styled Family', weight: 700 }),
        expect.objectContaining({ family: 'Run Family', weight: 600, text: 'Styled ' }),
      ]),
    );
  });
});
