import { describe, expect, it } from 'vitest';
import {
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from './document';
import { gradientFill, imageFill, solidFill } from './fills';
import {
  aggregateSelectedPaints,
  collectSelectedPaints,
  replaceSelectedPaintReferences,
} from './selectedPaints';
import type { Fill, ManagedColor, SceneNode, ShapeNode } from './types';

const red: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
const blue: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 255, a: 255 };
const green: ManagedColor = { space: 'rgb', r: 0, g: 255, b: 0, a: 255 };
const black: ManagedColor = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };

function withNodes(nodes: SceneNode[], rootChildren = nodes.map((node) => node.id)) {
  const doc = createDocument('selection paints', true);
  return {
    ...doc,
    rootChildren,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
  };
}

describe('collectSelectedPaints', () => {
  it('collects visible multi-fills, strokes and every gradient stop without flattening opacity', () => {
    const shape = {
      ...makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [
        solidFill(red, { opacity: 0.5 }),
        gradientFill('angular', [
          { position: 0, color: red },
          { position: 0.5, color: green },
          { position: 1, color: blue },
        ]),
        { ...solidFill(black), visible: false },
      ],
      strokes: [
        {
          color: black,
          weight: 1,
          align: 'center' as const,
          dashPattern: [],
          dashOffset: 0,
          cap: 'round' as const,
          join: 'miter' as const,
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    const summary = collectSelectedPaints(withNodes([shape]), ['shape']);

    expect(summary.references.map((reference) => reference.role)).toEqual([
      'fill',
      'gradient-stop',
      'gradient-stop',
      'gradient-stop',
      'stroke',
    ]);
    expect(summary.groups).toHaveLength(5);
    expect(summary.references[0]).toMatchObject({ paintOpacity: 0.5, objectOpacity: 1 });
    expect(
      summary.references.some(
        (reference) => reference.color === black && reference.role === 'fill',
      ),
    ).toBe(false);
  });

  it('aggregates equal local colours but never collapses alpha, fill opacity or colour-space identity', () => {
    const rgb = makeShapeNode('rgb', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { fill: red });
    const same = makeShapeNode(
      'same',
      { kind: 'ellipse', cx: 5, cy: 5, rx: 5, ry: 5 },
      { fill: red },
    );
    const translucent = {
      ...makeShapeNode('translucent', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [solidFill({ ...red, a: 128 })],
    };
    const painted = {
      ...makeShapeNode('painted', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [solidFill(red, { opacity: 0.5 })],
    };
    const cmyk = {
      ...makeShapeNode('cmyk', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fill: { space: 'cmyk' as const, c: 0, m: 255, y: 255, k: 0, a: 255 },
    };
    const summary = collectSelectedPaints(withNodes([rgb, same, translucent, painted, cmyk]), [
      'rgb',
      'same',
      'translucent',
      'painted',
      'cmyk',
    ]);

    expect(summary.groups).toHaveLength(4);
    expect(summary.groups[0]?.references).toHaveLength(2);
    expect(summary.groups.map((group) => group.paintOpacity)).toEqual([1, 1, 0.5, 1]);
  });

  it('resolves shared paints but keeps independently-addressable paints semantically separate', () => {
    const shared: Fill = solidFill(red);
    const first = {
      ...makeShapeNode('first', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: ['p1'],
    };
    const second = {
      ...makeShapeNode('second', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: ['p1'],
    };
    const third = {
      ...makeShapeNode('third', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: ['p2'],
    };
    const document = {
      ...withNodes([first, second, third]),
      paints: {
        p1: { id: 'p1', name: 'One', fill: shared },
        p2: { id: 'p2', name: 'Two', fill: shared },
      },
    };
    const summary = collectSelectedPaints(document, ['first', 'second', 'third']);

    expect(summary.groups).toHaveLength(2);
    expect(summary.groups[0]?.references.map((reference) => reference.linkedPaintId)).toEqual([
      'p1',
      'p1',
    ]);
  });

  it('walks selected containers in paint order, excludes hidden descendants, and does not double-count parent plus child selection', () => {
    const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { fill: red });
    const hidden = makeShapeNode(
      'hidden',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { fill: blue, visible: false },
    );
    const nested = makeGroupNode('nested', { children: ['child', 'hidden'] });
    const frame = {
      ...makeFrameNode('frame', { children: ['nested'], fill: green }),
      fills: [solidFill(green)],
    };
    const document = withNodes([frame, nested, child, hidden], ['frame']);
    const summary = collectSelectedPaints(document, ['frame', 'child']);

    expect(summary.references.map((reference) => reference.nodeId)).toEqual(['frame', 'child']);
    expect(summary.references.map((reference) => reference.color)).toEqual([green, red]);
  });

  it('reads rich text runs, makes linked-story paint explicit, and retains text strokes', () => {
    const text = {
      ...makeTextNode('text', 'Red Blue', { fill: black }),
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Red ', format: { color: red } },
              { text: 'Blue', format: { color: blue } },
            ],
          },
        ],
      },
      strokes: [
        {
          color: green,
          weight: 1,
          align: 'center' as const,
          dashPattern: [],
          dashOffset: 0,
          cap: 'round' as const,
          join: 'miter' as const,
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    const summary = collectSelectedPaints(withNodes([text]), ['text']);

    expect(summary.references.map((reference) => reference.role)).toEqual([
      'text-fill',
      'text-fill',
      'stroke',
    ]);
    expect(summary.references.map((reference) => reference.color)).toEqual([red, blue, green]);

    const storyText = {
      ...text,
      id: 'story-text',
      storyBinding: { storyId: 'story', threadIndex: 0 },
    };
    const storyDocument = {
      ...withNodes([storyText]),
      stories: {
        story: { id: 'story', name: 'Story', thread: ['story-text'], content: text.richText },
      },
    };
    const storySummary = collectSelectedPaints(storyDocument, ['story-text']);
    expect(
      storySummary.references.filter((reference) => reference.location.kind === 'text-run'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ editable: false, editBlockReason: 'linked-story' }),
      ]),
    );
  });

  it('uses the active rich-text range instead of inspecting unselected text runs', () => {
    const text = {
      ...makeTextNode('text', 'Red Blue', { fill: black }),
      richText: {
        paragraphs: [
          {
            runs: [
              { text: 'Red', format: { color: red } },
              { text: ' Blue', format: { color: blue } },
            ],
          },
        ],
      },
    };
    const summary = collectSelectedPaints(withNodes([text]), ['text'], {
      textRange: {
        start: { paragraphIndex: 0, offset: 0 },
        end: { paragraphIndex: 0, offset: 3 },
      },
    });

    expect(summary.references.map((reference) => reference.color)).toEqual([red]);
  });

  it('keeps images and raster layers separate from editable vector paints', () => {
    const image = {
      ...makeShapeNode('image', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [imageFill('data:image/png;base64,AA')],
    };
    const vector = makeShapeNode(
      'vector',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { fill: red },
    );
    const raster = {
      ...makeShapeNode('raster', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      kind: 'rasterLayer' as const,
      width: 10,
      height: 10,
      pixelMode: false,
      tiles: new Map(),
    } as SceneNode;
    const summary = collectSelectedPaints(withNodes([image, vector, raster]), [
      'image',
      'vector',
      'raster',
    ]);

    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0]?.color).toEqual(red);
    expect(summary.nonColorPaints).toEqual([
      { kind: 'image', count: 1, nodeIds: ['image'] },
      { kind: 'raster', count: 1, nodeIds: ['raster'] },
    ]);
    expect(summary.hasRasterContent).toBe(true);
  });
});

describe('replaceSelectedPaintReferences', () => {
  it('replaces exactly the presented vector paint usages and preserves gradient geometry', () => {
    const diamond = gradientFill('diamond', [
      { position: 0, color: red },
      { position: 1, color: blue },
    ]);
    diamond.gradient!.transform = [1, 0, 0, 1, 4, 8];
    const selected = {
      ...makeShapeNode('selected', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      fills: [solidFill(red), diamond],
      strokes: [
        {
          color: red,
          weight: 1,
          align: 'center' as const,
          dashPattern: [],
          dashOffset: 0,
          cap: 'round' as const,
          join: 'miter' as const,
          miterLimit: 4,
          visible: true,
        },
      ],
    };
    const unselected = makeShapeNode(
      'unselected',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { fill: red },
    );
    const document = withNodes([selected, unselected]);
    const group = collectSelectedPaints(document, ['selected']).groups.find(
      (candidate) => candidate.color === red,
    )!;
    expect(group.roles).toEqual(['fill', 'gradient-stop', 'stroke']);
    expect(group.editableReferenceCount).toBe(3);
    expect(replaceSelectedPaintReferences(document, group.references, red)).toBe(document);
    const result = replaceSelectedPaintReferences(document, group.references, green);
    const resultNode = result.nodes.selected! as ShapeNode;

    expect(resultNode.fills?.[0]?.color).toEqual(green);
    expect(resultNode.strokes?.[0]?.color).toEqual(green);
    const gradient = resultNode.fills?.[1]?.gradient;
    expect(gradient?.stops.map((stop) => stop.color)).toEqual([green, blue]);
    expect(gradient?.transform).toEqual([1, 0, 0, 1, 4, 8]);
    expect(result.nodes.unselected?.fill).toEqual(red);
  });

  it('detaches only selected shared-paint usages and does not mutate the shared definition', () => {
    const selected = {
      ...makeShapeNode('selected', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: ['p'],
    };
    const untouched = {
      ...makeShapeNode('untouched', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      paintRefs: ['p'],
    };
    const document = {
      ...withNodes([selected, untouched]),
      paints: { p: { id: 'p', name: 'Shared red', fill: solidFill(red) } },
    };
    const refs = collectSelectedPaints(document, ['selected']).groups[0]!.references;
    const result = replaceSelectedPaintReferences(document, refs, green);

    expect(result.paints?.p?.fill.color).toEqual(red);
    expect(result.nodes.selected?.paintRefs).toBeUndefined();
    expect((result.nodes.selected! as ShapeNode).fills?.[0]?.color).toEqual(green);
    expect(result.nodes.untouched?.paintRefs).toEqual(['p']);
  });

  it('does not mutate locked or linked-story references', () => {
    const locked = makeShapeNode(
      'locked',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { fill: red, locked: true },
    );
    const document = withNodes([locked]);
    const refs = collectSelectedPaints(document, ['locked']).references;
    expect(replaceSelectedPaintReferences(document, refs, green)).toBe(document);
  });

  it('keeps aggregation references intact while grouping presentation entries', () => {
    const references = collectSelectedPaints(
      withNodes([
        makeShapeNode('one', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { fill: red }),
        makeShapeNode('two', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { fill: red }),
      ]),
      ['one', 'two'],
    ).references;
    expect(aggregateSelectedPaints(references)[0]?.references).toEqual(references);
  });
});
