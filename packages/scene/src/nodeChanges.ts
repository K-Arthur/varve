/**
 * Cheap change classification between two committed node records.
 *
 * Documents are immutable and edits share unchanged node objects, so an
 * identity walk tells which nodes an edit touched. Derived structures that
 * ignore geometry can then survive a move (every drag frame commits one)
 * instead of being rebuilt from the whole document.
 */

import type { Document } from './document';
import type { NodeId } from './types';

export interface NodeChangeClassification {
  /** Added, removed, or replaced authored node records, in document order. */
  changedNodeIds: readonly NodeId[];
  /** Every changed record differs only in its transform. */
  transformsOnly: boolean;
  /** At least one node id was added or removed. */
  topologyChanged: boolean;
}

const NO_NODE_CHANGES: NodeChangeClassification = Object.freeze({
  changedNodeIds: Object.freeze([]) as readonly NodeId[],
  transformsOnly: true,
  topologyChanged: false,
});

/**
 * Recent answers. Several caches ask about the same pair of records on each
 * drag frame (previous frame's nodes against the new ones), and every walk is
 * O(nodes).
 */
const RECENT_ANSWER_CAPACITY = 4;
const recentAnswers: Array<{
  previous: Document['nodes'];
  next: Document['nodes'];
  answer: NodeChangeClassification;
}> = [];

/**
 * Classify one immutable node-record pair. The bounded pair cache makes the
 * changed-id walk shared by geometry, scene-scope, and other edit consumers
 * on the same document transition.
 */
export function classifyNodeChanges(
  previous: Document['nodes'],
  next: Document['nodes'],
): NodeChangeClassification {
  if (previous === next) return NO_NODE_CHANGES;
  for (const entry of recentAnswers) {
    if (entry.previous === previous && entry.next === next) return entry.answer;
  }
  const answer = compareNodes(previous, next);
  recentAnswers.unshift({ previous, next, answer });
  if (recentAnswers.length > RECENT_ANSWER_CAPACITY) recentAnswers.pop();
  return answer;
}

/**
 * True when both records hold the same node ids and every node object that
 * differs differs only in its `transform`.
 */
export function nodesDifferOnlyInTransforms(
  previous: Document['nodes'],
  next: Document['nodes'],
): boolean {
  return classifyNodeChanges(previous, next).transformsOnly;
}

function compareNodes(
  previous: Document['nodes'],
  next: Document['nodes'],
): NodeChangeClassification {
  let transformsOnly = true;
  let topologyChanged = false;
  const changedNodeIds: NodeId[] = [];
  const previousFields = new Set<string>();

  for (const id in next) {
    const a = previous[id];
    const b = next[id];
    if (a === b) continue;
    changedNodeIds.push(id as NodeId);
    if (!a || !b) {
      topologyChanged = true;
      transformsOnly = false;
      continue;
    }

    const fieldsA = a as unknown as Record<string, unknown>;
    const fieldsB = b as unknown as Record<string, unknown>;
    for (const field of Object.keys(fieldsA)) {
      previousFields.add(field);
      if (field !== 'transform' && fieldsA[field] !== fieldsB[field]) transformsOnly = false;
    }
    for (const field of Object.keys(fieldsB)) {
      if (field !== 'transform' && !previousFields.has(field)) transformsOnly = false;
    }
    previousFields.clear();
  }

  for (const id in previous) {
    if (Object.hasOwn(next, id)) continue;
    changedNodeIds.push(id as NodeId);
    topologyChanged = true;
    transformsOnly = false;
  }

  return Object.freeze({
    changedNodeIds: Object.freeze(changedNodeIds),
    transformsOnly,
    topologyChanged,
  });
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
