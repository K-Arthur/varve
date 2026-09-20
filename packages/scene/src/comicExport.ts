import { flattenRichText } from './comicWorkflow';
import type { Document } from './document';
import type { NodeId, Page, TextStory } from './types';

export interface WebtoonSlice {
  index: number;
  sourcePageId?: NodeId;
  sourceY: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export interface ComicExportPlan {
  pageIds: NodeId[];
  readingDirection: 'ltr' | 'rtl';
  webtoonSlices?: WebtoonSlice[];
  transcript?: string;
}

export interface WebtoonSliceOptions {
  outputWidth: number;
  maxHeight: number;
  /** Preserve page boundaries where possible; never adds pasteboard gaps. */
  preservePageBoundaries?: boolean;
}

/** Plan deterministic vertical slices without allocating or rendering pixels. */
export function planWebtoonSlices(
  pages: readonly Pick<Page, 'id' | 'width' | 'height'>[],
  options: WebtoonSliceOptions,
): WebtoonSlice[] {
  const outputWidth = Math.max(1, Math.floor(options.outputWidth));
  const maxHeight = Math.max(1, Math.floor(options.maxHeight));
  const slices: WebtoonSlice[] = [];
  let index = 0;
  for (const page of pages) {
    const scale = outputWidth / Math.max(1, page.width);
    let sourceY = 0;
    while (sourceY < page.height) {
      const remaining = page.height - sourceY;
      const sourceHeight = Math.min(remaining, maxHeight / scale);
      slices.push({
        index,
        sourcePageId: page.id,
        sourceY,
        sourceHeight,
        outputWidth,
        outputHeight: Math.max(1, Math.round(sourceHeight * scale)),
      });
      index++;
      sourceY += sourceHeight;
    }
  }
  return slices;
}

export function flattenStoryText(story: TextStory): string {
  return flattenRichText(story.content);
}

/** Generate a plain transcript in explicit outline order. */
export function buildDialogueTranscript(
  doc: Document,
  entries = doc.storyOutline?.entries ?? [],
): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const pageName = doc.pages?.find((page) => page.id === entry.pageId)?.name ?? entry.pageId;
    lines.push(`# ${pageName}`);
    for (const storyId of entry.dialogueStoryIds) {
      const story = doc.stories?.[storyId];
      if (!story) continue;
      const speaker = story.speaker ? `${story.speaker}: ` : '';
      lines.push(`${speaker}${flattenStoryText(story)}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function createComicExportPlan(doc: Document, pageIds?: readonly NodeId[]): ComicExportPlan {
  const pages = (doc.pages ?? []).filter((page) => !page.printSettings?.excludeFromExport);
  const ordered = pageIds
    ? pages.filter((page) => pageIds.includes(page.id))
    : [...pages].sort((a, b) => (a.order < b.order ? -1 : 1));
  const readingDirection =
    doc.readingDirection ?? (doc.workflowProfile === 'manga' ? 'rtl' : 'ltr');
  return {
    pageIds: ordered.map((page) => page.id),
    readingDirection,
    transcript: doc.storyOutline ? buildDialogueTranscript(doc) : undefined,
  };
}
