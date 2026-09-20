import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  type SceneNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  computePanelCells,
  divideFrameIntoPanels,
  joinPanels,
  makePanelNode,
  orderPanelIds,
  PANEL_LAYOUT_PRESETS,
  type PanelLayoutPreset,
  previewPanelDivision,
  renumberPanelsInFrame,
} from '../panelLayout';

const NINE_PANEL = PANEL_LAYOUT_PRESETS.find((preset) => preset.id === 'nine-panel')!;
const WEBTOON = PANEL_LAYOUT_PRESETS.find((preset) => preset.id === 'webtoon-stack')!;

describe('computePanelCells', () => {
  it('divides the bounds into equal cells with one constant gutter and margin', () => {
    const cells = computePanelCells({ w: 1000, h: 1400 }, NINE_PANEL);
    expect(cells).toHaveLength(9);

    // gutter = margin = 4% of width = 40; available = 1000 - 80 - 80 = 840.
    expect(cells[0]).toEqual({ x: 40, y: 40, w: 280, h: 413.3333333333333 });
    const last = cells[8]!;
    expect(last.x + last.w).toBeCloseTo(960, 6);
    expect(last.y + last.h).toBeCloseTo(1360, 6);
  });

  it('keeps a single constant gutter between neighbouring cells', () => {
    const cells = computePanelCells({ w: 1000, h: 1400 }, NINE_PANEL);
    const row = cells.slice(0, 3);
    const gap = row[1]!.x - (row[0]!.x + row[0]!.w);
    expect(gap).toBeCloseTo(40, 6);
  });

  it('uses the larger vertical gutter for webtoon pacing', () => {
    const cells = computePanelCells({ w: 800, h: 6000 }, WEBTOON);
    expect(cells).toHaveLength(4);
    const verticalGap = cells[1]!.y - (cells[0]!.y + cells[0]!.h);
    expect(verticalGap).toBeCloseTo(176, 6);
  });

  it('returns no cells when the bounds cannot fit the layout', () => {
    const tiny: PanelLayoutPreset = {
      id: 'two-up',
      label: 'Two-up',
      rows: 1,
      columns: 2,
      gutterRatio: 0.4,
    };
    expect(computePanelCells({ w: 100, h: 100 }, tiny)).toEqual([]);
  });
});

describe('makePanelNode', () => {
  it('creates a clipped paper panel whose border sits outside the content area', () => {
    const node = makePanelNode('p1', [1, 0, 0, 1, 0, 0], { w: 300, h: 200 });
    expect(node.kind).toBe('frame');
    if (node.kind !== 'frame') throw new Error('expected frame');
    expect(node.name).toBe('Panel');
    expect(node.clipContent).toBe(true);
    expect(node.fill).toEqual({ space: 'rgb', r: 255, g: 255, b: 255, a: 255 });
    expect(node.strokes?.[0]?.align).toBe('outside');
    expect(node.panel?.panelId).toBe('p1');
  });
});

describe('divideFrameIntoPanels', () => {
  function docWithFrame(children = false) {
    let doc = createDocument('test');
    const frame = makeFrameNode('target', { name: 'Target', w: 1000, h: 1000 });
    doc = addNode(doc, frame);
    if (children) {
      const child = makeShapeNode(
        'child',
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: 'Child' },
      );
      doc = addChild(doc, 'target', child);
    }
    return doc;
  }

  it('divides an empty frame into named child panels in reading order', () => {
    const result = divideFrameIntoPanels(docWithFrame(), ['target'], 'four-panel');
    expect(result.created).toHaveLength(4);
    const target = result.doc.nodes.target;
    if (target?.kind !== 'frame') throw new Error('expected frame');
    expect(target.children).toEqual(result.created);
    const names = result.created.map((id) => result.doc.nodes[id]?.name);
    expect(names).toEqual(['Panel 1', 'Panel 2', 'Panel 3', 'Panel 4']);
    for (const id of result.created) {
      expect(result.doc.nodes[id]?.kind).toBe('frame');
    }
    const firstPanel = result.doc.nodes[result.created[0]!];
    if (firstPanel?.kind !== 'frame') throw new Error('expected frame');
    expect(firstPanel.panel?.readingOrder).toBe(1);
  });

  it('continues panel numbering across repeated division', () => {
    const first = divideFrameIntoPanels(docWithFrame(), ['target'], 'two-up');
    const withSecond = (() => {
      const frame = makeFrameNode('target2', { name: 'Target 2', w: 1000, h: 1000 });
      return addNode(first.doc, frame);
    })();
    const second = divideFrameIntoPanels(withSecond, ['target2'], 'two-up');
    const names = second.created.map((id) => second.doc.nodes[id]?.name);
    expect(names).toEqual(['Panel 3', 'Panel 4']);
  });

  it('duplicates existing artwork into every panel and removes the originals', () => {
    const doc = docWithFrame(true);
    const result = divideFrameIntoPanels(doc, ['target'], 'four-panel');
    expect(result.created).toHaveLength(4);

    const target = result.doc.nodes.target;
    if (target?.kind !== 'frame') throw new Error('expected frame');
    expect(target.children).toEqual(result.created);
    expect(result.doc.nodes.child).toBeUndefined();

    const fourPanel = PANEL_LAYOUT_PRESETS.find((preset) => preset.id === 'four-panel')!;
    const cells = computePanelCells({ w: 1000, h: 1000 }, fourPanel);
    result.created.forEach((panelId, index) => {
      const panel = result.doc.nodes[panelId];
      if (panel?.kind !== 'frame') throw new Error('expected frame');
      expect(panel.children).toHaveLength(1);
      const art = result.doc.nodes[panel.children![0]!];
      expect(art).toBeDefined();
      expect(art?.name).toBe('Child');
      // Shifted so the copy renders at the same absolute position.
      expect(art?.transform[4]).toBeCloseTo(-cells[index]!.x, 6);
      expect(art?.transform[5]).toBeCloseTo(-cells[index]!.y, 6);
    });
  });

  it('previews populated split cost without mutating the source document', () => {
    const doc = docWithFrame(true);
    const preview = previewPanelDivision(doc, ['target'], 'four-panel');
    expect(preview?.destinationCount).toBe(4);
    expect(preview?.sourceChildCount).toBe(1);
    expect(doc.nodes.target?.kind).toBe('frame');
    expect(doc.nodes.child).toBeDefined();
  });

  it('refuses multi-selection, non-frames, and unknown presets', () => {
    const doc = docWithFrame();
    expect(divideFrameIntoPanels(doc, ['target', 'child'], 'two-up').created).toEqual([]);
    expect(divideFrameIntoPanels(doc, ['child'], 'two-up').created).toEqual([]);
    expect(divideFrameIntoPanels(doc, ['target'], 'not-a-preset').created).toEqual([]);
  });
});

