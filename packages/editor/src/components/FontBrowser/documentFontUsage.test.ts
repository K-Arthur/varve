import { type Document, makeFrameNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildDocumentFontUsage } from './documentFontUsage';

function fixture(): Document {
  return {
    id: 'usage-doc',
    formatVersion: '2.27',
    name: 'Usage fixture',
    nextId: 10,
    rootChildren: ['page-root', 'other-root'],
    nodes: {
      'page-root': {
        id: 'page-root',
        kind: 'group',
        name: 'Page root',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        children: ['title', 'story-a', 'hidden-copy', 'locked-copy'],
      },
      'other-root': {
        id: 'other-root',
        kind: 'group',
        name: 'Other root',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        children: ['other-text'],
      },
      title: {
        id: 'title',
        kind: 'text',
        name: 'Title',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Hello',
        fontSize: 16,
        fontFamily: 'Inter',
        fontWeight: 700,
        fontStyle: 'normal',
        strokes: [],
        effects: [],
      },
      'story-a': {
        id: 'story-a',
        kind: 'text',
        name: 'Story frame',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        text: '',
        fontSize: 16,
        fontFamily: 'Inter',
        storyBinding: { storyId: 'story-1', threadIndex: 0 },
        strokes: [],
        effects: [],
      },
      'hidden-copy': {
        id: 'hidden-copy',
        kind: 'text',
        name: 'Hidden',
        visible: false,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Hidden',
        fontSize: 16,
        fontFamily: 'Hidden Family',
        strokes: [],
        effects: [],
      },
      'locked-copy': {
        id: 'locked-copy',
        kind: 'text',
        name: 'Locked',
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Locked',
        fontSize: 16,
        fontFamily: 'Locked Family',
        strokes: [],
        effects: [],
      },
      'other-text': {
        id: 'other-text',
        kind: 'text',
        name: 'Other',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        text: 'Other',
        fontSize: 16,
        fontFamily: 'Other Family',
        strokes: [],
        effects: [],
      },
    },
    pages: [
      {
        id: 'page-1',
        name: 'Page one',
        width: 800,
        height: 600,
        order: 'a0',
        backgrounds: [],
        contentRoot: 'page-root',
      },
    ],
    activePageId: 'page-1',
    components: {},
    styles: {
      styleUnused: {
        id: 'styleUnused',
        type: 'text',
        name: 'Unused',
        fontFamily: 'Unused Family',
        fontSize: 16,
      },
    },
    stories: {
      'story-1': {
        id: 'story-1',
        name: 'Story',
        content: {
          paragraphs: [{ runs: [{ text: 'Story text', format: { fontFamily: 'Story Family' } }] }],
        },
        thread: ['story-a'],
      },
    },
  } as unknown as Document;
}

describe('buildDocumentFontUsage', () => {
  it('scopes to the current page and excludes hidden and locked text', () => {
    const usage = buildDocumentFontUsage(fixture(), { rootId: 'page-root' });
    expect(usage.map((entry) => entry.family)).toEqual(['Inter', 'Story Family', 'Unused Family']);
    expect(usage.find((entry) => entry.family === 'Other Family')).toBeUndefined();
    expect(usage.find((entry) => entry.family === 'Hidden Family')).toBeUndefined();
    expect(usage.find((entry) => entry.family === 'Locked Family')).toBeUndefined();
  });

  it('keeps style-only rows separate and counts story content once', () => {
    const usage = buildDocumentFontUsage(fixture(), { rootId: 'page-root' });
    const story = usage.find((entry) => entry.family === 'Story Family');
    expect(story?.totalCharacters).toBe(10);
    expect(story?.nodeIds).toEqual(['story-a']);
    const unused = usage.find((entry) => entry.family === 'Unused Family');
    expect(unused?.unusedStyle).toBe(true);
    expect(unused?.styleIds).toEqual(['styleUnused']);
  });

  it('keeps exact artifact members distinct from family-only requests', () => {
    const doc = fixture();
    const title = doc.nodes.title as Extract<(typeof doc.nodes)[string], { kind: 'text' }>;
    title.fontReference = {
      artifactHash: 'a'.repeat(64),
      postScriptName: 'Inter-Bold',
    };
    const usage = buildDocumentFontUsage(doc, { rootId: 'page-root' });
    expect(usage.filter((entry) => entry.family === 'Inter')).toHaveLength(1);
    expect(usage.find((entry) => entry.family === 'Inter')?.fontReference?.artifactHash).toBe(
      'a'.repeat(64),
    );
  });

  it('uses effective component variants for visibility and rendered text', () => {
    const doc = fixture();
    const pageRoot = doc.nodes['page-root'];
    if (pageRoot?.kind !== 'group') throw new Error('fixture page root missing');

    const instanceLabel = {
      ...(doc.nodes.title as Extract<(typeof doc.nodes)[string], { kind: 'text' }>),
      id: 'instance-label',
      name: 'Label',
      text: 'Authored label',
      fontFamily: 'Component Family',
    };
    const instance = makeFrameNode('component-instance', {
      name: 'Button instance',
      w: 120,
      h: 40,
      children: ['instance-label'],
      componentId: 'component-1',
      variant: 'hidden-label',
    });
    doc.nodes['component-instance'] = instance;
    doc.nodes['instance-label'] = instanceLabel;
    pageRoot.children = [...pageRoot.children, 'component-instance'];
    doc.components = {
      'component-1': {
        id: 'component-1',
        name: 'Button',
        masterRootId: 'component-master',
        slots: [],
        properties: [{ id: 'label-visible', name: 'Label', type: 'boolean', defaultValue: true }],
        variants: [
          {
            id: 'hidden-label',
            name: 'Hidden label',
            propertyValues: { Label: false },
          },
        ],
      },
    };

    const hiddenUsage = buildDocumentFontUsage(doc, { rootId: 'page-root' });
    expect(hiddenUsage.find((entry) => entry.family === 'Component Family')).toBeUndefined();

    const visibleDoc: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        'component-instance': { ...instance, variant: undefined },
      },
    };
    const visibleUsage = buildDocumentFontUsage(visibleDoc, { rootId: 'page-root' });
    const componentEntry = visibleUsage.find((entry) => entry.family === 'Component Family');
    expect(componentEntry?.nodeIds).toEqual(['instance-label']);
    expect(componentEntry?.totalCharacters).toBe('Authored label'.length);
  });
});
