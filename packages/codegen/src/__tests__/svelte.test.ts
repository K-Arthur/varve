/**
 * Tests for the Svelte component emitter.
 */

import { createDocument, makeShapeNode, makeTextNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToSvelte, svelteTargetGaps } from '../svelte';

describe('exportNodeToSvelte', () => {
  it('emits a Svelte component for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const svelte = exportNodeToSvelte(node, doc);
    expect(svelte).toContain('<script');
    expect(svelte).toContain('</script>');
    expect(svelte).toContain('<style>');
    expect(svelte).toContain('</style>');
    expect(svelte).toContain('left: 0px');
    expect(svelte).toContain('width: 200px');
  });

  it('emits text as a styled span', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Hello Svelte', { fontSize: 20, fontFamily: 'Inter' });
    const svelte = exportNodeToSvelte(node, doc);
    expect(svelte).toContain('<span');
    expect(svelte).toContain('Hello Svelte');
    expect(svelte).toContain('font-size: 20px');
  });

  it('uses $props runes syntax by default', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' });
    const svelte = exportNodeToSvelte(node, doc);
    expect(svelte).toContain('$props()');
    expect(svelte).not.toContain('export let');
  });
});

describe('svelteTargetGaps', () => {
  it('reports gaps for non-rect shapes', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'circle', cx: 50, cy: 50, r: 30 }, { name: 'Circle' });
    const gaps = svelteTargetGaps(node, doc);
    expect(gaps.some((g) => g.feature?.includes('circle'))).toBe(true);
  });

  it('no gaps for basic rect', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const gaps = svelteTargetGaps(node, doc);
    expect(gaps.length).toBe(0);
  });
});
