/**
 * Cheap change classification between two committed node records.
 *
 * Documents are immutable and edits share unchanged node objects, so an
 * identity walk tells which nodes an edit touched. Derived structures that
 * ignore geometry can then survive a move (every drag frame commits one)
 * instead of being rebuilt from the whole document.
 */

import type { Document } from './document';

const nodeCounts = new WeakMap<Document['nodes'], number>();

function nodeCount(nodes: Document['nodes']): number {
  let count = nodeCounts.get(nodes);
  if (count === undefined) {
    count = 0;
    for (const _id in nodes) count += 1;
    nodeCounts.set(nodes, count);
  }
  return count;
}

/**
 * Recent answers. Several caches ask about the same pair of records on each
 * drag frame (previous frame's nodes against the new ones), and every walk is
 * O(nodes).
 */
const RECENT_ANSWER_CAPACITY = 4;
const recentAnswers: Array<{
  previous: Document['nodes'];
  next: Document['nodes'];
  answer: boolean;
}> = [];

/**
 * True when both records hold the same node ids and every node object that
 * differs differs only in its `transform`.
 */
export function nodesDifferOnlyInTransforms(
  previous: Document['nodes'],
  next: Document['nodes'],
): boolean {
  if (previous === next) return true;
  for (const entry of recentAnswers) {
    if (entry.previous === previous && entry.next === next) return entry.answer;
  }
  const answer = compareNodes(previous, next);
  recentAnswers.unshift({ previous, next, answer });
  if (recentAnswers.length > RECENT_ANSWER_CAPACITY) recentAnswers.pop();
  return answer;
}

function compareNodes(previous: Document['nodes'], next: Document['nodes']): boolean {
  let nextCount = 0;
  for (const id in next) {
    nextCount += 1;
    const a = previous[id];
    const b = next[id];
    if (a === b) continue;
    if (!a || !b) return false;
    const fieldsA = a as unknown as Record<string, unknown>;
    const fieldsB = b as unknown as Record<string, unknown>;
    for (const field of new Set([...Object.keys(fieldsA), ...Object.keys(fieldsB)])) {
      if (field !== 'transform' && fieldsA[field] !== fieldsB[field]) return false;
    }
  }
  nodeCounts.set(next, nextCount);
  return nodeCount(previous) === nextCount;
}

/**
 * True when two documents differ only in node transforms: every other
 * document field is the identical value and the node records differ only as
 * `nodesDifferOnlyInTransforms` allows.
 */
export function documentsDifferOnlyInTransforms(previous: Document, next: Document): boolean {
  if (previous === next) return true;
  const before = previous as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (field !== 'nodes' && before[field] !== after[field]) return false;
  }
  return nodesDifferOnlyInTransforms(previous.nodes, next.nodes);
}
