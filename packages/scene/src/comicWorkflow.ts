import type { Document } from './document';
import type {
  ComicProductionStatus,
  ComicPublishingTarget,
  ComicReadingDirection,
  ComicWorkflowProfile,
  FrameNode,
  NodeId,
  PanelMetadata,
  RichText,
  RubyAnnotation,
  StoryOutline,
  StoryOutlineEntry,
} from './types';

export interface ComicProfileDefaults {
  profile: ComicWorkflowProfile;
  width: number;
  height: number;
  unit: 'px' | 'mm';
  colorMode: 'rgb' | 'grayscale';
  paintingPpi: number;
  readingDirection: ComicReadingDirection;
  publishingTarget: ComicPublishingTarget;
}

/** Defaults are starting points, not printer or platform requirements. */
export const COMIC_PROFILE_DEFAULTS: Record<ComicWorkflowProfile, ComicProfileDefaults> = {
  'comic-print': {
    profile: 'comic-print',
    width: 210,
    height: 297,
    unit: 'mm',
    colorMode: 'rgb',
    paintingPpi: 300,
    readingDirection: 'ltr',
    publishingTarget: 'print',
  },
  manga: {
    profile: 'manga',
    width: 148,
    height: 210,
    unit: 'mm',
    colorMode: 'grayscale',
    paintingPpi: 600,
    readingDirection: 'rtl',
    publishingTarget: 'print',
  },
  'webtoon-vertical': {
    profile: 'webtoon-vertical',
    width: 1600,
    height: 8000,
    unit: 'px',
    colorMode: 'rgb',
    paintingPpi: 96,
    readingDirection: 'ltr',
    publishingTarget: 'webtoon',
  },
};

export interface ComicWorkflowIssue {
  code: 'missing-page' | 'missing-panel' | 'missing-story' | 'duplicate-panel-order';
  entryId: string;
  reference?: string;
  message: string;
}

export interface ComicPublisherProfile {
  id: 'webtoon' | 'tapas';
  label: string;
  source: string;
  sourcePublicationDate: string;
  verifiedAt: string;
  maxSliceWidth?: number;
  maxSliceHeight?: number;
  maxFileBytes?: number;
  maxEpisodeBytes?: number;
  maxImages?: number;
  /** A platform default that remains editable in the export UI. */
  defaultSliceHeight?: number;
}

/** Publisher limits are provenance-bearing defaults, never hidden encoders. */
export const COMIC_PUBLISHER_PROFILES: Record<ComicPublisherProfile['id'], ComicPublisherProfile> =
  {
    webtoon: {
      id: 'webtoon',
      label: 'WEBTOON CANVAS',
      source:
        'https://webtoons-static.pstatic.net/creator101/en/pdf/Before-You-Publish-Checklist-2024.pdf?dt=2024011001',
      sourcePublicationDate: '2024',
      verifiedAt: '2026-09-19',
      maxSliceWidth: 800,
      maxSliceHeight: 1280,
      maxFileBytes: 2_000_000,
      maxEpisodeBytes: 20_000_000,
      maxImages: 100,
      defaultSliceHeight: 1280,
    },
    tapas: {
      id: 'tapas',
      label: 'Tapas',
      source:
        'https://help.tapas.io/hc/en-us/articles/1260802028970-Series-Basics-How-to-publish-a-comic-episode-on-Tapas',
      sourcePublicationDate: 'current',
      verifiedAt: '2026-09-19',
      maxSliceWidth: 940,
      maxFileBytes: 10_000_000,
      defaultSliceHeight: 2048,
    },
  };

export interface ComicArtifactInfo {
  width: number;
  height: number;
  byteLength: number;
}

export interface ComicPublisherIssue {
  code: 'width' | 'height' | 'file-bytes' | 'episode-bytes' | 'image-count';
  message: string;
}

export function validateComicPublisherArtifacts(
  profile: ComicPublisherProfile,
  artifacts: readonly ComicArtifactInfo[],
): ComicPublisherIssue[] {
  const issues: ComicPublisherIssue[] = [];
  let episodeBytes = 0;
  for (const [index, artifact] of artifacts.entries()) {
    episodeBytes += artifact.byteLength;
    if (profile.maxSliceWidth !== undefined && artifact.width > profile.maxSliceWidth) {
      issues.push({
        code: 'width',
        message: `Image ${index + 1} is ${artifact.width}px wide; ${profile.label} allows ${profile.maxSliceWidth}px.`,
      });
    }
    if (profile.maxSliceHeight !== undefined && artifact.height > profile.maxSliceHeight) {
      issues.push({
        code: 'height',
        message: `Image ${index + 1} is ${artifact.height}px tall; ${profile.label} allows ${profile.maxSliceHeight}px.`,
      });
    }
    if (profile.maxFileBytes !== undefined && artifact.byteLength > profile.maxFileBytes) {
      issues.push({
        code: 'file-bytes',
        message: `Image ${index + 1} is ${artifact.byteLength} bytes; ${profile.label} allows ${profile.maxFileBytes} bytes.`,
      });
    }
  }
  if (profile.maxEpisodeBytes !== undefined && episodeBytes > profile.maxEpisodeBytes) {
    issues.push({
      code: 'episode-bytes',
      message: `Episode is ${episodeBytes} bytes; ${profile.label} allows ${profile.maxEpisodeBytes} bytes.`,
    });
  }
  if (profile.maxImages !== undefined && artifacts.length > profile.maxImages) {
    issues.push({
      code: 'image-count',
      message: `Episode has ${artifacts.length} images; ${profile.label} allows ${profile.maxImages}.`,
    });
  }
  return issues;
}

