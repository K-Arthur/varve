import { describe, expect, it } from 'vitest';
import type { ManagedColor } from '../colorManagement';
import { createComponent } from '../component';
import { addNode, createDocument, makeFrameNode } from '../document';
import {
  getInstanceStatus,
  hasInstanceOverrides,
  pushMasterChanges,
  syncAllInstances,
  syncInstance,
} from '../component-sync';
import type { Document } from '../document';
import type { ComponentDefinition, FrameNode } from '../types';

function rgb(r: number, g: number, b: number): ManagedColor {
  return { space: 'rgb', r, g, b, a: 255 };
}

function setupComponentWithInstance(): {
  doc: Document;
  component: ComponentDefinition;
  master: FrameNode;
  instance: FrameNode;
  instanceId: string;
  componentId: string;
} {
  let doc = createDocument('test', true);
  const masterId = 'm1';
  const master = makeFrameNode(masterId, {
    name: 'Button',
    w: 120,
    h: 40,
    fill: rgb(0, 100, 200),
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    strokes: [],
    effects: [],
    clipContent: true,
  });
  doc = addNode(doc, master);
  const { component, doc: doc2 } = createComponent(doc, 'Button', masterId, []);
  doc = doc2;
  const componentId = component.id;

  const instanceId = 'inst1';
  const instance = makeFrameNode(instanceId, {
    name: 'Button Instance',
    componentId,
    fill: rgb(0, 100, 200),
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    strokes: [],
    effects: [],
    clipContent: true,
    w: 120,
    h: 40,
  });
  doc = addNode(doc, instance);

  return { doc, component, master, instance, instanceId, componentId };
}

describe('getInstanceStatus', () => {
  it("returns 'broken' for non-existent componentId", () => {
    const doc = createDocument('test', true);
    const instance = makeFrameNode('inst1', {
      name: 'Instance',
      componentId: 'nonexistent',
    });
    const d = addNode(doc, instance);
    expect(getInstanceStatus(d, 'inst1')).toBe('broken');
  });

  it("returns 'broken' for non-frame nodes", () => {
    const doc = createDocument('test', true);
    expect(getInstanceStatus(doc, 'nonexistent')).toBe('broken');
  });

  it("returns 'synced' for instance matching master", () => {
    const { doc, instanceId } = setupComponentWithInstance();
    expect(getInstanceStatus(doc, instanceId)).toBe('synced');
  });

  it("returns 'overridden' for instance with local changes", () => {
    const { doc, instanceId } = setupComponentWithInstance();
    const instance = doc.nodes[instanceId] as FrameNode;
    const d = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [instanceId]: {
          ...instance,
          opacity: 0.5,
        } as FrameNode,
      },
    };
    expect(getInstanceStatus(d, instanceId)).toBe('overridden');
  });
});

describe('hasInstanceOverrides', () => {
  it('returns false for instance matching master', () => {
    const { doc, instanceId } = setupComponentWithInstance();
    expect(hasInstanceOverrides(doc, instanceId)).toBe(false);
  });

  it('returns true when instance differs from master', () => {
    const { doc, instanceId } = setupComponentWithInstance();
    const instance = doc.nodes[instanceId] as FrameNode;
    const d = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [instanceId]: {
          ...instance,
          rotation: 45,
        } as FrameNode,
      },
    };
    expect(hasInstanceOverrides(d, instanceId)).toBe(true);
  });

  it('returns false for non-instance frames', () => {
    const doc = createDocument('test', true);
    const plain = makeFrameNode('f1', { name: 'Plain' });
    const d = addNode(doc, plain);
    expect(hasInstanceOverrides(d, 'f1')).toBe(false);
  });
});

describe('syncInstance', () => {
  it('preserves matching properties and returns overridden status when master changed', () => {
    const { doc, instanceId, master } = setupComponentWithInstance();

    const changedMaster: FrameNode = { ...master, fill: rgb(255, 0, 0), w: 200, h: 80 };
    const d0 = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [master.id]: changedMaster,
      },
    };

    const { doc: d1, status } = syncInstance(d0, instanceId);
    const result = d1.nodes[instanceId] as FrameNode;

    expect(status).toBe('overridden');
    expect(result.fill).toEqual(doc.nodes['inst1']!.fill);
    expect(result.w).toBe(120);
    expect(result.h).toBe(40);
  });

  it('preserves local overrides when instance differs from master', () => {
    const { doc, instanceId, master } = setupComponentWithInstance();

    const instance = doc.nodes[instanceId] as FrameNode;
    const overriddenOpacity = 0.3;
    const overriddenRotation = 90;
    const d0 = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [instanceId]: {
          ...instance,
          opacity: overriddenOpacity,
          rotation: overriddenRotation,
        } as FrameNode,
      },
    };

    const changedMaster: FrameNode = {
      ...master,
      fill: rgb(255, 0, 0),
      opacity: 0.8,
      rotation: 15,
    };
    const d1 = {
      ...d0,
      nodes: {
        ...d0.nodes,
        [master.id]: changedMaster,
      },
    };

    const { doc: d2, status } = syncInstance(d1, instanceId);
    const result = d2.nodes[instanceId] as FrameNode;

    expect(status).toBe('overridden');
    expect(result.opacity).toBe(overriddenOpacity);
    expect(result.rotation).toBe(overriddenRotation);
    expect(result.fill).toEqual(d0.nodes[instanceId]!.fill);
  });

  it("returns 'broken' for instance without component", () => {
    const doc = createDocument('test', true);
    const plain = makeFrameNode('f1');
    const d = addNode(doc, plain);
    const { status } = syncInstance(d, 'f1');
    expect(status).toBe('broken');
  });
});