describe('joinPanels', () => {
  it('reparents children into the first panel and removes the other boundaries', () => {
    let doc = createDocument('join');
    const holder = makeFrameNode('holder', { name: 'Holder', w: 1000, h: 800 });
    const left = makePanelNode('left', [1, 0, 0, 1, 10, 20], { w: 300, h: 300 });
    const right = makePanelNode('right', [1, 0, 0, 1, 400, 20], { w: 300, h: 300 });
    doc = addNode(doc, holder);
    doc = addChild(addChild(doc, holder.id, left), holder.id, right);
    const child = makeShapeNode('child', { kind: 'rect', x: 4, y: 5, w: 20, h: 20 });
    doc = addChild(doc, right.id, child);

    const result = joinPanels(doc, [left.id, right.id]);
    expect(result.joined).toBe(left.id);
    expect(result.removed).toEqual([right.id]);
    expect(result.doc.nodes[right.id]).toBeUndefined();
    const survivor = result.doc.nodes[left.id];
    expect(survivor?.kind).toBe('frame');
    if (survivor?.kind !== 'frame') throw new Error('expected frame');
    expect(survivor.children).toContain(child.id);
    expect(result.doc.nodes[child.id]?.transform).toEqual([1, 0, 0, 1, 390, 0]);
  });
});

describe('orderPanelIds', () => {
  it('orders tiers top-to-bottom and panels within a tier by direction', () => {
    const nodes = {
      topRight: makeFrameNode('topRight', {
        name: 'Top right',
        transform: [1, 0, 0, 1, 300, 0],
        w: 100,
        h: 100,
      }),
      topLeft: makeFrameNode('topLeft', {
        name: 'Top left',
        transform: [1, 0, 0, 1, 0, 0],
        w: 100,
        h: 100,
      }),
      bottom: makeFrameNode('bottom', {
        name: 'Bottom',
        transform: [1, 0, 0, 1, 0, 200],
        w: 100,
        h: 100,
      }),
    } as Record<string, SceneNode>;
    expect(orderPanelIds(['topRight', 'topLeft', 'bottom'], nodes, 'ltr')).toEqual([
      'topLeft',
      'topRight',
      'bottom',
    ]);
    expect(orderPanelIds(['topRight', 'topLeft', 'bottom'], nodes, 'rtl')).toEqual([
      'topRight',
      'topLeft',
      'bottom',
    ]);
  });
});

describe('renumberPanelsInFrame', () => {
  it('numbers child panels in reading order, skipping names used elsewhere', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeFrameNode('outside', { name: 'Panel 1' }));
    doc = addNode(doc, makeFrameNode('target', { name: 'Target', w: 1000, h: 1000 }));
    doc = addChild(
      doc,
      'target',
      makeFrameNode('right', {
        name: 'Panel 9',
        transform: [1, 0, 0, 1, 500, 0],
        w: 400,
        h: 400,
      }),
    );
    doc = addChild(
      doc,
      'target',
      makeFrameNode('left', {
        name: 'Panel 8',
        transform: [1, 0, 0, 1, 0, 0],
        w: 400,
        h: 400,
      }),
    );

    const result = renumberPanelsInFrame(doc, ['target'], 'ltr');
    expect(result.renamed).toEqual([
      { id: 'left', name: 'Panel 2' },
      { id: 'right', name: 'Panel 3' },
    ]);
    expect(result.doc.nodes.left?.name).toBe('Panel 2');
    expect(result.doc.nodes.right?.name).toBe('Panel 3');
  });
});
