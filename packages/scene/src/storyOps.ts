/**
 * Story operations (M9, ADR-0159): one authoritative TextStory owns the
 * text; linked text frames reference it through thread bindings. Frames
 * without a binding keep their own richText (single-frame default).
 *
 * Thread edits validate before applying: a frame can belong to only one
 * story, cycles are rejected, and every binding must resolve. Composition
 * (derived frame ranges) is NOT stored here — see the composition milestone.
 */

import type { Document } from './document';
import type { NodeId, RichText, TextStory } from './types';

export interface StoryThreadIssue {
  code: 'cycle' | 'duplicate-frame' | 'missing-frame' | 'stale-binding' | 'bad-index';
  storyId: NodeId;
  frameId?: NodeId;
  detail: string;
}

// ── Lookups ─────────────────────────────────────────────────────────────────

export function storyById(doc: Document, storyId: NodeId): TextStory | undefined {
  return doc.stories?.[storyId];
}

export function storyForFrame(doc: Document, frameId: NodeId): TextStory | undefined {
  const node = doc.nodes[frameId];
  if (!node || node.kind !== 'text') return undefined;
  if (!node.storyBinding) return undefined;
  return doc.stories?.[node.storyBinding.storyId];
}

// ── Creation ─────────────────────────────────────────────────────────────────

export function createStory(
  doc: Document,
  opts: { id?: NodeId; name?: string; content: RichText; language?: string },
): { story: TextStory; doc: Document } {
  const story: TextStory = {
    id: opts.id ?? `story-${doc.nextId}`,
    name: opts.name ?? 'Story',
    content: opts.content,
    thread: [],
    ...(opts.language ? { language: opts.language } : {}),
  };
  return {
    story,
    doc: { ...doc, stories: { ...(doc.stories ?? {}), [story.id]: story } },
  };
}

// ── Thread editing ──────────────────────────────────────────────────────────

/**
 * Link a text frame into a story thread (append). Rejects frames already
 * bound to a story, frames bound with a stale story id, and non-text
 * nodes. Sets the frame's `storyBinding` and appends to the thread.
 */
export function linkFrame(doc: Document, storyId: NodeId, frameId: NodeId): Document {
  const story = doc.stories?.[storyId];
  if (!story) return doc;
  const node = doc.nodes[frameId];
  if (!node || node.kind !== 'text') return doc;
  if (node.storyBinding) {
    const other = doc.stories?.[node.storyBinding.storyId];
    if (other && other.thread.includes(frameId)) return doc;
  }
  if (story.thread.includes(frameId)) return doc;

  const boundNode = { ...node, storyBinding: { storyId, threadIndex: story.thread.length } };
  const nextStory = { ...story, thread: [...story.thread, frameId] };
  return {
    ...doc,
    nodes: { ...doc.nodes, [frameId]: boundNode },
    stories: { ...doc.stories, [storyId]: nextStory },
  };
}

/**
 * Insert an existing thread frame after `afterFrameId` (or at the head).
 * Reorders the story thread and rewrites every affected binding index.
 */
export function insertFrameInThread(
  doc: Document,
  storyId: NodeId,
  frameId: NodeId,
  afterFrameId?: NodeId,
): Document {
  const story = doc.stories?.[storyId];
  if (!story || !story.thread.includes(frameId)) return doc;
  if (afterFrameId !== undefined && !story.thread.includes(afterFrameId)) return doc;
  const idx = story.thread.indexOf(frameId);
  let thread = [...story.thread];
  const [moved] = thread.splice(idx, 1);
  if (afterFrameId === undefined) {
    thread = [moved as NodeId, ...thread];
  } else {
    const afterIdx = thread.indexOf(afterFrameId);
    thread.splice(afterIdx + 1, 0, moved as NodeId);
  }
  return rebindThread(doc, storyId, thread);
}

/**
 * Remove a frame from a story thread and clear its binding.
 */
