import type { FontReference } from '@varve/engine';
import type { Document, SceneNode, TextNode } from '@varve/scene';

export interface DocumentFontUsage {
  /** Stable display/group key. Exact artifact members never collapse by family. */
  key: string;
  family: string;
  weight?: number;
  style?: 'normal' | 'italic';
  fontReference?: FontReference;
  /** Face-level label when the document carries a PostScript name. */
  faceLabel?: string;
  nodeIds: string[];
  styleIds: string[];
  locations: string[];
  totalCharacters: number;
  /** True when this row is an unreferenced style with no authored text usage. */
  unusedStyle: boolean;
}

export interface DocumentFontUsageOptions {
  /** Restrict text usage to a content-root subtree, normally the active page. */
  rootId?: string;
}

interface FontFormat {
  fontFamily?: string;
  fontReference?: FontReference;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

interface UsageCandidate extends FontFormat {
  family?: string;
}

interface StoryContent {
  paragraphs?: Array<{
    runs?: Array<{ text?: string; format?: FontFormat }>;
  }>;
}

interface StoryRecord {
  content?: StoryContent;
}

function isTextNode(node: SceneNode): node is TextNode {
  return node.kind === 'text';
}

function countCharacters(text: string): number {
  return Array.from(text.replace(/[\u200B-\u200D\uFEFF]/g, '')).length;
}

function referenceKey(reference: FontReference | undefined): string {
  if (!reference) return 'family';
  const member = reference.collectionIndex === undefined ? 'single' : reference.collectionIndex;
  return `sha256:${reference.artifactHash.toLowerCase()}:${member}`;
}

function candidateKey(candidate: UsageCandidate): string {
  return [
    candidate.family?.trim().toLowerCase() ?? '',
    referenceKey(candidate.fontReference),
    candidate.fontWeight ?? '',
    candidate.fontStyle ?? '',
  ].join('|');
}

function textStyleFor(doc: Document, node: TextNode): FontFormat {
  const style = node.styleId ? doc.styles?.[node.styleId] : undefined;
  if (style?.type !== 'text') return {};
  return {
    fontFamily: style.fontFamily,
    fontReference: style.fontReference,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
  };
}

function mergeFormat(base: FontFormat, override?: FontFormat): UsageCandidate {
  return {
    family: override?.fontFamily ?? base.fontFamily,
    fontFamily: override?.fontFamily ?? base.fontFamily,
    fontReference: override?.fontReference ?? base.fontReference,
    fontWeight: override?.fontWeight ?? base.fontWeight,
    fontStyle: override?.fontStyle ?? base.fontStyle,
  };
}

function childrenOf(node: SceneNode): string[] {
  const children = (node as SceneNode & { children?: unknown }).children;
  return Array.isArray(children)
    ? children.filter((id): id is string => typeof id === 'string')
    : [];
}

function locationRoots(doc: Document): Map<string, string> {
  const roots = new Map<string, string>();
  for (const page of doc.pages ?? []) roots.set(page.contentRoot, page.name);
  for (const canvas of doc.designCanvases ?? []) roots.set(canvas.contentRoot, canvas.name);
  return roots;
}

function parentMap(doc: Document): Map<string, string> {
  const parents = new Map<string, string>();
  for (const node of Object.values(doc.nodes)) {
    for (const childId of childrenOf(node)) {
      if (!parents.has(childId)) parents.set(childId, node.id);
    }
  }
  return parents;
}

function locationFor(
  nodeId: string,
  parents: Map<string, string>,
  roots: Map<string, string>,
): string {
  let current: string | undefined = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const label = roots.get(current);
    if (label) return label;
    current = parents.get(current);
  }
  return 'Document';
}

function isVisibleAndUnlocked(
  nodeId: string,
  doc: Document,
  parents: Map<string, string>,
): boolean {
  let current: string | undefined = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = doc.nodes[current];
    if (!node || node.visible === false || node.locked === true) return false;
    current = parents.get(current);
  }
  return true;
}

function isWithinRoot(
  nodeId: string,
  rootId: string | undefined,
  parents: Map<string, string>,
): boolean {
  if (!rootId) return true;
  let current: string | undefined = nodeId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === rootId) return true;
    visited.add(current);
    current = parents.get(current);
  }
  return false;
}

/**
 * Build the editor-facing document font usage projection.
 *
 * This deliberately resolves authored fallback in the same order as text
 * rendering: run format, node value, then a linked text style. A story is
 * counted once while every visible frame remains a selectable location.
 */
