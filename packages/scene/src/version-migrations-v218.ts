/**
 * v2.17 → v2.18 migration: promote text chains into authoritative stories
 * (ADR-0159 / M9).
 *
 * Before 2.18, linked text lived in `doc.textChains` (ordered frame lists)
 * with text stored per-frame on `TextNode.richText`. This migration creates
 * one `TextStory` per chain — content taken from the chain's richText, or
 * the first frame's richText, or the first frame's plain text converted to
 * a single run — and binds every thread frame to the story. Frames outside
 * chains keep their own richText (single-frame default).
 *
 * The migration is pure and idempotent: documents with no chains (or
 * already carrying stories) are only version-stamped. `textChains` is
 * dropped — stories are authoritative; pre-2.18 readers preserve the new
 * field as pass-through.
 */

import type { Document } from './document';
import type { NodeId, RichText, TextStory } from './types';
import type { TextChain } from './typography';

function chainToStory(doc: Document, chain: TextChain): TextStory {
  const firstFrameId = chain.frameIds[0];
  const firstFrame = firstFrameId ? doc.nodes[firstFrameId] : undefined;
  const richText =
    chain.richText ??
    (firstFrame?.kind === 'text' ? firstFrame.richText : undefined) ??
    (firstFrame?.kind === 'text' && firstFrame.text
      ? ({ paragraphs: [{ runs: [{ text: firstFrame.text }] }] } as RichText)
      : ({ paragraphs: [] } as RichText));
  return {
    id: chain.id,
    name: chain.name,
    content: richText,
    thread: [...chain.frameIds],
  };
}

export function migrateV217ToV218(raw: Record<string, unknown>): Record<string, unknown> {
  const chains = raw.textChains as Record<string, unknown> | undefined;
  const nodes = raw.nodes as Record<string, unknown> | undefined;

  if (!chains || Object.keys(chains).length === 0) {
    return { ...raw, formatVersion: '2.18' };
  }

  const docLike = { nodes: nodes ?? {} } as unknown as Document;
  const stories: Record<NodeId, TextStory> = {};
  let changedNodes = false;
  const nextNodes: Record<string, unknown> = { ...(nodes ?? {}) };

  for (const [chainId, entry] of Object.entries(chains)) {
    const chain = entry as unknown as TextChain;
    if (!chain || typeof chain !== 'object') continue;
    if (!Array.isArray(chain.frameIds)) continue;
    stories[chainId] = chainToStory(docLike, chain);
    for (let i = 0; i < chain.frameIds.length; i++) {
      const frameId = chain.frameIds[i]!;
      const frame = nextNodes[frameId] as Record<string, unknown> | undefined;
      if (frame?.kind !== 'text') continue;
      changedNodes = true;
      nextNodes[frameId] = {
        ...frame,
        storyBinding: { storyId: chainId, threadIndex: i },
      };
    }
  }

  const result: Record<string, unknown> = {
    ...raw,
    formatVersion: '2.18',
    nodes: changedNodes ? nextNodes : raw.nodes,
    stories,
  };
  delete result.textChains;
  return result;
}
