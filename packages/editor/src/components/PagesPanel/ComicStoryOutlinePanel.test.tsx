// @ts-nocheck
/**
 * ComicStoryOutlinePanel — the story outline is a reference record over the
 * page: it must use the shared Select (never a native <select>), derive panel
 * and dialogue links from the document, and never copy text or geometry.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../context', () => ({
  useEditor: vi.fn(),
}));

import type { Document } from '@varve/scene';
import { useEditor } from '../../context';
import { ComicStoryOutlinePanel } from './ComicStoryOutlinePanel';

function makeDoc(): Document {
  return {
    id: 'doc',
    name: 'Comic',
    nodes: {
      root: {
        id: 'root',
        kind: 'group',
        name: 'root',
        children: ['p1'],
        transform: [1, 0, 0, 1, 0, 0],
      },
      p1: {
        id: 'p1',
        kind: 'frame',
        name: 'Panel 1',
        children: ['line'],
        transform: [1, 0, 0, 1, 0, 0],
        w: 200,
        h: 300,
        panel: { version: 1, panelId: 'p1' },
      },
      line: {
        id: 'line',
        kind: 'text',
        name: 'line',
        transform: [1, 0, 0, 1, 0, 0],
        storyBinding: { storyId: 'story-a', threadIndex: 0 },
      },
    },
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
    stories: { 'story-a': { id: 'story-a', name: 'Story A', thread: [], speaker: 'Ava' } },
    workflowProfile: 'comic-print',
    readingDirection: 'ltr',
    storyOutline: {
      version: 1,
      entries: [
        {
          id: 'outline-page-1',
          pageId: 'page-1',
          title: 'The chase',
          status: 'rough',
          panelIds: [],
          dialogueStoryIds: [],
        },
      ],
    },
  } as unknown as Document;
}

function mockEditor(doc: Document, updateDoc = vi.fn()) {
  vi.mocked(useEditor).mockReturnValue({
    state: { document: doc, workspaceMode: 'drawing' },
    updateDoc,
  } as unknown as ReturnType<typeof useEditor>);
  return updateDoc;
}

describe('ComicStoryOutlinePanel', () => {
  it('renders no native select and uses the shared controls', () => {
    mockEditor(makeDoc());
    const { container } = render(<ComicStoryOutlinePanel />);
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: /status/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link page panels/i })).toBeTruthy();
  });

  it('links page panels and dialogue through the page, not copied state', () => {
    const doc = makeDoc();
    const updateDoc = mockEditor(doc);
    render(<ComicStoryOutlinePanel />);
    fireEvent.click(screen.getByRole('button', { name: /link page panels/i }));
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const next = updateDoc.mock.calls[0][0](doc);
    expect(next.storyOutline.entries[0].panelIds).toEqual(['p1']);
    expect(next.storyOutline.entries[0].title).toBe('The chase');

    fireEvent.click(screen.getByRole('button', { name: /link page dialogue/i }));
    const nextDialogue = updateDoc.mock.calls[1][0](doc);
    expect(nextDialogue.storyOutline.entries[0].dialogueStoryIds).toEqual(['story-a']);
  });

  it('does not render for a document without a comic profile', () => {
    const doc = { ...makeDoc(), workflowProfile: undefined } as Document;
    mockEditor(doc);
    const { container } = render(<ComicStoryOutlinePanel />);
    expect(container.firstChild).toBeNull();
  });
});