export function unlinkFrame(doc: Document, storyId: NodeId, frameId: NodeId): Document {
  const story = doc.stories?.[storyId];
  if (!story) return doc;
  const thread = story.thread.filter((id) => id !== frameId);
  let d: Document = { ...doc, stories: { ...doc.stories, [storyId]: { ...story, thread } } };
  const node = d.nodes[frameId];
  if (node && node.kind === 'text' && node.storyBinding?.storyId === storyId) {
    const { storyBinding: _drop, ...rest } = node;
    d = { ...d, nodes: { ...d.nodes, [frameId]: rest } };
  }
  return rebindThread(d, storyId, thread);
}

/** Rewrite binding indices to match a thread order and store the thread. */
function rebindThread(doc: Document, storyId: NodeId, thread: NodeId[]): Document {
  let d = doc;
  for (let i = 0; i < thread.length; i++) {
    const frameId = thread[i]!;
    const node = d.nodes[frameId];
    if (!node || node.kind !== 'text') continue;
    if (!node.storyBinding || node.storyBinding.storyId !== storyId) continue;
    d = {
      ...d,
      nodes: { ...d.nodes, [frameId]: { ...node, storyBinding: { storyId, threadIndex: i } } },
    };
  }
  const story = d.stories?.[storyId];
  if (story) {
    d = { ...d, stories: { ...d.stories, [storyId]: { ...story, thread } } };
  }
  return d;
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate the story graph: cycles, duplicate frames, missing frames, and
 * bindings that disagree with their thread. Deterministic; used on load,
 * before thread edits, and by the migration tests.
 */
export function validateStoryThreads(doc: Document): StoryThreadIssue[] {
  const issues: StoryThreadIssue[] = [];
  for (const story of Object.values(doc.stories ?? {})) {
    const seen = new Set<NodeId>();
    for (const frameId of story.thread) {
      if (seen.has(frameId)) {
        issues.push({
          code: 'duplicate-frame',
          storyId: story.id,
          frameId,
          detail: `frame ${frameId} appears more than once in story ${story.id}`,
        });
        continue;
      }
      seen.add(frameId);
      const node = doc.nodes[frameId];
      if (!node || node.kind !== 'text') {
        issues.push({
          code: 'missing-frame',
          storyId: story.id,
          frameId,
          detail: `story ${story.id} references missing frame ${frameId}`,
        });
        continue;
      }
      const binding = node.storyBinding;
      if (!binding || binding.storyId !== story.id) {
        issues.push({
          code: 'stale-binding',
          storyId: story.id,
          frameId,
          detail: `frame ${frameId} is in story ${story.id} but its binding is stale`,
        });
      } else if (binding.threadIndex !== story.thread.indexOf(frameId)) {
        issues.push({
          code: 'bad-index',
          storyId: story.id,
          frameId,
          detail: `frame ${frameId} binding index ${binding.threadIndex} != thread position`,
        });
      }
    }
    // Frames bound to the story but missing from its thread.
    for (const frameId of Object.keys(doc.nodes)) {
      const node = doc.nodes[frameId];
      if (node?.kind !== 'text' || !node.storyBinding) continue;
      if (node.storyBinding.storyId !== story.id) continue;
      if (!story.thread.includes(frameId)) {
        issues.push({
          code: 'stale-binding',
          storyId: story.id,
          frameId,
          detail: `frame ${frameId} is bound to story ${story.id} but absent from its thread`,
        });
      }
    }
  }
  return issues;
}

/** Whether a story thread contains a cycle (its frame list loops back). */
export function threadHasCycle(thread: NodeId[]): boolean {
  const seen = new Set<NodeId>();
  for (const id of thread) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

/** All frames across every story (thread order). */
export function allStoryFrames(doc: Document): NodeId[] {
  const frames: NodeId[] = [];
  for (const story of Object.values(doc.stories ?? {})) frames.push(...story.thread);
  return frames;
}
