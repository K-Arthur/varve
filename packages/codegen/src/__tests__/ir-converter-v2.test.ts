/**
 * Tests for IR v2.1 enhancements — flattening info, adjustment scope,
 * responsive inference, HTML hints, fidelity warnings.
 */

import {
  createDocument,
  makeAdjustmentNode,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { sceneToIR } from '../ir-converter';

describe('IR v2.1 — flattening info', () => {
  it('adds flattening info to every node', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Frame' });
    const text = makeTextNode('t1', 'Hello', { fontSize: 16 });
    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame, [text.id]: text },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    expect(ir.version).toBe('2.1.0');

    const frameNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === frame.id);
    expect(frameNode?.flattening).toBeDefined();
    expect(frameNode?.flattening?.mustFlatten).toBe(false);
    expect(frameNode?.flattening?.emitAs).toBe('native');
  });

  it('marks non-rect shapes as needing flattening', () => {
    const doc = createDocument('Test');
    const ellipse = makeShapeNode('e1', { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 });
    const cleanEllipse = { ...ellipse, fills: [], strokes: [], effects: [] };

    const docWithNodes = {
      ...doc,
      nodes: { [cleanEllipse.id]: cleanEllipse },
      rootChildren: [cleanEllipse.id],
    };

    const ir = sceneToIR(docWithNodes);
    const ellipseNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === ellipse.id);
    expect(ellipseNode?.flattening?.mustFlatten).toBe(true);
    expect(ellipseNode?.flattening?.reasons).toContain('non-rect-shape');
    expect(ellipseNode?.flattening?.emitAs).toBe('image');
  });

  it('marks adjustment layers', () => {
    const doc = createDocument('Test');
    const adj = makeAdjustmentNode(
      'adj1',
      'curves',
      {
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      { name: 'Curves' },
    );
    const adjWithAdjustments = {
      ...adj,
      adjustments: [
        {
          type: 'curves' as const,
          points: [
            [0, 0],
            [1, 1],
          ],
          visible: true,
          opacity: 1,
        },
      ],
    };

    const docWithNodes = {
      ...doc,
      nodes: { [adjWithAdjustments.id]: adjWithAdjustments },
      rootChildren: [adjWithAdjustments.id],
    };

    const ir = sceneToIR(docWithNodes);
    const adjNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === adj.id);
    expect(adjNode?.flattening?.mustFlatten).toBe(true);
    expect(adjNode?.flattening?.reasons).toContain('adjustment-layer');
  });

  it('marks nodes with inner shadow for flattening', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Shadow Frame' });
    const frameWithEffects = {
      ...frame,
      fills: [],
      effects: [
        {
          type: 'innerShadow' as const,
          offsetX: 0,
          offsetY: 2,
          radius: 4,
          color: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 128 },
        },
      ],
    };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithEffects.id]: frameWithEffects },
      rootChildren: [frameWithEffects.id],
    };

    const ir = sceneToIR(docWithNodes);
    const node = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === frame.id);
    expect(node?.flattening?.mustFlatten).toBe(true);
    expect(node?.flattening?.reasons).toContain('inner-shadow');
  });
});

describe('IR v2.1 — HTML element hints', () => {
  it('suggests semantic HTML elements based on role', () => {
    const doc = createDocument('Test');
    const button = makeFrameNode('b1', { name: 'Submit Button' });
    const header = makeFrameNode('h1', { name: 'Header' });

    const docWithNodes = {
      ...doc,
      nodes: { [button.id]: button, [header.id]: header },
      rootChildren: [button.id, header.id],
    };

    const ir = sceneToIR(docWithNodes);
    expect(ir.htmlHints).toBeDefined();

    const buttonNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === button.id);
    expect(buttonNode?.role.primary).toBe('button');
    expect(ir.htmlHints[buttonNode?.id ?? '']).toBe('button');

    const headerNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === header.id);
    expect(headerNode?.role.primary).toBe('header');
    expect(ir.htmlHints[headerNode?.id ?? '']).toBe('header');
  });

  it('suggests p for long text', () => {
    const doc = createDocument('Test');
    const longText = makeTextNode('lt1', 'A'.repeat(120), { fontSize: 14 });

    const docWithNodes = {
      ...doc,
      nodes: { [longText.id]: longText },
      rootChildren: [longText.id],
    };

    const ir = sceneToIR(docWithNodes);
    const textNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === longText.id);
    const hint = ir.htmlHints[textNode?.id ?? ''];
    expect(hint).toBe('p');
  });

  it('suggests h2 for large text', () => {
    const doc = createDocument('Test');
    const largeText = makeTextNode('lt2', 'Heading', { fontSize: 24, fontWeight: 700 });

    const docWithNodes = {
      ...doc,
      nodes: { [largeText.id]: largeText },
      rootChildren: [largeText.id],
    };

    const ir = sceneToIR(docWithNodes);
    const textNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === largeText.id);
    const hint = ir.htmlHints[textNode?.id ?? ''];
    expect(hint).toBe('h2');
  });
});

describe('IR v2.1 — fidelity warnings', () => {
  it('collects warnings for nodes with complex effects', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Glass' });
    const frameWithEffects = {
      ...frame,
      fills: [],
      effects: [
        {
          type: 'glassMaterial' as const,
          tint: '#fff',
          blurRadius: 10,
          saturation: 1.0,
          brightness: 1.0,
          noise: 0.02,
        },
      ],
    };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithEffects.id]: frameWithEffects },
      rootChildren: [frameWithEffects.id],
    };

    const ir = sceneToIR(docWithNodes);
    expect(ir.fidelityWarnings.length).toBeGreaterThan(0);
    expect(ir.fidelityWarnings.some((w) => w.category === 'effect')).toBe(true);
  });
});

describe('IR v2.1 — responsive inference', () => {
  it('generates fidelity warnings even for simple documents', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Simple', w: 400, h: 60 });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    expect(ir.fidelityWarnings).toBeDefined();
    expect(ir.version).toBe('2.1.0');
  });
});

describe('IR v2.1 — adjustment scope', () => {
  it('detects adjustment scope', () => {
    const doc = createDocument('Test');
    const adj = makeAdjustmentNode('adj1', 'brightness', { value: 1.2 }, { name: 'Brightness' });

    const docWithNodes = {
      ...doc,
      nodes: { [adj.id]: adj },
      rootChildren: [adj.id],
    };

    const ir = sceneToIR(docWithNodes);
    const adjNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === adj.id);
    expect(adjNode?.adjustmentScope).toBeDefined();
  });
});
