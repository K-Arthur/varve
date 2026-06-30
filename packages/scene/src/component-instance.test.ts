/**
 * Tests for component instance operations — swap, reset overrides, detect overrides.
 */
import { describe, expect, it } from 'vitest';
import {
  createComponent,
  createDocument,
  detachInstance,
  instanceOverrides,
  makeFrameNode,
  resetInstanceOverrides,
  swapInstance,
} from '@strata/scene';

describe('component instance operations', () => {
  function setupComponent() {
    let doc = createDocument('Test');
    // Master frame
    const master = makeFrameNode('Master', { x: 0, y: 0, width: 100, height: 100 });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [master.id]: master },
      rootChildren: [master.id],
    };
    // Register component
    doc = createComponent(doc, 'Button', master.id, []);
    const componentId = Object.keys(doc.components)[0]!;
    // Create instance
    const instance = makeFrameNode('Instance', { x: 200, y: 0, width: 100, height: 100 });
    instance.componentId = componentId;
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [instance.id]: instance },
      rootChildren: [...doc.rootChildren, instance.id],
    };
    return { doc, masterId: master.id, instanceId: instance.id, componentId };
  }

  describe('detachInstance', () => {
    it('clears componentId on the instance', () => {
      const { doc, instanceId } = setupComponent();
      const detached = detachInstance(doc, instanceId);
      expect(detached.nodes[instanceId]?.componentId).toBeUndefined();
    });

    it('is a no-op for non-frame nodes', () => {
      const doc = createDocument('Test');
      const result = detachInstance(doc, 'nonexistent');
      expect(result).toBe(doc);
    });
  });

  describe('instanceOverrides', () => {
    it('returns empty array when no overrides', () => {
      const { doc, instanceId } = setupComponent();
      const overrides = instanceOverrides(doc, instanceId);
      expect(overrides).toEqual([]);
    });

    it('detects opacity override', () => {
      const { doc, instanceId } = setupComponent();
      const modified = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [instanceId]: { ...doc.nodes[instanceId]!, opacity: 0.5 },
        },
      };
      const overrides = instanceOverrides(modified, instanceId);
      expect(overrides).toContain('opacity');
    });

    it('detects blendMode override', () => {
      const { doc, instanceId } = setupComponent();
      const modified = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [instanceId]: { ...doc.nodes[instanceId]!, blendMode: 'multiply' as const },
        },
      };
      const overrides = instanceOverrides(modified, instanceId);
      expect(overrides).toContain('blendMode');
    });
  });

  describe('resetInstanceOverrides', () => {
    it('restores opacity from master', () => {
      const { doc, instanceId } = setupComponent();
      const modified = {
        ...doc,
        nodes: {
          ...doc.nodes,
          [instanceId]: { ...doc.nodes[instanceId]!, opacity: 0.3 },
        },
      };
      const reset = resetInstanceOverrides(modified, instanceId);
      expect(reset.nodes[instanceId]?.opacity).toBe(doc.nodes[instanceId]?.opacity);
    });
  });

  describe('swapInstance', () => {
    it('is a no-op for non-frame nodes', () => {
      const doc = createDocument('Test');
      const result = swapInstance(doc, 'nonexistent', 'also-nonexistent');
      expect(result).toBe(doc);
    });
  });
});
