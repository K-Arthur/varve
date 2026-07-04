/**
 * TDD tests for VariantBox — floating variant switcher.
 *
 * Tests: rendering variant name, property controls (boolean/text/instanceSwap),
 * switching variants, creating variants, edge cases (no variants, no properties).
 */
import '@testing-library/jest-dom/vitest';
import type { Document, NodeId } from '@strata/scene';
import {
  addComponentProperty,
  addNode,
  createComponent,
  createDocument,
  createVariant,
  makeFrameNode,
} from '@strata/scene';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VariantBox } from './VariantBox';

afterEach(cleanup);

function setupDocWithVariant(): {
  doc: Document;
  instanceId: NodeId;
  textPropId: string;
  boolPropId: string;
  variantId: string;
} {
  let doc = createDocument('test');
  const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: [] });
  doc = addNode(doc, master);
  const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
  doc = d1;

  const r1 = addComponentProperty(doc, component.id, {
    name: 'Label',
    type: 'text',
    defaultValue: 'Click',
  });
  doc = r1.doc;
  const boolPropId = r1.property.id;
  const r2 = addComponentProperty(doc, component.id, {
    name: 'Disabled',
    type: 'boolean',
    defaultValue: false,
  });
  doc = r2.doc;
  const textPropId = r2.property.id;

  const { variant, doc: d3 } = createVariant(doc, component.id, 'Primary', {
    Label: 'Submit',
    Disabled: false,
  });
  doc = d3;

  const instance = makeFrameNode('inst1', {
    name: 'Button Instance',
    w: 120,
    h: 40,
    componentId: component.id,
    variant: variant.id,
  });
  doc = addNode(doc, instance);

  return { doc, instanceId: 'inst1', textPropId, boolPropId, variantId: variant.id };
}

describe('VariantBox', () => {
  it('renders the active variant name', () => {
    const { doc, instanceId } = setupDocWithVariant();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('renders "No Variants" when component has no variants', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: [] });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const instance = makeFrameNode('inst1', {
      name: 'Button Instance',
      w: 120,
      h: 40,
      componentId: component.id,
    });
    doc = addNode(doc, instance);

    render(
      <VariantBox
        nodeId="inst1"
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('No Variants')).toBeInTheDocument();
  });

  it('renders all variants as selectable options', () => {
    const { doc, instanceId } = setupDocWithVariant();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });

  it('calls onSetVariant when a different variant is selected', () => {
    const { doc, instanceId } = setupDocWithVariant();
    const onSetVariant = vi.fn();

    // Add a second variant to allow switching
    let d = doc;
    const instance = d.nodes[instanceId];
    if (instance?.kind === 'frame' && instance.componentId) {
      const r = createVariant(d, instance.componentId, 'Secondary', {
        Label: 'Cancel',
        Disabled: true,
      });
      d = r.doc;
    }

    render(
      <VariantBox
        nodeId={instanceId}
        document={d}
        onSetVariant={onSetVariant}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    // Click the secondary variant
    fireEvent.click(screen.getByText('Secondary'));
    expect(onSetVariant).toHaveBeenCalledWith(instanceId, expect.any(String));
  });

  it('shows boolean property as toggle button', () => {
    const { doc, instanceId } = setupDocWithVariant();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Disabled: false')).toBeInTheDocument();
  });

  it('shows text property as input', () => {
    const { doc, instanceId } = setupDocWithVariant();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Label') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Submit');
  });

  it('renders create variant button', () => {
    const { doc, instanceId } = setupDocWithVariant();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Create variant')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const { doc, instanceId } = setupDocWithVariant();
    const onClose = vi.fn();
    render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close variant panel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('positions near the screen bounds top-right', () => {
    const { doc, instanceId } = setupDocWithVariant();
    const { container } = render(
      <VariantBox
        nodeId={instanceId}
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.style.left).toBe('328px');
    expect(el.style.top).toBe('100px');
  });

  it('handles no properties gracefully', () => {
    let doc = createDocument('test');
    const master = makeFrameNode('m1', { name: 'Button', w: 120, h: 40, children: [] });
    doc = addNode(doc, master);
    const { component, doc: d1 } = createComponent(doc, 'Button', 'm1', []);
    doc = d1;

    const { variant, doc: d2 } = createVariant(doc, component.id, 'Primary', {});
    doc = d2;

    const instance = makeFrameNode('inst1', {
      name: 'Button Instance',
      w: 120,
      h: 40,
      componentId: component.id,
      variant: variant.id,
    });
    doc = addNode(doc, instance);

    render(
      <VariantBox
        nodeId="inst1"
        document={doc}
        onSetVariant={vi.fn()}
        screenBounds={{ x: 200, y: 100, w: 120, h: 40 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Primary')).toBeInTheDocument();
  });
});
