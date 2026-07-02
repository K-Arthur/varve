/**
 * TDD tests for component properties and variant system.
 *
 * Tests: property creation, variant creation, variant switching,
 * variant resolution, property sets, boolean/text/swap properties.
 */
import { describe, expect, it } from 'vitest';
import {
  addComponentProperty,
  type ComponentDefinition,
  createComponent,
  createPropertySet,
  createVariant,
  getComponentProperties,
  getVariant,
  resolveVariantProperties,
  setVariantForInstance,
} from './component';
import { addNode, createDocument, makeFrameNode, makeShapeNode } from './document';
import type { FrameNode } from './types';

function setupDocWithComponent(): {
  doc: ReturnType<typeof createDocument>;
  component: ComponentDefinition;
} {
  let doc = createDocument('test');
  const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: [] });
  doc = addNode(doc, master);
  const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
  doc = d1;
  return { doc, component };
}

describe('Component Properties', () => {
  it('adds a boolean property to a component', () => {
    const { doc, component } = setupDocWithComponent();
    const result = addComponentProperty(doc, component.id, {
      name: 'Disabled',
      type: 'boolean',
      defaultValue: false,
    });
    expect(result.property.name).toBe('Disabled');
    expect(result.property.type).toBe('boolean');
    expect(result.property.defaultValue).toBe(false);
    expect(result.doc.components[component.id]?.properties).toHaveLength(1);
  });

  it('adds a text property to a component', () => {
    const { doc, component } = setupDocWithComponent();
    const result = addComponentProperty(doc, component.id, {
      name: 'Label',
      type: 'text',
      defaultValue: 'Button',
    });
    expect(result.property.type).toBe('text');
    expect(result.property.defaultValue).toBe('Button');
  });

  it('adds an instance swap property', () => {
    const { doc, component } = setupDocWithComponent();
    const result = addComponentProperty(doc, component.id, {
      name: 'Icon',
      type: 'instanceSwap',
      defaultValue: '',
    });
    expect(result.property.type).toBe('instanceSwap');
  });

  it('returns properties for a component', () => {
    const { doc, component } = setupDocWithComponent();
    const r1 = addComponentProperty(doc, component.id, {
      name: 'Disabled',
      type: 'boolean',
      defaultValue: false,
    });
    const r2 = addComponentProperty(r1.doc, component.id, {
      name: 'Label',
      type: 'text',
      defaultValue: 'Click',
    });
    const props = getComponentProperties(r2.doc, component.id);
    expect(props).toHaveLength(2);
    expect(props[0]?.name).toBe('Disabled');
    expect(props[1]?.name).toBe('Label');
  });
});

describe('Variants', () => {
  it('creates a variant for a component', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    // Add properties first
    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;

    const result = createVariant(doc, component.id, 'Large', { Size: 'lg' });
    expect(result.variant.name).toBe('Large');
    expect(result.variant.propertyValues).toEqual({ Size: 'lg' });
    expect(result.doc.components[component.id]?.variants).toHaveLength(1);
  });

  it('creates multiple variants', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;
    const r2 = addComponentProperty(doc, component.id, {
      name: 'Variant',
      type: 'text',
      defaultValue: 'primary',
    });
    doc = r2.doc;

    const r3 = createVariant(doc, component.id, 'Primary/Large', {
      Size: 'lg',
      Variant: 'primary',
    });
    doc = r3.doc;
    const r4 = createVariant(doc, component.id, 'Secondary/Small', {
      Size: 'sm',
      Variant: 'secondary',
    });

    expect(r4.doc.components[component.id]?.variants).toHaveLength(2);
  });

  it('sets variant on an instance', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;
    const { variant, doc: d2 } = createVariant(doc, component.id, 'Large', { Size: 'lg' });
    doc = d2;

    const instance = makeFrameNode('inst1', {
      name: 'Button Instance',
      w: 120,
      h: 40,
      componentId: component.id,
    });
    doc = addNode(doc, instance);

    doc = setVariantForInstance(doc, 'inst1', variant.id);
    const updated = doc.nodes['inst1'] as FrameNode;
    expect(updated.variant).toBe(variant.id);
  });
});

describe('Variant Resolution', () => {
  it('resolves variant properties for a component', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;
    const r2 = addComponentProperty(doc, component.id, {
      name: 'Disabled',
      type: 'boolean',
      defaultValue: false,
    });
    doc = r2.doc;

    const { variant, doc: d2 } = createVariant(doc, component.id, 'Large', {
      Size: 'lg',
      Disabled: true,
    });
    doc = d2;

    const resolved = resolveVariantProperties(doc, component.id, variant.id);
    expect(resolved).toEqual({ Size: 'lg', Disabled: true });
  });

  it('falls back to defaults for non-overridden properties', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;
    const r2 = addComponentProperty(doc, component.id, {
      name: 'Disabled',
      type: 'boolean',
      defaultValue: false,
    });
    doc = r2.doc;

    // Variant only overrides Size, Disabled should fallback
    const { variant, doc: d2 } = createVariant(doc, component.id, 'Large', { Size: 'lg' });
    doc = d2;

    const resolved = resolveVariantProperties(doc, component.id, variant.id);
    expect(resolved).toEqual({ Size: 'lg', Disabled: false });
  });
});

describe('Property Sets', () => {
  it('creates a property set grouping multiple properties', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40 });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const r1 = addComponentProperty(doc, component.id, {
      name: 'Size',
      type: 'text',
      defaultValue: 'md',
    });
    doc = r1.doc;
    const r2 = addComponentProperty(doc, component.id, {
      name: 'Variant',
      type: 'text',
      defaultValue: 'primary',
    });
    doc = r2.doc;

    const result = createPropertySet(doc, component.id, 'Appearance', ['Size', 'Variant']);
    expect(result.set.name).toBe('Appearance');
    expect(result.set.propertyNames).toEqual(['Size', 'Variant']);
  });
});
