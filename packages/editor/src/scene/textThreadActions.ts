/**
 * Text-thread link planning (M11, ADR-0159): pure decision logic for
 * linking/unlinking selected text frames through stories.
 *
 * Link semantics:
 *  - No story-bound frame in the selection -> create a new story seeded by
 *    the first frame's rich text; all selected frames join the thread in
 *    selection order.
 *  - Exactly one story in the selection -> the remaining selected frames
 *    append to that story's thread (frames already in it are no-ops).
 *  - Frames bound to different stories -> no-op (must unlink first).
 */

import type { Document, NodeId, RichText } from '@varve/scene';
import { storyForFrame } from '@varve/scene';

export type LinkPlan =
  | { kind: 'create-story'; name: string; frames: NodeId[] }
  | { kind: 'append'; storyId: NodeId; frames: NodeId[] }
  | { kind: 'noop'; reason: string };

export function planLinkSelection(doc: Document, selection: NodeId[]): LinkPlan {
  const textFrames = selection.filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'text';
  });
  if (textFrames.length < 2) {
    return { kind: 'noop', reason: 'select at least two text frames to link' };
  }

  const storyIds = new Set<NodeId>();
  for (const id of textFrames) {
    const story = storyForFrame(doc, id);
    if (story) storyIds.add(story.id);
  }

  if (storyIds.size === 0) {
    return { kind: 'create-story', name: 'Story', frames: textFrames };
  }
  if (storyIds.size === 1) {
    const storyId = [...storyIds][0]!;
    const story = doc.stories?.[storyId];
    if (!story) {
      throw new Error('invariant: linked story missing from document');
    }
    const frames = textFrames.filter((id) => !story.thread.includes(id));
    if (frames.length === 0) {
      return { kind: 'noop', reason: 'selected frames are already linked' };
    }
    return { kind: 'append', storyId, frames };
  }
  return {
    kind: 'noop',
    reason: 'selection spans multiple stories — unlink first',
  };
}

export function planUnlinkSelection(doc: Document, selection: NodeId[]): NodeId[] {
  return selection.filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'text' && Boolean(node.storyBinding);
  });
}

/** Seed content for a new story: the first frame's rich text or plain text. */
export function storySeedForFrame(doc: Document, frameId: NodeId): RichText {
  const node = doc.nodes[frameId];
  if (node?.kind === 'text') {
    if (node.richText) return node.richText;
    if (node.text) return { paragraphs: [{ runs: [{ text: node.text }] }] };
  }
  return { paragraphs: [] };
}
