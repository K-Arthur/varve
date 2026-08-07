/**
 * Document-level story composition bridge (M10).
 */
import type { Document, RichText } from '@varve/scene';
import {
  addNode,
  createDocument,
  createStory as createStoryDoc,
  linkFrame as linkFrameDoc,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { composeStoryForDoc } from '../storyCompose';

function storyDoc(): Document {
  let doc = createDocument('compose', true);
  const f1 = addNode(doc, makeTextNode('f1', '', { w: 400, h: 100, fontSize: 16 }));
  doc = f1;
  const f2 = addNode(doc, makeTextNode('f2', '', { w: 400, h: 100, fontSize: 16 }));
  doc = f2;
  const content: RichText = {
    paragraphs: [{ runs: [{ text: Array.from({ length: 90 }, () => 'word ').join('') }] }],
  };
  const { story, doc: d1 } = createStoryDoc(doc, { name: 'S', content });
  doc = d1;
  doc = linkFrameDoc(doc, story.id, 'f1');
  doc = linkFrameDoc(doc, story.id, 'f2');
  return doc;
}

describe('composeStoryForDoc (M10)', () => {
  it('derives per-frame ranges across the thread', () => {
    const doc = storyDoc();
    const storyId = Object.keys(doc.stories!)[0]!;
    const result = composeStoryForDoc(doc, storyId);
    expect(result).not.toBeNull();
    expect(result!.frames).toHaveLength(2);
    expect(result!.frames[0]!.frameId).toBe('f1');
    expect(result!.frames[0]!.overset).toBe(true);
    expect(result!.frames[1]!.startGrapheme).toBe(result!.frames[0]!.endGrapheme);
    expect(result!.oversetGraphemes).toBe(0);
    expect(result!.totalGraphemes).toBe(450);
  });

  it('reports overset when the story exceeds the thread', () => {
    let doc = createDocument('compose', true);
    const f1 = addNode(doc, makeTextNode('f1', '', { w: 200, h: 40, fontSize: 16 }));
    doc = f1;
    const content: RichText = {
      paragraphs: [{ runs: [{ text: Array.from({ length: 200 }, () => 'word ').join('') }] }],
    };
    const { story, doc: d1 } = createStoryDoc(doc, { name: 'S', content });
    doc = d1;
    doc = linkFrameDoc(doc, story.id, 'f1');
    const result = composeStoryForDoc(doc, story.id);
    expect(result!.frames[0]!.overset).toBe(true);
    expect(result!.oversetGraphemes).toBeGreaterThan(0);
  });

  it('returns null for unknown stories', () => {
    const doc = createDocument('compose', true);
    expect(composeStoryForDoc(doc, 'nope')).toBeNull();
  });
});
