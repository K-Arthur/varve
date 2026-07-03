import { describe, expect, it } from 'vitest';
import {
  addConnection,
  createFlowData,
  findEntryPoint,
  findOrphanNodes,
  findPath,
  getAllReachable,
  getIncomingConnections,
  getOutgoingConnections,
  removeConnection,
  resolveEntryPoint,
} from './navigation';
import type { FlowConnection } from './types';

describe('Navigation / Flow Graph', () => {
  describe('createFlowData', () => {
    it('creates empty flow data with no connections', () => {
      const flow = createFlowData(['screen-1', 'screen-2']);
      expect(flow.nodes).toEqual(['screen-1', 'screen-2']);
      expect(flow.connections).toEqual([]);
    });

    it('creates flow data with initial connections', () => {
      const connections: FlowConnection[] = [
        {
          id: 'conn-1',
          sourceNodeId: 'screen-1',
          targetNodeId: 'screen-2',
          interactionId: 'interact-1',
        },
      ];
      const flow = createFlowData(['screen-1', 'screen-2'], connections);
      expect(flow.connections).toHaveLength(1);
      expect(flow.connections[0]?.sourceNodeId).toBe('screen-1');
    });

    it('creates flow data with empty node list', () => {
      const flow = createFlowData([], []);
      expect(flow.nodes).toEqual([]);
      expect(flow.connections).toEqual([]);
    });
  });

  describe('addConnection', () => {
    it('adds a connection between nodes', () => {
      const flow = createFlowData(['screen-1', 'screen-2']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      expect(flow.connections).toHaveLength(1);
      expect(flow.connections[0]?.sourceNodeId).toBe('screen-1');
      expect(flow.connections[0]?.targetNodeId).toBe('screen-2');
      expect(flow.connections[0]?.interactionId).toBe('interact-1');
    });

    it('assigns a unique id to each connection', () => {
      const flow = createFlowData(['screen-1', 'screen-2', 'screen-3']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      addConnection(flow, 'screen-1', 'screen-3', 'interact-2');
      expect(flow.connections[0]?.id).not.toBe(flow.connections[1]?.id);
    });

    it('allows multiple connections from the same source', () => {
      const flow = createFlowData(['screen-1', 'screen-2', 'screen-3']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      addConnection(flow, 'screen-1', 'screen-3', 'interact-2');
      expect(flow.connections).toHaveLength(2);
    });
  });

  describe('removeConnection', () => {
    it('removes a connection by id', () => {
      const flow = createFlowData(['screen-1', 'screen-2']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      const connId = flow.connections[0]?.id ?? '';
      removeConnection(flow, connId);
      expect(flow.connections).toHaveLength(0);
    });

    it('does nothing when connection id does not exist', () => {
      const flow = createFlowData(['screen-1', 'screen-2']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      removeConnection(flow, 'non-existent-id');
      expect(flow.connections).toHaveLength(1);
    });
  });

  describe('getOutgoingConnections', () => {
    it('returns connections originating from a node', () => {
      const flow = createFlowData(['screen-1', 'screen-2', 'screen-3']);
      addConnection(flow, 'screen-1', 'screen-2', 'interact-1');
      addConnection(flow, 'screen-1', 'screen-3', 'interact-2');
      addConnection(flow, 'screen-2', 'screen-3', 'interact-3');
      const outgoing = getOutgoingConnections(flow, 'screen-1');
      expect(outgoing).toHaveLength(2);
      expect(outgoing.every((c) => c.sourceNodeId === 'screen-1')).toBe(true);
    });

    it('returns empty array for node with no outgoing connections', () => {
      const flow = createFlowData(['screen-1']);
      expect(getOutgoingConnections(flow, 'screen-1')).toEqual([]);
    });
  });

  describe('getIncomingConnections', () => {
    it('returns connections targeting a node', () => {
      const flow = createFlowData(['screen-1', 'screen-2', 'screen-3']);
      addConnection(flow, 'screen-1', 'screen-3', 'interact-1');
      addConnection(flow, 'screen-2', 'screen-3', 'interact-2');
      const incoming = getIncomingConnections(flow, 'screen-3');
      expect(incoming).toHaveLength(2);
      expect(incoming.every((c) => c.targetNodeId === 'screen-3')).toBe(true);
    });

    it('returns empty array for node with no incoming connections', () => {
      const flow = createFlowData(['screen-1']);
      expect(getIncomingConnections(flow, 'screen-1')).toEqual([]);
    });
  });

  describe('findPath (BFS shortest path)', () => {
    it('finds direct path between connected nodes', () => {
      const flow = createFlowData(['a', 'b']);
      addConnection(flow, 'a', 'b', 'i1');
      const path = findPath(flow, 'a', 'b');
      expect(path).toEqual(['a', 'b']);
    });

    it('finds path through intermediate nodes', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      addConnection(flow, 'a', 'b', 'i1');
      addConnection(flow, 'b', 'c', 'i2');
      const path = findPath(flow, 'a', 'c');
      expect(path).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array when no path exists', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      addConnection(flow, 'a', 'b', 'i1');
      // c is disconnected
      const path = findPath(flow, 'a', 'c');
      expect(path).toEqual([]);
    });

    it('returns empty array when start equals end in empty flow', () => {
      const flow = createFlowData(['a']);
      const path = findPath(flow, 'a', 'a');
      expect(path).toEqual(['a']);
    });

    it('finds shortest path when multiple routes exist', () => {
      const flow = createFlowData(['a', 'b', 'c', 'd']);
      addConnection(flow, 'a', 'b', 'i1');
      addConnection(flow, 'b', 'd', 'i2');
      addConnection(flow, 'a', 'c', 'i3');
      addConnection(flow, 'c', 'd', 'i4');
      const path = findPath(flow, 'a', 'd');
      // Both a→b→d and a→c→d are length 3; BFS returns whichever it finds first
      expect(path).toHaveLength(3);
      expect(path[0]).toBe('a');
      expect(path[path.length - 1]).toBe('d');
    });

    it('handles self-loop path', () => {
      const flow = createFlowData(['a', 'b']);
      addConnection(flow, 'a', 'b', 'i1');
      addConnection(flow, 'b', 'a', 'i2');
      const path = findPath(flow, 'a', 'a');
      expect(path).toEqual(['a']);
    });

    it('returns empty array when start node is not in flow', () => {
      const flow = createFlowData(['a']);
      const path = findPath(flow, 'unknown', 'a');
      expect(path).toEqual([]);
    });

    it('returns empty array when end node is not in flow', () => {
      const flow = createFlowData(['a']);
      const path = findPath(flow, 'a', 'unknown');
      expect(path).toEqual([]);
    });
  });

  describe('getAllReachable', () => {
    it('returns all nodes reachable from start', () => {
      const flow = createFlowData(['a', 'b', 'c', 'd']);
      addConnection(flow, 'a', 'b', 'i1');
      addConnection(flow, 'b', 'c', 'i2');
      addConnection(flow, 'c', 'd', 'i3');
      const reachable = getAllReachable(flow, 'a');
      expect(reachable).toEqual(new Set(['a', 'b', 'c', 'd']));
    });

    it('excludes disconnected nodes', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      addConnection(flow, 'a', 'b', 'i1');
      // c is disconnected
      const reachable = getAllReachable(flow, 'a');
      expect(reachable).toEqual(new Set(['a', 'b']));
    });

    it('includes only start node when no outgoing connections', () => {
      const flow = createFlowData(['a', 'b']);
      const reachable = getAllReachable(flow, 'a');
      expect(reachable).toEqual(new Set(['a']));
    });

    it('handles cycles without infinite loop', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      addConnection(flow, 'a', 'b', 'i1');
      addConnection(flow, 'b', 'c', 'i2');
      addConnection(flow, 'c', 'a', 'i3');
      const reachable = getAllReachable(flow, 'a');
      expect(reachable).toEqual(new Set(['a', 'b', 'c']));
    });
  });

  describe('findOrphanNodes', () => {
    it('finds nodes with no incoming or outgoing connections', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      addConnection(flow, 'a', 'b', 'i1');
      // c is orphaned
      const orphans = findOrphanNodes(flow);
      expect(orphans).toContain('c');
      expect(orphans).not.toContain('a');
      expect(orphans).not.toContain('b');
    });

    it('returns empty array when no orphans', () => {
      const flow = createFlowData(['a', 'b']);
      addConnection(flow, 'a', 'b', 'i1');
      expect(findOrphanNodes(flow)).toEqual([]);
    });

    it('returns all nodes as orphans in empty flow', () => {
      const flow = createFlowData(['a', 'b', 'c']);
      const orphans = findOrphanNodes(flow);
      expect(orphans).toEqual(['a', 'b', 'c']);
    });

    it('identifies nodes with only incoming as non-orphans', () => {
      const flow = createFlowData(['a', 'b']);
      addConnection(flow, 'a', 'b', 'i1');
      // b has incoming but no outgoing — not orphaned per typical definition
      const orphans = findOrphanNodes(flow);
      expect(orphans).not.toContain('b');
    });
  });

  describe('findEntryPoint', () => {
    it('returns preferred entry point when it exists in nodes', () => {
      const flow = createFlowData(['screen-1', 'screen-2']);
      expect(findEntryPoint(flow, 'screen-2')).toBe('screen-2');
    });

    it('returns null for empty flow', () => {
      const flow = createFlowData([]);
      expect(findEntryPoint(flow)).toBeNull();
    });

    it('returns null when no nodes available', () => {
      const flow = createFlowData([]);
      expect(findEntryPoint(flow, 'screen-1')).toBeNull();
    });
  });

  describe('resolveEntryPoint', () => {
    it('uses explicit entryPoint when available', () => {
      const prototypeData = {
        entryPoint: 'custom-entry',
        interactions: {},
      };
      const allNodeIds = ['a', 'b', 'custom-entry'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBe('custom-entry');
    });

    it('uses homeScreenId when entryPoint is not set', () => {
      const prototypeData = {
        homeScreenId: 'home-screen',
        interactions: {},
      };
      const allNodeIds = ['a', 'home-screen'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBe('home-screen');
    });

    it('falls back to first node when no entryPoint or homeScreenId', () => {
      const prototypeData = {
        interactions: {},
      };
      const allNodeIds = ['first-screen', 'second-screen'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBe('first-screen');
    });

    it('returns null when allNodeIds is empty and no entry point set', () => {
      const prototypeData = {
        interactions: {},
      };
      expect(resolveEntryPoint(prototypeData, [])).toBeNull();
    });

    it('prefers entryPoint over homeScreenId when both are set', () => {
      const prototypeData = {
        entryPoint: 'entry',
        homeScreenId: 'home',
        interactions: {},
      };
      const allNodeIds = ['entry', 'home'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBe('entry');
    });

    it('returns null when entryPoint node does not exist in allNodeIds', () => {
      const prototypeData = {
        entryPoint: 'missing-entry',
        interactions: {},
      };
      const allNodeIds = ['a', 'b'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBeNull();
    });

    it('returns null when homeScreenId node does not exist in allNodeIds', () => {
      const prototypeData = {
        homeScreenId: 'missing-home',
        interactions: {},
      };
      const allNodeIds = ['a', 'b'];
      expect(resolveEntryPoint(prototypeData, allNodeIds)).toBeNull();
    });
  });
});