describe('pushMasterChanges', () => {
  it('updates all instances of a component', () => {
    let { doc, componentId, master } = setupComponentWithInstance();

    const instance2Id = 'inst2';
    const instance2 = makeFrameNode(instance2Id, {
      name: 'Button 2',
      componentId,
      fill: rgb(0, 100, 200),
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
      clipContent: true,
      w: 120,
      h: 40,
    });
    doc = addNode(doc, instance2);

    const changedMaster: FrameNode = { ...master, fill: rgb(0, 200, 100) };
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [master.id]: changedMaster,
      },
    };

    const { result } = pushMasterChanges(doc, componentId);

    expect(result.updatedInstances).toHaveLength(2);
    expect(result.updatedInstances).toContain('inst1');
    expect(result.updatedInstances).toContain('inst2');
  });

  it('returns updated instance count', () => {
    const { doc, componentId, master } = setupComponentWithInstance();

    const changedMaster: FrameNode = { ...master, w: 300 };
    const d = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [master.id]: changedMaster,
      },
    };

    const { result } = pushMasterChanges(d, componentId);
    expect(result.updatedInstances).toHaveLength(1);
  });

  it('handles component without instances', () => {
    let doc = createDocument('test', true);
    const master = makeFrameNode('m1', { name: 'Master' });
    doc = addNode(doc, master);
    const { component, doc: doc2 } = createComponent(doc, 'Empty', 'm1', []);
    doc = doc2;

    const { result } = pushMasterChanges(doc, component.id);
    expect(result.updatedInstances).toHaveLength(0);
  });

  it('preserves overrides and updates non-overridden properties', () => {
    let { doc, componentId, master } = setupComponentWithInstance();

    const instance = doc.nodes['inst1'] as FrameNode;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        ['inst1']: { ...instance, rotation: 90, blendMode: 'screen' } as FrameNode,
      },
    };

    const instance2Id = 'inst2';
    const instance2 = makeFrameNode(instance2Id, {
      name: 'Button 2',
      componentId,
      fill: rgb(0, 100, 200),
      opacity: 0.7,
      blendMode: 'normal',
      rotation: 0,
      strokes: [],
      effects: [],
      clipContent: true,
      w: 120,
      h: 40,
    });
    doc = addNode(doc, instance2);

    const changedMaster: FrameNode = { ...master, fill: rgb(255, 50, 50), rotation: 0 };
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [master.id]: changedMaster,
      },
    };

    const { doc: resultDoc, result } = pushMasterChanges(doc, componentId);
    expect(result.updatedInstances).toHaveLength(2);

    const inst1Result = resultDoc.nodes['inst1'] as FrameNode;
    expect(inst1Result.rotation).toBe(90);
    expect(inst1Result.blendMode).toBe('screen');

    const inst2Result = resultDoc.nodes['inst2'] as FrameNode;
    expect(inst2Result.opacity).toBe(0.7);
  });
});

describe('syncAllInstances', () => {
  it('syncs all instances of all components', () => {
    let doc = createDocument('test', true);

    const m1 = makeFrameNode('m1', { name: 'Comp1', w: 100, h: 50, fill: rgb(0, 100, 200) });
    doc = addNode(doc, m1);
    const { component: c1, doc: docC1 } = createComponent(doc, 'Comp1', 'm1', []);
    doc = docC1;

    const m2 = makeFrameNode('m2', { name: 'Comp2', w: 200, h: 100, fill: rgb(200, 50, 0) });
    doc = addNode(doc, m2);
    const { component: c2, doc: docC2 } = createComponent(doc, 'Comp2', 'm2', []);
    doc = docC2;

    const i1 = makeFrameNode('i1', {
      name: 'I1',
      componentId: c1.id,
      fill: rgb(0, 100, 200),
      w: 100,
      h: 50,
    });
    doc = addNode(doc, i1);
    const i2 = makeFrameNode('i2', {
      name: 'I2',
      componentId: c2.id,
      fill: rgb(200, 50, 0),
      w: 200,
      h: 100,
    });
    doc = addNode(doc, i2);

    const c1Master = doc.nodes['m1'] as FrameNode;
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        ['m1']: { ...c1Master, fill: rgb(0, 200, 100) },
      },
    };

    const { result } = syncAllInstances(doc);

    expect(result.updatedInstances).toHaveLength(2);
    expect(result.updatedInstances).toContain('i1');
    expect(result.updatedInstances).toContain('i2');
  });

  it('handles broken references gracefully', () => {
    let doc = createDocument('test', true);
    const master = makeFrameNode('m1', { name: 'Comp' });
    doc = addNode(doc, master);
    const { component, doc: doc2 } = createComponent(doc, 'Comp', 'm1', []);
    doc = doc2;

    const bad = makeFrameNode('bad1', {
      name: 'Broken',
      componentId: 'nonexistent',
    });
    doc = addNode(doc, bad);

    const good = makeFrameNode('good1', {
      name: 'Good',
      componentId: component.id,
      fill: master.fill,
      opacity: master.opacity,
      blendMode: master.blendMode,
      rotation: master.rotation,
      strokes: master.strokes,
      effects: master.effects,
    });
    doc = addNode(doc, good);

    const { result } = syncAllInstances(doc);
    expect(result.updatedInstances).toHaveLength(1);
    expect(result.updatedInstances).toContain('good1');
  });
});
