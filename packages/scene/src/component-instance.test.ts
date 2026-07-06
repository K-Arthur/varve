/**
 * Tests for component instance operations — swap, reset overrides, detect overrides.
 */
import {
  captureSyncBaseline,
  createComponent,
  createDocument,
  type Document,
  detachInstance,
  instanceOverrides,
  makeFrameNode,
  nextNodeId,
  resetInstanceOverrides,
  swapInstance,
  type FrameNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

describe('component instance operations', () => {
  function setupComponent() {
    let doc = createDocument('Test');
    const masterResult = nextNodeId(doc);
    doc = masterResult.doc;
    const masterId = masterResult.id;
    const master = makeFrameNode(masterId, { name: 'Master' });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [masterId]: master },
      rootChildren: [masterId],
    };
    const result = createComponent(doc, 'Button', masterId, []);
    doc = result.doc;
    const componentId = result.component.id;
    const instanceResult = nextNodeId(doc);
    doc = instanceResult.doc;
    const instanceId = instanceResult.id;
    const masterFrame = doc.nodes[masterId] as FrameNode;
    const instance = makeFrameNode(instanceId, {
      name: 'Instance',
      componentId,
      syncBaseline: captureSyncBaseline(masterFrame),
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [instanceId]: instance },
      rootChildren: [...doc.rootChildren, instanceId],
    };
    return { doc, masterId, instanceId, componentId };
  }

  function withModifiedInstance(
    doc: Document,
    instanceId: string,
    patch: Record<string, unknown>,
  ): Document {
    const node = doc.nodes[instanceId];
    if (!node) return doc;
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [instanceId]: { ...node, ...patch } as typeof node,
      },
    };
  }

  describe('detachInstance', () => {
    it('clears componentId on the instance', () => {
      const { doc, instanceId } = setupComponent();
      const detached = detachInstance(doc, instanceId);
      expect((detached.nodes[instanceId] as { componentId?: string })?.componentId).toBeUndefined();
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
      const modified = withModifiedInstance(doc, instanceId, { opacity: 0.5 });
      const overrides = instanceOverrides(modified, instanceId);
      expect(overrides).toContain('opacity');
    });

    it('detects blendMode override', () => {
      const { doc, instanceId } = setupComponent();
      const modified = withModifiedInstance(doc, instanceId, { blendMode: 'multiply' });
      const overrides = instanceOverrides(modified, instanceId);
      expect(overrides).toContain('blendMode');
    });
  });

  describe('resetInstanceOverrides', () => {
    it('restores opacity from master', () => {
      const { doc, instanceId } = setupComponent();
      const masterOpacity = doc.nodes[instanceId]?.opacity;
      const modified = withModifiedInstance(doc, instanceId, { opacity: 0.3 });
      const reset = resetInstanceOverrides(modified, instanceId);
      expect(reset.nodes[instanceId]?.opacity).toBe(masterOpacity);
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
