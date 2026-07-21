import { describe, it, expect } from 'vitest';
import { createDocument, makeTextNode, addNode } from './document';
import {
  setTextAdaptiveContrast,
  resolveTextColor,
  resolveTextColorWithOverride,
} from './typography';
import type { TextNode, ManagedColor } from './types';

function makeSimpleDoc() {
  let doc = createDocument('Test');
  const color: ManagedColor = { space: 'rgb', r: 255, g: 0, b: 0, a: 255 };
  const node = makeTextNode('t1', 'Hello', {
    name: 'Text',
    fontSize: 16,
    fill: color,
  });
  doc = addNode(doc, node);
  return doc;
}

describe('setTextAdaptiveContrast', () => {
  it('enables adaptive contrast on a text node', () => {
    const doc = makeSimpleDoc();
    const updated = setTextAdaptiveContrast(doc, 't1', {
      enabled: true,
      policy: 'wcag-aa',
    });
    const node = updated.nodes.t1 as TextNode;
    expect(node.adaptiveContrast).toBeDefined();
    expect(node.adaptiveContrast!.enabled).toBe(true);
    expect(node.adaptiveContrast!.policy).toBe('wcag-aa');
  });

  it('disabling clears resolvedColor', () => {
    const doc = makeSimpleDoc();
    const d1 = setTextAdaptiveContrast(doc, 't1', {
      enabled: true,
      policy: 'wcag-aa',
    });
    const d2 = setTextAdaptiveContrast(d1, 't1', {
      enabled: false,
    });
    const node = d2.nodes.t1 as TextNode;
    expect(node.adaptiveContrast!.enabled).toBe(false);
    expect(node.adaptiveContrast!.resolvedColor).toBeUndefined();
  });

  it('stores custom light/dark colors', () => {
    const doc = makeSimpleDoc();
    const updated = setTextAdaptiveContrast(doc, 't1', {
      enabled: true,
      policy: 'custom',
      customRatio: 7,
      lightColor: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      darkColor: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    });
    const node = updated.nodes.t1 as TextNode;
    expect(node.adaptiveContrast!.customRatio).toBe(7);
    expect(node.adaptiveContrast!.lightColor).toBeDefined();
    expect(node.adaptiveContrast!.darkColor).toBeDefined();
  });

  it('stores resolvedColor from engine evaluation', () => {
    const doc = makeSimpleDoc();
    const resolved: ManagedColor = { space: 'rgb', r: 50, g: 50, b: 50, a: 255 };
    let updated = setTextAdaptiveContrast(doc, 't1', {
      enabled: true,
      policy: 'wcag-aa',
    });
    // Simulate engine setting resolvedColor
    const node = updated.nodes.t1 as TextNode;
    updated = {
      ...updated,
      nodes: {
        ...updated.nodes,
        t1: {
          ...node,
          adaptiveContrast: { ...node.adaptiveContrast!, resolvedColor: resolved },
        } as TextNode,
      },
    };
    const n = updated.nodes.t1 as TextNode;
    expect(n.adaptiveContrast!.resolvedColor).toEqual(resolved);
  });

  it('returns doc unchanged for non-text nodes', () => {
    const doc = createDocument('Test');
    const updated = setTextAdaptiveContrast(doc, 'nonexistent', {
      enabled: true,
      policy: 'wcag-aa',
    });
    expect(updated).toBe(doc);
  });
});

describe('resolveTextColor', () => {
  it('returns stored fill when adaptive contrast is disabled', () => {
    const doc = makeSimpleDoc();
    const node = doc.nodes.t1 as TextNode;
    const color = resolveTextColor(node);
    expect(color.space).toBe('rgb');
    expect(color.r).toBe(255);
  });

  it('returns resolvedColor when adaptive contrast is enabled', () => {
    const resolved: ManagedColor = { space: 'rgb', r: 50, g: 50, b: 50, a: 255 };
    const doc = makeSimpleDoc();
    let updated = setTextAdaptiveContrast(doc, 't1', { enabled: true, policy: 'wcag-aa' });
    const node = updated.nodes.t1 as TextNode;
    updated = {
      ...updated,
      nodes: {
        ...updated.nodes,
        t1: {
          ...node,
          adaptiveContrast: { ...node.adaptiveContrast!, resolvedColor: resolved },
        } as TextNode,
      },
    };
    const n = updated.nodes.t1 as TextNode;
    const color = resolveTextColor(n);
    expect(color.r).toBe(50);
  });

  it('returns stored fill when enabled but no resolvedColor', () => {
    const doc = makeSimpleDoc();
    let updated = setTextAdaptiveContrast(doc, 't1', { enabled: true, policy: 'wcag-aa' });
    const node = updated.nodes.t1 as TextNode;
    const color = resolveTextColor(node);
    expect(color.r).toBe(255); // stored fill
  });
});

describe('resolveTextColorWithOverride', () => {
  it('returns override when provided', () => {
    const doc = makeSimpleDoc();
    const node = doc.nodes.t1 as TextNode;
    const override: ManagedColor = { space: 'rgb', r: 100, g: 100, b: 100, a: 255 };
    const color = resolveTextColorWithOverride(node, override);
    expect(color.r).toBe(100);
  });

  it('falls back to resolveTextColor when no override', () => {
    const doc = makeSimpleDoc();
    const node = doc.nodes.t1 as TextNode;
    const color = resolveTextColorWithOverride(node);
    expect(color.r).toBe(255);
  });
});
