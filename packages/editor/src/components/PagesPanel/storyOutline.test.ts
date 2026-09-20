import type { Document, NodeId, StoryOutlineEntry } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  collectPageSubtreeIds,
  linkPageDialogue,
  linkPagePanels,
  pageDialogueStoryIds,
  pagePanelIdsInReadingOrder,
} from './storyOutline';

function frame(id: string, x: number, y: number, panel = true) {
  return {
    id,
    kind: 'frame' as const,
    name: id,
    transform: [1, 0, 0, 1, x, y],
    w: 200,
    h: 300,
    children: [],
    ...(panel ? { panel: { version: 1, panelId: id } } : {}),
  };
}

function group(id: string, children: string[]) {
  return { id, kind: 'group' as const, name: id, children, transform: [1, 0, 0, 1, 0, 0] };
}

function text(id: string, storyId?: string) {
  return {
    id,
    kind: 'text' as const,
    name: id,
    transform: [1, 0, 0, 1, 0, 0],
    ...(storyId ? { storyBinding: { storyId, threadIndex: 0 } } : {}),
  };
}

function makeDoc(): Document {
  const nodes: Record<string, unknown> = {
    root: group('root', ['tierA', 'tierB']),
    tierA: group('tierA', ['p1', 'p2', 'art']),
    tierB: group('tierB', ['p3']),
    p1: frame('p1', 0, 0),
    p2: frame('p2', 200, 0),
    p3: frame('p3', 0, 400),
    art: frame('art', 0, 0, false),
    cap: text('cap', 'story-a'),
    line2: text('line2', 'story-b'),
    line1: text('line1', 'story-a'),
    sfx: text('sfx'),
  };
  // Place the text nodes inside panels so DFS paint order is deterministic.
  (nodes.p1 as { children: string[] }).children = ['line1', 'cap'];
  (nodes.p2 as { children: string[] }).children = ['line2', 'sfx'];
  return {
    id: 'doc',
    name: 'Comic',
    nodes,
    pages: [
      {
        id: 'page-1',
        name: 'Page 1',
        order: 'a0',
        width: 600,
        height: 800,
        backgrounds: [],
        contentRoot: 'root',
      },
    ],
    activePageId: 'page-1',
    stories: {
      'story-a': { id: 'story-a', name: 'Story A', thread: [], speaker: 'Ava' },
      'story-b': { id: 'story-b', name: 'Story B', thread: [], speaker: 'Bo' },
    },
    readingDirection: 'ltr',
  } as unknown as Document;
}

describe('storyOutline helpers', () => {
  it('collects the page subtree in depth-first paint order without revisiting', () => {
    const doc = makeDoc();
    expect(collectPageSubtreeIds(doc, 'page-1')).toEqual([
      'root',
      'tierA',
      'p1',
      'line1',
      'cap',
      'p2',
      'line2',
      'sfx',
      'art',
      'tierB',
      'p3',
    ]);
    expect(collectPageSubtreeIds(doc, null)).toEqual([]);
    expect(collectPageSubtreeIds(doc, 'missing')).toEqual([]);
  });

  it('returns only semantic panels, ordered by tier and reading direction', () => {
    const doc = makeDoc();
    expect(pagePanelIdsInReadingOrder(doc, 'page-1', 'ltr')).toEqual(['p1', 'p2', 'p3']);
    expect(pagePanelIdsInReadingOrder(doc, 'page-1', 'rtl')).toEqual(['p2', 'p1', 'p3']);
  });

  it('collects unique dialogue stories in paint order and ignores unbound text', () => {
    const doc = makeDoc();
    expect(pageDialogueStoryIds(doc, 'page-1')).toEqual(['story-a', 'story-b']);
  });

  it('links page panels and dialogue without touching other entry fields', () => {
    const doc = makeDoc();
    const entry: StoryOutlineEntry = {
      id: 'outline-page-1',
      pageId: 'page-1',
      title: 'The chase',
      status: 'rough',
      notes: 'keep',
      panelIds: ['stale'],
      dialogueStoryIds: ['stale'],
    };
    const withPanels = linkPagePanels(entry, doc, 'rtl');
    expect(withPanels.panelIds).toEqual(['p2', 'p1', 'p3']);
    expect(withPanels.title).toBe('The chase');
    expect(withPanels.dialogueStoryIds).toEqual(['stale']);
    const withDialogue = linkPageDialogue(entry, doc);
    expect(withDialogue.dialogueStoryIds).toEqual(['story-a', 'story-b']);
    expect(withDialogue.panelIds).toEqual(['stale']);
  });

  it('keeps an empty link result rather than inventing references', () => {
    const doc = makeDoc();
    const empty = { ...doc, nodes: { ...doc.nodes }, pages: [] } as Document;
    const entry: StoryOutlineEntry = {
      id: 'outline-page-1',
      pageId: 'page-1',
      status: 'planned',
      panelIds: ['stale'],
      dialogueStoryIds: ['stale'],
    };
    expect(linkPagePanels(entry, empty, 'ltr').panelIds).toEqual([]);
    expect(linkPageDialogue(entry, empty).dialogueStoryIds).toEqual([]);
  });
});

describe('storyOutline helper types', () => {
  it('keeps node ids typed', () => {
    const id: NodeId = 'p1';
    expect(id).toBe('p1');
  });
});
