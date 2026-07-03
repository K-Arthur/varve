/**
 * Navigation system — flow graph management, path finding, entry point resolution,
 * and flow validation for the Strata prototype engine.
 *
 * Research basis: Figma prototype flow graph (nodes + connections), BFS shortest
 * path (Dijkstra unweighted), reachability analysis (graph theory), APG navigation
 * patterns (back-stack history).
 */

import type { FlowConnection, FlowData, NodeId } from './types';

let _nextConnectionId = 1;

function generateConnectionId(): string {
  return `conn-${_nextConnectionId++}`;
}

/**
 * Creates a FlowData object representing the prototype's navigation graph.
 */
export function createFlowData(nodes: NodeId[], connections?: FlowConnection[]): FlowData {
  return {
    nodes: [...nodes],
    connections: connections ? [...connections] : [],
  };
}

/**
 * Adds a directional connection between two nodes in the flow graph.
 * Mutates the flow object in place for simplicity (caller clones if needed).
 */
export function addConnection(
  flow: FlowData,
  sourceNodeId: NodeId,
  targetNodeId: NodeId,
  interactionId: string,
): void {
  const connection: FlowConnection = {
    id: generateConnectionId(),
    sourceNodeId,
    targetNodeId,
    interactionId,
  };
  flow.connections.push(connection);
}

/**
 * Removes a connection from the flow graph by its id.
 */
export function removeConnection(flow: FlowData, connectionId: string): void {
  const index = flow.connections.findIndex((c) => c.id === connectionId);
  if (index !== -1) {
    flow.connections.splice(index, 1);
  }
}

/**
 * Returns all connections that originate from the given node.
 */
export function getOutgoingConnections(flow: FlowData, nodeId: NodeId): FlowConnection[] {
  return flow.connections.filter((c) => c.sourceNodeId === nodeId);
}

/**
 * Returns all connections that target the given node.
 */
export function getIncomingConnections(flow: FlowData, nodeId: NodeId): FlowConnection[] {
  return flow.connections.filter((c) => c.targetNodeId === nodeId);
}

/**
 * Finds the shortest path between two nodes using BFS.
 * Returns an array of NodeIds from fromNodeId to toNodeId inclusive,
 * or an empty array if no path exists.
 */
export function findPath(flow: FlowData, fromNodeId: NodeId, toNodeId: NodeId): NodeId[] {
  if (!flow.nodes.includes(fromNodeId) || !flow.nodes.includes(toNodeId)) {
    return [];
  }

  if (fromNodeId === toNodeId) {
    return [fromNodeId];
  }

  const adjacency = buildAdjacencyList(flow);
  const visited = new Set<NodeId>();
  const parent = new Map<NodeId, NodeId | null>();
  const queue: NodeId[] = [fromNodeId];

  visited.add(fromNodeId);
  parent.set(fromNodeId, null);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === toNodeId) {
      return reconstructPath(parent, toNodeId);
    }

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        parent.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return [];
}

/**
 * Returns all nodes reachable from the given start node.
 */
export function getAllReachable(flow: FlowData, startNodeId: NodeId): Set<NodeId> {
  const reachable = new Set<NodeId>();
  const adjacency = buildAdjacencyList(flow);
  const queue: NodeId[] = [startNodeId];

  reachable.add(startNodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) ?? [];

    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return reachable;
}

/**
 * Finds nodes that have no connections at all (neither incoming nor outgoing).
 */
export function findOrphanNodes(flow: FlowData): NodeId[] {
  const connected = new Set<NodeId>();

  for (const conn of flow.connections) {
    connected.add(conn.sourceNodeId);
    connected.add(conn.targetNodeId);
  }

  return flow.nodes.filter((nodeId) => !connected.has(nodeId));
}

/**
 * Resolves the entry point for a flow graph.
 * Returns the preferred entry point if it exists in the flow's nodes,
 * otherwise returns the first node in the flow, or null if flow is empty.
 */
export function findEntryPoint(flow: FlowData, preferredEntryPoint?: NodeId): NodeId | null {
  if (flow.nodes.length === 0) {
    return null;
  }

  if (preferredEntryPoint && flow.nodes.includes(preferredEntryPoint)) {
    return preferredEntryPoint;
  }

  return null;
}

/**
 * Resolves the first screen to show when entering prototype preview.
 *
 * Priority:
 * 1. Explicit entryPoint (if it exists in allNodeIds)
 * 2. homeScreenId (if it exists in allNodeIds)
 * 3. First node in allNodeIds
 * 4. null if allNodeIds is empty
 */
export function resolveEntryPoint(
  prototypeData: {
    entryPoint?: NodeId;
    homeScreenId?: NodeId;
    interactions: Record<string, any[]>;
  },
  allNodeIds: NodeId[],
): NodeId | null {
  if (allNodeIds.length === 0) {
    return null;
  }

  if (prototypeData.entryPoint) {
    if (allNodeIds.includes(prototypeData.entryPoint)) {
      return prototypeData.entryPoint;
    }
    return null;
  }

  if (prototypeData.homeScreenId) {
    if (allNodeIds.includes(prototypeData.homeScreenId)) {
      return prototypeData.homeScreenId;
    }
    return null;
  }

  return allNodeIds[0] ?? null;
}

// ── Internal helpers ──────────────────────────────────────────────

function buildAdjacencyList(flow: FlowData): Map<NodeId, NodeId[]> {
  const adjacency = new Map<NodeId, NodeId[]>();

  for (const node of flow.nodes) {
    adjacency.set(node, []);
  }

  for (const conn of flow.connections) {
    const neighbors = adjacency.get(conn.sourceNodeId);
    if (neighbors) {
      neighbors.push(conn.targetNodeId);
    }
  }

  return adjacency;
}

function reconstructPath(parent: Map<NodeId, NodeId | null>, toNodeId: NodeId): NodeId[] {
  const path: NodeId[] = [];
  let current: NodeId | null = toNodeId;

  while (current !== null) {
    path.unshift(current);
    current = parent.get(current) ?? null;
  }

  return path;
}
