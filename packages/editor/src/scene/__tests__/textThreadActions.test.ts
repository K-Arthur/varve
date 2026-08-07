/**
 * Text-thread link planning (M11, ADR-0159): link/unlink decision logic.
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
import { planLinkSelection, planUnlinkSelection, storySeedForFrame } from '../textThreadActions';

function twoTextFrames(doc: Document, ids = ['f1', 'f2']) {
  let d = doc;
  for (const id of ids) d = addNode(d, makeTextNode(id, `text ${id}`, {}));
  return d;
}

function storyDoc(): Document {
  let doc = createDocument('threads', true);
  doc = twoTextFrames(doc);
  const content: RichText = { paragraphs: [{ runs: [{ text: 'seeded' }] }] };
  const { story, doc: d1 } = createStoryDoc(doc, { name: 'S', content });
  doc = d1;
  doc = linkFrameDoc(doc, story.id, 'f1');
  return doc;
}

describe('planLinkSelection (M11)', () => {
  it('creates a story from unbound text frames', () => {
    const doc = twoTextFrames(createDocument('threads', true));
    const plan = planLinkSelection(doc, ['f1', 'f2']);
    expect(plan.kind).toBe('create-story');
    if (plan.kind === 'create-story') expect(plan.frames).toEqual(['f1', 'f2']);
  });

  it('appends unbound frames to the single existing story', () => {
    const doc = storyDoc();
    const plan = planLinkSelection(doc, ['f1', 'f2']);
    expect(plan.kind).toBe('append');
    if (plan.kind === 'append') {
      expect(plan.storyId).toBe(Object.keys(doc.stories!)[0]);
      expect(plan.frames).toEqual(['f2']);
    }
  });

  it('no-ops when everything is already linked', () => {
    const doc = storyDoc();
    const plan = planLinkSelection(doc, ['f1']);
    expect(plan.kind).toBe('noop');
  });

  it('no-ops across multiple stories', () => {
    let doc = storyDoc();
    const content: RichText = { paragraphs: [{ runs: [{ text: 'other' }] }] };
    const { story, doc: d1 } = createStoryDoc(doc, { name: 'T', content });
    doc = d1;
    doc = linkFrameDoc(doc, story.id, 'f2');
    const plan = planLinkSelection(doc, ['f1', 'f2']);
    expect(plan.kind).toBe('noop');
    if (plan.kind === 'noop') expect(plan.reason).toContain('multiple stories');
  });

  it('requires at least two text frames', () => {
    const doc = createDocument('threads', true);
    expect(planLinkSelection(doc, ['f1']).kind).toBe('noop');
  });
});

describe('planUnlinkSelection + seed', () => {
  it('returns only story-bound frames', () => {
    const doc = storyDoc();
    const unlink = planUnlinkSelection(doc, ['f1', 'f2', 'ghost']);
    expect(unlink).toEqual(['f1']);
  });

  it('seeds a story from the frame richText, then plain text', () => {
    const doc = twoTextFrames(createDocument('threads', true));
    expect(storySeedForFrame(doc, 'f1').paragraphs[0]!.runs[0]!.text).toBe('text f1');
  });
});
