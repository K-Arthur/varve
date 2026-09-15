/**
 * Tests for the enhanced Tailwind emitter.
 */

import { createDocument, makeFrameNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneToIR } from '../ir-converter';
import { exportIrNodeToTailwind, exportIrToTailwind } from '../tailwind';

describe('exportIrToTailwind', () => {
  it('produces a React component with proper imports', () => {
    const doc = createDocument('Test Design');
    const frame = makeFrameNode('f1', { name: 'Container' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToTailwind(ir);

    expect(result).toContain('import React');
    expect(result).toContain('function Design');
    expect(result).toContain('export default Design');
  });

  it('uses semantic Tailwind classes for layout', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'FlexPanel', w: 400, h: 300 });
    const frameWithLayout = {
      ...frame,
      layoutStyle: {
        mode: 'flex' as const,
        wrap: false,
        grow: 0,
        shrink: 0,
        direction: 'column' as const,
        gap: 8,
        padding: [4, 4, 4, 4] as [number, number, number, number],
      },
    };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithLayout.id]: frameWithLayout },
      rootChildren: [frameWithLayout.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToTailwind(ir);

    // Flex layout should produce 'flex' and 'flex-col' classes
    expect(result).toContain('flex');
    expect(result).toContain('flex-col');
    // Width should be present
    expect(result).toMatch(/w-/);
  });

  it('includes text content in the output', () => {
    const doc = createDocument('Test');
    const text = makeTextNode('t1', 'Hello World', { fontSize: 16, fontFamily: 'Inter' });

    const docWithNodes = {
      ...doc,
      nodes: { [text.id]: text },
      rootChildren: [text.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToTailwind(ir);

    expect(result).toContain('Hello World');
  });

  it('generates valid JSX with className', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Root' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const result = exportIrToTailwind(ir);

    expect(result).toContain('className=');
  });
});

describe('exportIrNodeToTailwind', () => {
  it('produces a single JSX element string', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Item', w: 100, h: 50 });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const rootNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === frame.id);
    if (!rootNode) {
      expect(rootNode).toBeDefined();
      return;
    }

    const result = exportIrNodeToTailwind(rootNode, ir);
    expect(result).toContain('className=');
    expect(result).toContain('div');
  });

  it('respects visibility=false nodes', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('f1', { name: 'Root' });
    const child = makeFrameNode('c1', { name: 'Hidden' });
    const hiddenChild = { ...child, visible: false };
    const frameWithChildren = { ...frame, children: [hiddenChild.id] };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithChildren.id]: frameWithChildren, [hiddenChild.id]: hiddenChild },
      rootChildren: [frameWithChildren.id],
    };

    const ir = sceneToIR(docWithNodes);
    const rootNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === frame.id);
    if (!rootNode) {
      expect(rootNode).toBeDefined();
      return;
    }

    // Test exportIrNodeToTailwind on the root IR node
    const result = exportIrNodeToTailwind(rootNode, ir);
    // Hidden child should not appear in output
    expect(result).not.toContain('Hidden');
  });
});