export function buildDocumentFontUsage(
  doc: Document,
  options: DocumentFontUsageOptions = {},
): DocumentFontUsage[] {
  const parents = parentMap(doc);
  const roots = locationRoots(doc);
  const usage = new Map<string, DocumentFontUsage>();
  const processedStories = new Set<string>();
  const visibleStoryFrames = new Map<string, string[]>();

  // Collect every visible frame before consuming story content. A story can
  // start on another page and continue on this one; counting it from the first
  // frame would otherwise omit later selectable locations.
  for (const node of Object.values(doc.nodes)) {
    if (!isTextNode(node) || !node.storyBinding) continue;
    if (!isWithinRoot(node.id, options.rootId, parents)) continue;
    if (!isVisibleAndUnlocked(node.id, doc, parents)) continue;
    const frames = visibleStoryFrames.get(node.storyBinding.storyId) ?? [];
    if (!frames.includes(node.id)) frames.push(node.id);
    visibleStoryFrames.set(node.storyBinding.storyId, frames);
  }

  const ensure = (candidate: UsageCandidate, location: string, styleId?: string) => {
    const family = candidate.family?.trim();
    if (!family) return undefined;
    const key = candidateKey({ ...candidate, family });
    let entry = usage.get(key);
    if (!entry) {
      entry = {
        key,
        family,
        ...(candidate.fontWeight !== undefined ? { weight: candidate.fontWeight } : {}),
        ...(candidate.fontStyle !== undefined ? { style: candidate.fontStyle } : {}),
        ...(candidate.fontReference ? { fontReference: candidate.fontReference } : {}),
        ...(candidate.fontReference?.postScriptName
          ? { faceLabel: candidate.fontReference.postScriptName }
          : {}),
        nodeIds: [],
        styleIds: [],
        locations: [],
        totalCharacters: 0,
        unusedStyle: false,
      };
      usage.set(key, entry);
    }
    if (styleId && !entry.styleIds.includes(styleId)) entry.styleIds.push(styleId);
    if (!entry.locations.includes(location)) entry.locations.push(location);
    return entry;
  };

  const addText = (
    candidate: UsageCandidate,
    nodeIds: string[],
    location: string,
    text: string,
    styleId?: string,
  ) => {
    const entry = ensure(candidate, location, styleId);
    if (!entry) return;
    for (const nodeId of nodeIds) if (!entry.nodeIds.includes(nodeId)) entry.nodeIds.push(nodeId);
    entry.totalCharacters += countCharacters(text);
  };

  for (const node of Object.values(doc.nodes)) {
    if (!isTextNode(node)) continue;
    if (!isWithinRoot(node.id, options.rootId, parents)) continue;
    if (!isVisibleAndUnlocked(node.id, doc, parents)) continue;

    const location = locationFor(node.id, parents, roots);
    const style = textStyleFor(doc, node);
    const base = mergeFormat(
      {
        fontFamily: style.fontFamily ?? node.fontFamily,
        fontReference: style.fontReference ?? node.fontReference,
        fontWeight: style.fontWeight ?? node.fontWeight,
        fontStyle: style.fontStyle ?? node.fontStyle,
      },
      undefined,
    );
    const styleId = node.styleId;
    const storyId = node.storyBinding?.storyId;
    const storyRecord = storyId ? (doc.stories?.[storyId] as StoryRecord | undefined) : undefined;
    const story = storyRecord?.content;
    if (storyId && story && processedStories.has(storyId)) continue;
    if (storyId) processedStories.add(storyId);

    const richText = story ?? (node.richText as StoryContent | undefined);
    const paragraphs = richText?.paragraphs ?? [];
    if (paragraphs.length > 0) {
      for (const paragraph of paragraphs) {
        for (const run of paragraph.runs ?? []) {
          const candidate = mergeFormat(base, run.format);
          const frameIds = storyId ? (visibleStoryFrames.get(storyId) ?? [node.id]) : [node.id];
          const storyLocations = storyId
            ? frameIds.map((id) => locationFor(id, parents, roots))
            : [location];
          addText(
            candidate,
            storyId ? frameIds : [node.id],
            storyLocations[0] ?? location,
            run.text ?? '',
            styleId,
          );
          for (const storyLocation of storyLocations.slice(1))
            ensure(candidate, storyLocation, styleId);
        }
      }
      continue;
    }
    const frameIds = storyId ? (visibleStoryFrames.get(storyId) ?? [node.id]) : [node.id];
    const locations = storyId ? frameIds.map((id) => locationFor(id, parents, roots)) : [location];
    addText(
      base,
      storyId ? frameIds : [node.id],
      locations[0] ?? location,
      node.text ?? '',
      styleId,
    );
    for (const storyLocation of locations.slice(1)) ensure(base, storyLocation, styleId);
  }

  // Keep styles visible even when no current text uses them, so cleanup and
  // replacement workflows can distinguish an unused style from an empty scan.
  for (const [styleId, style] of Object.entries(doc.styles ?? {})) {
    if (style.type !== 'text' || !style.fontFamily) continue;
    const candidate: UsageCandidate = {
      family: style.fontFamily,
      fontFamily: style.fontFamily,
      fontReference: style.fontReference,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
    };
    const entry = ensure(candidate, 'Unused styles', styleId);
    if (entry && entry.nodeIds.length === 0) entry.unusedStyle = true;
  }

  return [...usage.values()]
    .map((entry) => ({
      ...entry,
      nodeIds: [...entry.nodeIds],
      styleIds: [...entry.styleIds],
      locations: [...entry.locations],
    }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.key.localeCompare(b.key));
}
