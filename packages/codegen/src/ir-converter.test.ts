/**
 * Tests for scene-to-IR converter.
 */

import { createDocument, makeFrameNode, makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { deserializeIR, sceneToIR, serializeIR } from './ir-converter';

describe('sceneToIR', () => {
  it('converts a simple document to IR', () => {
    const doc = createDocument('Test Document');
    const frame = makeFrameNode('frame1', { name: 'Main Frame' });
    const text = makeTextNode('text1', 'Hello World', { fontSize: 16, fontFamily: 'Inter' });

    const frameWithChildren = { ...frame, children: [text.id] };

    const docWithNodes = {
      ...doc,
      nodes: { [frameWithChildren.id]: frameWithChildren, [text.id]: text },
      rootChildren: [frameWithChildren.id],
    };

    const ir = sceneToIR(docWithNodes);

    expect(ir.version).toBe('2.1.0');
    expect(ir.metadata.documentId).toBe(doc.id);
    expect(ir.metadata.name).toBe('Test Document');
    expect(ir.rootIds).toHaveLength(1);
    // IR converter processes children recursively, so we should have at least the root node
    expect(Object.keys(ir.nodes)).toHaveLength(1);
  });

  it('infers semantic roles from node names', () => {
    const doc = createDocument('Test');
    const button = makeFrameNode('btn1', { name: 'Submit Button' });
    const nav = makeFrameNode('nav1', { name: 'Navigation' });

    const docWithNodes = {
      ...doc,
      nodes: { [button.id]: button, [nav.id]: nav },
      rootChildren: [button.id, nav.id],
    };

    const ir = sceneToIR(docWithNodes);

    const buttonNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === 'btn1');
    const navNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === 'nav1');

    // Button pattern should match "button" in name
    expect(buttonNode?.role.primary).toBe('button');
    expect(buttonNode?.role.inferred).toBe(true);
    expect(buttonNode?.role.confidence).toBeGreaterThan(0.5);

    // Navigation pattern should match "nav" in name
    expect(navNode?.role.primary).toBe('navigation');
    expect(navNode?.role.inferred).toBe(true);
  });

  it('generates accessibility metadata', () => {
    const doc = createDocument('Test');
    const button = makeFrameNode('btn1', { name: 'Submit Button' });

    const docWithNodes = {
      ...doc,
      nodes: { [button.id]: button },
      rootChildren: [button.id],
    };

    const ir = sceneToIR(docWithNodes);
    const buttonNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === 'btn1');

    // Button should be inferred from name pattern
    expect(buttonNode?.role.primary).toBe('button');
    expect(buttonNode?.accessibility.role).toBe('button');
    expect(buttonNode?.accessibility.label).toBe('Submit Button');
    expect(buttonNode?.accessibility.focusable).toBe(true);
    expect(buttonNode?.accessibility.keyboardNavigable).toBe(true);
  });

  it('preserves node hierarchy', () => {
    const doc = createDocument('Test');
    const parent = makeFrameNode('parent1', { name: 'Parent' });
    const child1 = makeTextNode('child1', 'Child 1', { fontSize: 16 });
    const child2 = makeTextNode('child2', 'Child 2', { fontSize: 16 });

    const parentWithChildren = { ...parent, children: [child1.id, child2.id] };

    const docWithNodes = {
      ...doc,
      nodes: {
        [parentWithChildren.id]: parentWithChildren,
        [child1.id]: child1,
        [child2.id]: child2,
      },
      rootChildren: [parentWithChildren.id],
    };

    const ir = sceneToIR(docWithNodes);
    const parentNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === 'parent1');

    expect(parentNode?.children).toHaveLength(2);
    expect(parentNode?.children[0]?.metadata.sourceNodeId).toBe('child1');
    expect(parentNode?.children[1]?.metadata.sourceNodeId).toBe('child2');
  });

  it('converts text nodes with typography', () => {
    const doc = createDocument('Test');
    const text = makeTextNode('text1', 'Hello World', {
      fontSize: 24,
      fontFamily: 'Inter',
      fontWeight: 700,
    });

    const docWithNodes = {
      ...doc,
      nodes: { [text.id]: text },
      rootChildren: [text.id],
    };

    const ir = sceneToIR(docWithNodes);
    const textNode = Object.values(ir.nodes).find((n) => n.metadata.sourceNodeId === 'text1');

    expect(textNode?.content.type).toBe('text');
    expect(textNode?.content.text?.value).toBe('Hello World');
    expect(textNode?.appearance.typography.fontSize).toBe(24);
    expect(textNode?.appearance.typography.fontFamily).toBe('Inter');
    expect(textNode?.appearance.typography.fontWeight).toBe(700);
  });
});

describe('serializeIR / deserializeIR', () => {
  it('serializes and deserializes IR correctly', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('frame1', { name: 'Main Frame' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const serialized = serializeIR(ir);
    const deserialized = deserializeIR(serialized);

    expect(deserialized.version).toBe(ir.version);
    expect(deserialized.metadata.documentId).toBe(ir.metadata.documentId);
    expect(deserialized.rootIds).toEqual(ir.rootIds);
    expect(Object.keys(deserialized.nodes)).toHaveLength(Object.keys(ir.nodes).length);
  });

  it('produces valid JSON', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('frame1', { name: 'Main Frame' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);
    const serialized = serializeIR(ir);

    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});

describe('IR validation', () => {
  it('validates IR structure', () => {
    const doc = createDocument('Test');
    const frame = makeFrameNode('frame1', { name: 'Main Frame' });

    const docWithNodes = {
      ...doc,
      nodes: { [frame.id]: frame },
      rootChildren: [frame.id],
    };

    const ir = sceneToIR(docWithNodes);

    // Verify IR structure is valid
    expect(ir.version).toBe('2.1.0');
    expect(ir.metadata.documentId).toBe(doc.id);
    expect(ir.rootIds).toHaveLength(1);
    const rootId = ir.rootIds[0];
    if (rootId) {
      expect(ir.nodes[rootId]).toBeDefined();
    }
    expect(ir.tokens).toBeDefined();
    expect(ir.breakpoints).toBeDefined();
    expect(ir.components).toBeDefined();
  });
});