export function applyComicWorkflowProfile(doc: Document, profile: ComicWorkflowProfile): Document {
  const defaults = COMIC_PROFILE_DEFAULTS[profile];
  return {
    ...doc,
    workflowProfile: profile,
    paintingPpi: defaults.paintingPpi,
    readingDirection: defaults.readingDirection,
    publishingTarget: defaults.publishingTarget,
  };
}

export function ensureStoryOutline(doc: Document): StoryOutline {
  return doc.storyOutline ?? { version: 1, entries: [] };
}

export function upsertStoryOutlineEntry(
  doc: Document,
  entry: Omit<StoryOutlineEntry, 'id'> & { id?: string },
): Document {
  const outline = ensureStoryOutline(doc);
  const id = entry.id ?? `outline-${outline.entries.length + 1}`;
  const nextEntry: StoryOutlineEntry = { ...entry, id };
  const entries = outline.entries.some((candidate) => candidate.id === id)
    ? outline.entries.map((candidate) => (candidate.id === id ? nextEntry : candidate))
    : [...outline.entries, nextEntry];
  return {
    ...doc,
    storyOutline: { version: 1, entries, updatedAt: Date.now() },
  };
}

export function setStoryStatus(
  doc: Document,
  entryId: string,
  status: ComicProductionStatus,
): Document {
  const outline = ensureStoryOutline(doc);
  if (!outline.entries.some((entry) => entry.id === entryId)) return doc;
  return {
    ...doc,
    storyOutline: {
      ...outline,
      entries: outline.entries.map((entry) =>
        entry.id === entryId ? { ...entry, status } : entry,
      ),
      updatedAt: Date.now(),
    },
  };
}

/** Rebase ruby ranges after a single text edit without inventing readings. */
export function rebaseRubyAnnotations(
  previous: string,
  next: string,
  annotations: readonly RubyAnnotation[],
): RubyAnnotation[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix++;
  }
  const previousChangedEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  return annotations.map((annotation) => {
    const overlaps = annotation.start < previousChangedEnd && annotation.end > prefix;
    const shift = annotation.start >= previousChangedEnd ? delta : 0;
    const start = Math.max(0, Math.min(next.length, annotation.start + shift));
    const end = Math.max(
      start,
      Math.min(next.length, annotation.end + shift + (overlaps ? delta : 0)),
    );
    return { ...annotation, start, end, ...(overlaps ? { stale: true } : {}) };
  });
}

/** Flatten rich text using the same UTF-16 paragraph contract as ruby ranges. */
export function flattenRichText(richText: RichText): string {
  return richText.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n');
}

/** Stable panel metadata is the authority for reading order; names and paint order are not. */
export function panelMetadata(
  panelId: string,
  options: Partial<Omit<PanelMetadata, 'version' | 'panelId'>> = {},
): PanelMetadata {
  return { version: 1, panelId, ...options };
}

export function orderedPanelsForEntry(doc: Document, entry: StoryOutlineEntry): NodeId[] {
  return entry.panelIds.filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'frame' && Boolean((node as FrameNode).panel);
  });
}

export function validateComicWorkflow(doc: Document): ComicWorkflowIssue[] {
  const issues: ComicWorkflowIssue[] = [];
  for (const entry of doc.storyOutline?.entries ?? []) {
    if (!doc.pages?.some((page) => page.id === entry.pageId)) {
      issues.push({
        code: 'missing-page',
        entryId: entry.id,
        reference: entry.pageId,
        message: 'Outline entry references a missing page.',
      });
    }
    const seenPanels = new Set<NodeId>();
    for (const panelId of entry.panelIds) {
      if (seenPanels.has(panelId)) {
        issues.push({
          code: 'duplicate-panel-order',
          entryId: entry.id,
          reference: panelId,
          message: 'Panel appears more than once in reading order.',
        });
      }
      seenPanels.add(panelId);
      const panel = doc.nodes[panelId];
      if (panel?.kind !== 'frame' || !(panel as FrameNode).panel) {
        issues.push({
          code: 'missing-panel',
          entryId: entry.id,
          reference: panelId,
          message: 'Outline entry references a missing or non-panel frame.',
        });
      }
    }
    for (const storyId of entry.dialogueStoryIds) {
      if (!doc.stories?.[storyId]) {
        issues.push({
          code: 'missing-story',
          entryId: entry.id,
          reference: storyId,
          message: 'Dialogue order references a missing text story.',
        });
      }
    }
  }
  return issues;
}

export function estimatePanelSplitRasterBytes(
  doc: Document,
  sourceChildren: readonly NodeId[],
  destinationCount: number,
): number {
  if (destinationCount <= 1) return 0;
  let sourceBytes = 0;
  for (const id of sourceChildren) {
    const node = doc.nodes[id];
    if (node?.kind === 'rasterLayer')
      sourceBytes += Math.max(1, node.width) * Math.max(1, node.height) * 4;
  }
  return sourceBytes * (destinationCount - 1);
}
