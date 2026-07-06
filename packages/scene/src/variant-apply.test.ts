import { describe, expect, it } from 'vitest';
import { addComponentProperty, createComponent, createVariant } from './component';
import { addNode, createDocument, makeFrameNode, makeTextNode } from './document';
import { buildAllVariantCaches, buildVariantEffectiveNodes } from './variant-apply';

describe('variant-apply', () => {
  it('applies boolean variant property to matching layer visibility', () => {
    let doc = createDocument('test');
    const icon = makeFrameNode('icon1', { name: 'Icon', w: 16, h: 16, children: [] });
    doc = addNode(doc, icon);
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: ['icon1'] });
    doc = addNode(doc, master);

    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;
    const { doc: d2 } = addComponentProperty(doc, component.id, {
      name: 'Icon',
      type: 'boolean',
      defaultValue: true,
    });
    doc = d2;

    const { variant, doc: d3 } = createVariant(doc, component.id, 'Hidden Icon', { Icon: false });
    doc = d3;

    const instance = makeFrameNode('inst1', {
      name: 'Button Instance',
      w: 120,
      h: 40,
      componentId: component.id,
      variant: variant.id,
      children: ['icon1'],
    });
    doc = addNode(doc, instance);

    const cache = buildVariantEffectiveNodes(doc, 'inst1');
    expect(cache.get('icon1')?.visible).toBe(false);
  });

  it('applies text variant property to matching text layer', () => {
    let doc = createDocument('test');
    const label = makeTextNode('label1', 'Old', { name: 'Label' });
    doc = addNode(doc, label);
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: ['label1'] });
    doc = addNode(doc, master);

    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;
    const { doc: d2 } = addComponentProperty(doc, component.id, {
      name: 'Label',
      type: 'text',
      defaultValue: 'Click',
    });
    doc = d2;

    const { variant, doc: d3 } = createVariant(doc, component.id, 'Submit', { Label: 'Submit' });
    doc = d3;

    const instance = makeFrameNode('inst1', {
      name: 'Button Instance',
      w: 120,
      h: 40,
      componentId: component.id,
      variant: variant.id,
      children: ['label1'],
    });
    doc = addNode(doc, instance);

    const cache = buildAllVariantCaches(doc);
    const instCache = cache.get('inst1');
    expect(instCache?.get('label1')?.kind).toBe('text');
    if (instCache?.get('label1')?.kind === 'text') {
      expect(instCache.get('label1')!.text).toBe('Submit');
    }
  });
});
