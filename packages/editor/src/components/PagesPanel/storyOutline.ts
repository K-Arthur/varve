/**
 * Story-outline data assembly for the Pages panel.
 *
 * The outline entry is a reference record: it stores panel ids in reading
 * order and dialogue story ids, never copies of text or geometry. These pure
 * helpers derive those references from the active publishing page so the panel
 * UI stays thin and the derivation is unit-testable without a DOM.
 */
import type { Document, NodeId, StoryOutlineEntry, TextNode } from '@varve/scene';
import { orderPanelIds, type PanelReadingDirection } from '../../scene/panelLayout';

/** Depth-first paint-order node ids under a publishing page's content root. */
export function collectPageSubtreeIds(doc: Document, pageId: string | null | undefined): NodeId[] {
  if (!pageId) return [];
  const page = doc.pages?.find((candidate) => candidate.id === pageId);
  if (!page) return [];
  const ordered: NodeId[] = [];
  const seen = new Set<NodeId>();
  const visit = (id: NodeId) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = doc.nodes[id];
    if (!node) return;
    ordered.push(id);
    for (const childId of (node as { children?: NodeId[] }).children ?? []) visit(childId);
  };
  visit(page.contentRoot);
  return ordered;
}

/** Semantic panel frames on a page, in reader order. */
export function pagePanelIdsInReadingOrder(
  doc: Document,
  pageId: string | null | undefined,
  direction: PanelReadingDirection,
): NodeId[] {
  const panels = collectPageSubtreeIds(doc, pageId).filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'frame' && Boolean(node.panel);
  });
  return orderPanelIds(panels, doc.nodes, direction);
}

/** Unique dialogue stories on a page, in paint order. */
export function pageDialogueStoryIds(doc: Document, pageId: string | null | undefined): NodeId[] {
  const ordered: NodeId[] = [];
  const seen = new Set<NodeId>();
  for (const id of collectPageSubtreeIds(doc, pageId)) {
    const node = doc.nodes[id];
    if (node?.kind !== 'text') continue;
    const storyId = (node as TextNode).storyBinding?.storyId;
    if (!storyId || seen.has(storyId)) continue;
    seen.add(storyId);
    ordered.push(storyId);
  }
  return ordered;
}

/** Return the entry with its panel order refreshed from the page. */
export function linkPagePanels(
  entry: StoryOutlineEntry,
  doc: Document,
  direction: PanelReadingDirection,
): StoryOutlineEntry {
  return { ...entry, panelIds: pagePanelIdsInReadingOrder(doc, entry.pageId, direction) };
}

/** Return the entry with its dialogue order refreshed from the page. */
export function linkPageDialogue(entry: StoryOutlineEntry, doc: Document): StoryOutlineEntry {
  return { ...entry, dialogueStoryIds: pageDialogueStoryIds(doc, entry.pageId) };
}
