/**
 * Tests for the Vue SFC emitter.
 */

import { createDocument, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { exportNodeToVue, vueTargetGaps } from '../vue';

describe('exportNodeToVue', () => {
  it('emits a Vue SFC for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 }, { name: 'Box' });
    const vue = exportNodeToVue(node, doc);
    expect(vue).toContain('<template>');
    expect(vue).toContain('</template>');
    expect(vue).toContain('<style');
    expect(vue).toContain('</style>');
    expect(vue).toContain('width: 200px');
    expect(vue).toContain('height: 100px');
  });

  it('emits text as a span', () => {
    const doc = createDocument('Test');
    const node = makeTextNode('t1', 'Hello Vue', { fontSize: 16, fontFamily: 'Inter' });
    const vue = exportNodeToVue(node, doc);
    expect(vue).toContain('<span');
    expect(vue).toContain('Hello Vue');
    expect(vue).toContain('font-size: 16px');
  });

  it('emits composition API script by default', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' });
    const vue = exportNodeToVue(node, doc);
    expect(vue).toContain('<script setup');
  });

  it('emits options API when useCompositionApi=false', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Rect' });
    const vue = exportNodeToVue(node, doc, { useCompositionApi: false });
    expect(vue).toContain('defineComponent');
    expect(vue).not.toContain('<script setup');
  });
});

describe('vueTargetGaps', () => {
  it('reports gaps for non-rect shapes', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'ellipse', cx: 50, cy: 50, rx: 50, ry: 50 },
      { name: 'Circle' },
    );
    const gaps = vueTargetGaps(node, doc);
    expect(gaps.some((g) => g.feature?.includes('ellipse'))).toBe(true);
  });

  it('no gaps for basic rect', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, { name: 'Box' });
    const gaps = vueTargetGaps(node, doc);
    expect(gaps.length).toBe(0);
  });
});
