/**
 * Story operations (M9, ADR-0159): authoritative stories, thread binding,
 * linking/unlinking, and thread validation.
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addNode, createDocument, makeTextNode } from '../document';
import {
  createStory,
  insertFrameInThread,
  linkFrame,
  storyForFrame,
  threadHasCycle,
  unlinkFrame,
  validateStoryThreads,
} from '../storyOps';
import type { RichText } from './../types';

function emptyContent(): RichText {
  return { paragraphs: [] };
}

function textFrame(doc: Document, id: string): { doc: Document; id: string } {
  const d = addNode(doc, makeTextNode(id, 'Hello', {}));
  return { doc: d, id };
}

describe('storyOps (M9)', () => {
  it('creates a story and links frames into its thread', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const f2 = textFrame(doc, 'f2');
    doc = f2.doc;

    const { story, doc: d1 } = createStory(doc, { name: 'S', content: emptyContent() });
    doc = d1;
    doc = linkFrame(doc, story.id, 'f1');
    doc = linkFrame(doc, story.id, 'f2');

    const node1 = doc.nodes.f1;
    expect(node1?.kind === 'text' ? node1.storyBinding : undefined).toEqual({
      storyId: story.id,
      threadIndex: 0,
    });
    expect(storyForFrame(doc, 'f2')?.id).toBe(story.id);
    expect(validateStoryThreads(doc)).toEqual([]);
  });

  it('rejects linking a frame already bound to another story', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const { story: s1, doc: d1 } = createStory(doc, { name: 'A', content: emptyContent() });
    doc = d1;
    const { story: s2, doc: d2 } = createStory(doc, { name: 'B', content: emptyContent() });
    doc = d2;
    doc = linkFrame(doc, s1.id, 'f1');
    const before = doc.stories![s2.id]!.thread.length;
    doc = linkFrame(doc, s2.id, 'f1');
    expect(doc.stories![s2.id]!.thread.length).toBe(before);
  });

  it('unlinks a frame and clears its binding', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const { story, doc: d1 } = createStory(doc, { name: 'S', content: emptyContent() });
    doc = d1;
    doc = linkFrame(doc, story.id, 'f1');
    doc = unlinkFrame(doc, story.id, 'f1');
    expect(doc.stories![story.id]!.thread).toEqual([]);
    const node = doc.nodes.f1;
    expect(node?.kind === 'text' ? node.storyBinding : undefined).toBeUndefined();
  });

  it('reorders the thread and rewrites binding indices', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const f2 = textFrame(doc, 'f2');
    doc = f2.doc;
    const f3 = textFrame(doc, 'f3');
    doc = f3.doc;
    const { story, doc: d1 } = createStory(doc, { name: 'S', content: emptyContent() });
    doc = d1;
    doc = linkFrame(doc, story.id, 'f1');
    doc = linkFrame(doc, story.id, 'f2');
    doc = linkFrame(doc, story.id, 'f3');
    doc = insertFrameInThread(doc, story.id, 'f3', 'f1');
    expect(doc.stories![story.id]!.thread).toEqual(['f1', 'f3', 'f2']);
    expect(validateStoryThreads(doc)).toEqual([]);
  });

  it('detects duplicate frames in a thread', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const { story, doc: d1 } = createStory(doc, { name: 'S', content: emptyContent() });
    doc = d1;
    doc = linkFrame(doc, story.id, 'f1');
    // Corrupt the thread directly to simulate a bad merge/load.
    doc = {
      ...doc,
      stories: { ...doc.stories, [story.id]: { ...story, thread: ['f1', 'f1'] } },
    };
    const issues = validateStoryThreads(doc);
    expect(issues.some((i) => i.code === 'duplicate-frame')).toBe(true);
  });

  it('detects missing frames and stale bindings', () => {
    let doc = createDocument('stories', true);
    const f1 = textFrame(doc, 'f1');
    doc = f1.doc;
    const { story, doc: d1 } = createStory(doc, { name: 'S', content: emptyContent() });
    doc = d1;
    doc = linkFrame(doc, story.id, 'f1');
    doc = {
      ...doc,
      stories: { ...doc.stories, [story.id]: { ...story, thread: ['f1', 'ghost'] } },
    };
    const issues = validateStoryThreads(doc);
    expect(issues.some((i) => i.code === 'missing-frame')).toBe(true);
  });

  it('detects cycles by duplicate membership', () => {
    expect(threadHasCycle(['a', 'b', 'a'])).toBe(true);
    expect(threadHasCycle(['a', 'b', 'c'])).toBe(false);
  });
});
