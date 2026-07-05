import type { Document, NodeId, SceneNode } from '@strata/scene';

/**
 * Search index for layer names and properties.
 * Built incrementally on document mutation for O(1) lookup.
 */
export interface LayerSearchIndex {
  /** Map of lowercase word -> matching node IDs */
  wordIndex: Map<string, Set<NodeId>>;
  /** Map of node ID -> all words in the node's name */
  nodeWords: Map<NodeId, string[]>;
  /** Map of node ID -> node kind */
  nodeKinds: Map<NodeId, SceneNode['kind']>;
}

export function createSearchIndex(doc: Document): LayerSearchIndex {
  const wordIndex = new Map<string, Set<NodeId>>();
  const nodeWords = new Map<NodeId, string[]>();
  const nodeKinds = new Map<NodeId, SceneNode['kind']>();

  for (const [id, node] of Object.entries(doc.nodes)) {
    indexNode(id as NodeId, node, wordIndex, nodeWords, nodeKinds);
  }

  return { wordIndex, nodeWords, nodeKinds };
}

function indexNode(
  id: NodeId,
  node: SceneNode,
  wordIndex: Map<string, Set<NodeId>>,
  nodeWords: Map<NodeId, string[]>,
  nodeKinds: Map<NodeId, SceneNode['kind']>,
): void {
  const words = extractWords(node.name);
  nodeWords.set(id, words);
  nodeKinds.set(id, node.kind);

  for (const word of words) {
    if (!wordIndex.has(word)) wordIndex.set(word, new Set());
    wordIndex.get(word)!.add(id);
  }

  const kindWord = `kind:${node.kind}`;
  if (!wordIndex.has(kindWord)) wordIndex.set(kindWord, new Set());
  wordIndex.get(kindWord)!.add(id);
}

function extractWords(name: string): string[] {
  // Split on whitespace, separators, and non-alphanumeric boundaries
  const words = name.split(/[\s\-_./\\()[\]{}#@!+*~'"`|:;<>]+/);
  const result = new Set<string>();

  for (const word of words) {
    if (word.length === 0) continue;
    const cleaned = word.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
    if (cleaned.length === 0) continue;
    result.add(cleaned.toLowerCase());
    const camelParts = cleaned.split(/(?<=[a-z])(?=[A-Z])/);
    for (const part of camelParts) {
      if (part.length > 0) result.add(part.toLowerCase());
    }
  }

  return [...result];
}

/** Search the index — returns matching node IDs ordered by relevance */
export function searchIndex(index: LayerSearchIndex, query: string): NodeId[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  let resultSet: Set<NodeId> | null = null;

  for (const term of terms) {
    const directMatches = index.wordIndex.get(term);
    const prefixMatches = new Set<NodeId>();
    for (const [word, ids] of index.wordIndex) {
      if (word.startsWith(term)) {
        for (const id of ids) prefixMatches.add(id);
      }
    }

    const combined = new Set<NodeId>();
    if (directMatches) for (const id of directMatches) combined.add(id);
    for (const id of prefixMatches) combined.add(id);

    if (resultSet === null) {
      resultSet = combined;
    } else {
      const intersection = new Set<NodeId>();
      for (const id of resultSet) {
        if (combined.has(id)) intersection.add(id);
      }
      resultSet = intersection;
    }
  }

  if (!resultSet) return [];

  const resultIds = [...resultSet];

  // Order by relevance: exact matches first, then prefix matches
  const exactMatches = new Set<NodeId>();
  for (const term of terms) {
    const exact = index.wordIndex.get(term);
    if (exact) for (const id of exact) exactMatches.add(id);
  }

  const sorted = resultIds.sort((a, b) => {
    const aExact = exactMatches.has(a) ? 1 : 0;
    const bExact = exactMatches.has(b) ? 1 : 0;
    return bExact - aExact;
  });

  return sorted;
}

/** Incrementally update index when a node changes */
export function updateIndex(index: LayerSearchIndex, id: NodeId, node: SceneNode): void {
  const oldWords = index.nodeWords.get(id);
  if (oldWords) {
    for (const word of oldWords) {
      const set = index.wordIndex.get(word);
      if (set) {
        set.delete(id);
        if (set.size === 0) index.wordIndex.delete(word);
      }
    }
  }

  index.nodeWords.delete(id);
  index.nodeKinds.delete(id);
  indexNode(id, node, index.wordIndex, index.nodeWords, index.nodeKinds);
}

/** Remove node from index */
export function removeFromIndex(index: LayerSearchIndex, id: NodeId): void {
  const oldWords = index.nodeWords.get(id);
  if (oldWords) {
    for (const word of oldWords) {
      const set = index.wordIndex.get(word);
      if (set) {
        set.delete(id);
        if (set.size === 0) index.wordIndex.delete(word);
      }
    }
  }
  index.nodeWords.delete(id);
  index.nodeKinds.delete(id);
}
