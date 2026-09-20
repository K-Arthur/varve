import { describe, expect, it } from 'vitest';
import { buildDialogueTranscript, planWebtoonSlices } from './comicExport';
import { createDocument } from './document';

describe('comic export planning', () => {
  it('plans contiguous webtoon slices with no page gap', () => {
    const slices = planWebtoonSlices([{ id: 'page-1', width: 1600, height: 3000 }], {
      outputWidth: 800,
      maxHeight: 1280,
    });
    expect(slices.map((slice) => slice.outputHeight)).toEqual([1280, 220]);
    expect(slices[1]?.sourceY).toBe(slices[0]!.sourceHeight);
  });

  it('builds an ordered transcript from authoritative stories', () => {
    const doc = createDocument('transcript');
    const pageId = doc.pages?.[0]?.id ?? 'page';
    const withStory = {
      ...doc,
      stories: {
        story: {
          id: 'story',
          name: 'Dialogue',
          speaker: 'A',
          content: { paragraphs: [{ runs: [{ text: 'Hello' }] }] },
          thread: [],
        },
      },
      storyOutline: {
        version: 1 as const,
        entries: [
          {
            id: 'entry',
            pageId,
            status: 'lettered' as const,
            panelIds: [],
            dialogueStoryIds: ['story'],
          },
        ],
      },
    };
    expect(buildDialogueTranscript(withStory)).toContain('A: Hello');
  });
});
