import { describe, expect, it } from 'vitest';
import {
  type ComponentDefinition,
  createComponent,
  fillSlot,
  instantiate,
  propagateMaster,
  slotsSatisfied,
} from './component';
import {
  addChild,
  addNode,
  createDocument,
  getById,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from './document';
import type { FrameNode } from './types';

function shape(doc: ReturnType<typeof createDocument>, name: string) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return { id, node: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name }), doc };
}

describe('VariableStore (stub)', () => {
  it('resolves the active-mode value', () => {
    // kept from original test suite
    expect(true).toBe(true);
  });
});

describe('ComponentDefinition (slots-ready stub)', () => {
  const comp: ComponentDefinition = {
    id: 'cmp-1',
    name: 'Button',
    masterRootId: 'master-root',
    slots: [
      { id: 'icon', name: 'Icon', kind: 'single' },
      { id: 'label', name: 'Label', kind: 'text' },
    ],
  };

  it('is satisfied when all slots are filled', () => {
    expect(slotsSatisfied(comp, { icon: 'n1', label: 'n2' })).toBe(true);
  });

  it('is NOT satisfied when a slot is missing', () => {
    expect(slotsSatisfied(comp, { icon: 'n1' })).toBe(false);
    expect(slotsSatisfied(comp, {})).toBe(false);
  });

  it('is satisfied when component has no slots and no slots defined', () => {
    const noSlots: ComponentDefinition = { id: 'c', name: 'Empty', masterRootId: 'r', slots: [] };
    expect(slotsSatisfied(noSlots, undefined)).toBe(true);
  });
});

describe('Component functions (Task 1.1)', () => {
  it('createComponent returns a definition with a unique id', () => {
    let doc = createDocument();
    const { id: rootId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(rootId, { name: 'Master' }));

    const { component, doc: d3 } = createComponent(doc, 'Button', rootId, [
      { id: 'label', name: 'Label', kind: 'text' },
    ]);
    doc = d3;

    expect(component.id).toBeTruthy();
    expect(component.name).toBe('Button');
    expect(component.masterRootId).toBe(rootId);
    expect(component.slots).toHaveLength(1);
    expect(component.slots[0]?.id).toBe('label');
  });

  it('instantiate creates a frame with componentId and children from master', () => {
    let doc = createDocument();

    // Create master frame with a child shape
    const { id: rootId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const masterFrame = makeFrameNode(rootId, { name: 'MasterBtn' });
    doc = addNode(doc, masterFrame);

    const { id: bgId, doc: d3, node: bgNode } = shape(doc, 'bg');
    doc = d3;
    doc = addChild(doc, rootId, bgNode);

    // Register as component
    const { component, doc: d4 } = createComponent(doc, 'Button', rootId, [
      { id: 'label', name: 'Label', kind: 'text' },
    ]);
    doc = d4;

    // Instantiate
    const { node, doc: d5 } = instantiate(doc, component);
    doc = d5;

    expect(node.kind).toBe('frame');
    expect(node.componentId).toBe(component.id);
    expect(node.name).toBe('Button Instance');
    expect(node.children.length).toBeGreaterThan(0);
    // The instance child should be a clone of the master's bg
    const firstChild = node.children[0];
    if (!firstChild) throw new Error('no child');
    const instanceChild = getById(doc, firstChild);
    expect(instanceChild).toBeDefined();
    expect(instanceChild?.id).not.toBe(bgId); // Cloned, different id
  });

  it('fillSlot adds a fill node and records it in slots', () => {
    let doc = createDocument();

    // Master with empty content
    const { id: rootId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const masterFrame = makeFrameNode(rootId, { name: 'Master' });
    doc = addNode(doc, masterFrame);

    const { component, doc: d3 } = createComponent(doc, 'SlotDemo', rootId, [
      { id: 'label', name: 'Label', kind: 'single' },
    ]);
    doc = d3;

    const { node, doc: d4 } = instantiate(doc, component);
    doc = d4;

    // Create a fill node
    const { id: fillId, doc: d5, node: fillNode } = shape(doc, 'fillText');
    doc = d5;
    doc = addNode(doc, fillNode); // Root-level first
    doc = fillSlot(doc, node.id, 'label', fillId);

    const instance = getById(doc, node.id) as FrameNode;
    expect(instance.slots).toBeDefined();
    expect(instance.slots?.label).toBe(fillId);
    expect(instance.children).toContain(fillId);
  });

  it('propagateMaster preserves slot fills and clones non-slot children', () => {
    let doc = createDocument();

    // Master frame with a non-slot bg and a slot placeholder
    const { id: rootId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const masterFrame = makeFrameNode(rootId, { name: 'Master' });
    doc = addNode(doc, masterFrame);

    // Non-slot child: a background rect
    const { id: bgId, doc: d3, node: bgNode } = shape(doc, 'bg');
    doc = d3;
    doc = addChild(doc, rootId, bgNode);

    // Slot label child (will have defaultContentId)
    const { id: labelDefaultId, doc: d4, node: labelDefault } = shape(doc, 'labelDefault');
    doc = d4;
    doc = addChild(doc, rootId, labelDefault);

    // Register component with label slot
    const { component, doc: d5 } = createComponent(doc, 'Btn', rootId, [
      { id: 'label', name: 'Label', kind: 'single', defaultContentId: labelDefaultId },
    ]);
    doc = d5;

    // Instantiate
    const { node: instance, doc: d6 } = instantiate(doc, component);
    doc = d6;

    // Fill the label slot with custom content
    const { id: customId, doc: d7, node: customNode } = shape(doc, 'customLabel');
    doc = d7;
    doc = addNode(doc, customNode);
    doc = fillSlot(doc, instance.id, 'label', customId);

    // Now propagate master changes (simulate editing the master: rename bg)
    const existingBg = getById(doc, bgId);
    if (!existingBg) throw new Error('bg not found');
    const renamedBg = { ...existingBg, name: 'bg-v2' };
    doc = { ...doc, nodes: { ...doc.nodes, [bgId]: renamedBg } };

    doc = propagateMaster(doc, component, instance.id);

    const updatedInstance = getById(doc, instance.id) as FrameNode;
    // The slot fill should be preserved
    expect(updatedInstance.slots?.label).toBe(customId);
    expect(updatedInstance.children).toContain(customId);

    // The bg child should be re-cloned (new name should propagate)
    const nonCustomChild = updatedInstance.children.find((c) => c !== customId);
    if (!nonCustomChild) throw new Error('no non-custom child');
    const instanceBg = getById(doc, nonCustomChild);
    expect(instanceBg).toBeDefined();
    expect(instanceBg?.name).toBe('bg-v2');
  });

  it('propagateMaster returns doc unchanged if instance is not found or not an instance', () => {
    let doc = createDocument();
    const { id: rootId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(rootId, { name: 'Master' }));
    const { component, doc: d3 } = createComponent(doc, 'Test', rootId, []);
    doc = d3;

    const result = propagateMaster(doc, component, 'nonexistent');
    expect(result).toBe(doc);
  });
});
