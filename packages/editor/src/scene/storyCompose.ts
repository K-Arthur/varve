/**
 * Document-level story composition (M10, ADR-0161): bridges the scene's
 * story model to the engine's deterministic composition. Builds the
 * composition inputs (story content, frame geometry, default font) from
 * the document and derives per-frame grapheme ranges + overset.
 *
 * Ranges are derived — never stored. The composition key lets consumers
 * invalidate caches and reject stale worker results.
 */

import type { StoryContent, StoryFrameGeometry } from '@varve/engine';
import { type ComposeStoryResult, composeStory } from '@varve/engine';
import type { Document, NodeId } from '@varve/scene';
import { storyById } from '@varve/scene';

export interface ComposeStoryForDocResult extends ComposeStoryResult {
  storyId: NodeId;
}

/**
 * Compose a document story through its thread frames. Returns null when the
 * story or any of its frames is missing (validation is separate).
 */
export function composeStoryForDoc(
  doc: Document,
  storyId: NodeId,
  defaultFontSize = 16,
): ComposeStoryForDocResult | null {
  const story = storyById(doc, storyId);
  if (!story) return null;

  const frames: StoryFrameGeometry[] = [];
  for (const frameId of story.thread) {
    const node = doc.nodes[frameId];
    if (node?.kind !== 'text') return null;
    const w = node.w ?? 300;
    const h = node.h ?? 100;
    const fontSize = node.fontSize ?? defaultFontSize;
    frames.push({
      frameId,
      width: w,
      height: h,
      lineHeight: node.lineHeight ? node.lineHeight * fontSize : undefined,
    });
  }

  const content = story.content as unknown as StoryContent;
  const result = composeStory({
    storyId,
    content,
    frames,
    defaultFont: { fontSize: defaultFontSize, fontFamily: 'sans-serif' },
    language: story.language,
  });

  return { ...result, storyId };
}
