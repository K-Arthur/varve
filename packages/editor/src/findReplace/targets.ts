/**
 * Scope and eligibility resolution for find/replace.
 *
 * Turns a frozen {@link SearchSpec} into an ordered list of editable text
 * targets. Design points:
 *
 * - Scope is a *set of roots*, resolved once per search and never re-derived
 *   from the live selection. Navigating results changes editor selection but
 *   never retargets the search.
 * - Selection scope expands each selected node to its own text descendants and
 *   de-duplicates an ancestor with its descendants. An empty selection is an
 *   empty scope, never a silent document-wide search.
 * - Linked text frames share one authoritative story (`TextStory.content`).
 *   A story is one target: it is searched once and edited once, while its
 *   frames are reported as propagation.
 * - Locked/hidden are *inherited* from ancestors. Excluding them removes the
 *   target from the search; including them marks matches find-only (protected)
 *   so replacement can never silently unlock or reveal content.
 * - Component instances are detected through any ancestor frame with a
 *   `componentId`, not just an immediate parent.
 */

import type { Document, NodeId, RichText } from '@varve/scene';
import { activePageNodes, plainTextToRichText, richTextToPlainText, walkNodes } from '@varve/scene';
import type { SearchSpec, SkippedCounts } from './types';

export interface TextTarget {
  /** Stable editing address: `node:<id>` or `story:<id>`. */
  key: string;
  kind: 'node' | 'story';
  /** Node id for node targets, story id for story targets. */
  id: NodeId;
  /** Frame/node ids that render this target, in document order. */
  frameIds: NodeId[];
  /** Editor selection target for navigation. */
  primaryFrameId: NodeId;
  name: string;
  richText: RichText;
  plainText: string;
  isInstance: boolean;
  locked: boolean;
  hidden: boolean;
  /** True for story targets whose thread extends beyond the searched scope. */
  propagatesOutsideScope: boolean;
  /** Text-on-path and similar authored modes are searchable but flagged. */
  onPath: boolean;
}

export interface TargetCollection {
  targets: TextTarget[];
  skipped: SkippedCounts;
}

const EMPTY_SKIPPED: SkippedCounts = {
  instances: 0,
  locked: 0,
  hidden: 0,
  unsupported: 0,
};

function startNodeIds(doc: Document, spec: SearchSpec): NodeId[] | null {
  switch (spec.scope) {
    case 'selection':
      // Expansion to descendants happens during the walk, below.
      return spec.selection.length > 0 ? [...spec.selection] : [];
    case 'page':
      return activePageNodes(doc);
    case 'document':
      // `walkNodes` defaults to `doc.rootChildren`, which spans every page's
      // content root (plus master content roots, de-duplicated per story/node).
      return null;
    default:
      return null;
  }
}

export function collectTextTargets(doc: Document, spec: SearchSpec): TargetCollection {
  const skipped: SkippedCounts = { ...EMPTY_SKIPPED };
  const roots = startNodeIds(doc, spec);
  if (roots !== null && roots.length === 0 && spec.scope === 'selection') {
    return { targets: [], skipped };
  }

  const entries = roots === null ? walkNodes(doc) : walkNodes(doc, roots);
  const byKey = new Map<string, TextTarget>();
  const order: string[] = [];

  const ancestorFlags = (
    parentId: NodeId | null,
  ): {
    locked: boolean;
    hidden: boolean;
    instance: boolean;
  } => {
    let locked = false;
    let hidden = false;
    let instance = false;
    const seen = new Set<NodeId>();
    let cursor = parentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const ancestor = doc.nodes[cursor];
      if (!ancestor) break;
      if (ancestor.locked) locked = true;
      if (!ancestor.visible) hidden = true;
      if (ancestor.kind === 'frame' && ancestor.componentId) instance = true;
      cursor = entries.get(cursor)?.parentId ?? null;
    }
    return { locked, hidden, instance };
  };

  for (const [nodeId, entry] of entries) {
    if (entry.node.kind !== 'text') continue;
    const textNode = entry.node;
    const ancestry = ancestorFlags(entry.parentId);
    const story = textNode.storyBinding ? doc.stories?.[textNode.storyBinding.storyId] : undefined;

    const key = story ? `story:${story.id}` : `node:${nodeId}`;
    const richText = story?.content ?? textNode.richText ?? plainTextToRichText(textNode.text);
    const plainText = richTextToPlainText(richText);
    const locked = Boolean(textNode.locked) || ancestry.locked;
    const hidden = !textNode.visible || ancestry.hidden;
    const isInstance = ancestry.instance;

    const existing = byKey.get(key);
    if (existing) {
      // Second frame of a story: record propagation, do not duplicate content.
      if (!existing.frameIds.includes(nodeId)) existing.frameIds.push(nodeId);
      continue;
    }

    const target: TextTarget = {
      key,
      kind: story ? 'story' : 'node',
      id: story ? story.id : nodeId,
      frameIds: [nodeId],
      primaryFrameId: nodeId,
      name: story ? story.name || 'Story' : textNode.name || 'Text',
      richText,
      plainText,
      isInstance,
      locked,
      hidden,
      propagatesOutsideScope: false,
      onPath: textNode.textMode === 'path',
    };

    if (spec.excludeInstances && isInstance) {
      skipped.instances++;
      continue;
    }
    if (spec.excludeLocked && locked) {
      skipped.locked++;
      continue;
    }
    if (spec.excludeHidden && hidden) {
      skipped.hidden++;
      continue;
    }

    byKey.set(key, target);
    order.push(key);
  }

  const targets = order.map((key) => byKey.get(key)!);
  for (const target of targets) {
    if (target.kind !== 'story') continue;
    const story = doc.stories?.[target.id];
    target.propagatesOutsideScope = Boolean(
      story?.thread.some((frameId) => !target.frameIds.includes(frameId)),
    );
  }

  return { targets, skipped };
}

/** Effective rich text for a target (already materialised on the target). */
export function targetRichText(target: TextTarget): RichText {
  return target.richText;
}

/**
 * Whether matches on this target may be authored. Locked and hidden targets
 * remain findable when the corresponding exclude option is off, but are
 * find-only: replacement never unlocks, unhides, or detaches them.
 */
export function targetIsProtected(target: TextTarget): boolean {
  return target.locked || target.hidden;
}

export function protectedReason(target: TextTarget): 'locked' | 'hidden' | null {
  if (target.locked) return 'locked';
  if (target.hidden) return 'hidden';
  return null;
}
