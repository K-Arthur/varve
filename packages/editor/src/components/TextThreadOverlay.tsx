/**
 * TextThreadOverlay (M11, ADR-0159): visual story threading on the canvas.
 *
 * Story-bound text frames show incoming/outgoing port dots; the thread path
 * (a polyline through frame centers) renders when any frame of the story is
 * selected; frames flagged overset by deterministic composition show a
 * danger badge. Ports and badges are pointer-events-none — linking is
 * driven by commands (link/unlink selected frames), not by dragging ports
 * (that gesture model is a later milestone).
 *
 * Overset computation is cached per composition key (deterministic; stale
 * keys recompute) so the overlay never re-composes on every frame.
 */

import type { Document, NodeId } from '@varve/scene';
import { storyForFrame } from '@varve/scene';
import { memo, useMemo } from 'react';
import { composeStoryForDoc } from '../scene/storyCompose';
import { nodeWorldBounds } from '../scene/world';

const OVERSET_CACHE = new Map<string, boolean>();
const OVERSET_CACHE_MAX = 200;

function oversetForFrame(doc: Document, storyId: NodeId, frameId: NodeId): boolean {
  const story = doc.stories?.[storyId];
  if (!story) return false;
  const composed = composeStoryForDoc(doc, storyId);
  if (!composed) return false;
  const key = `${composed.compositionKey}:${frameId}`;
  const cached = OVERSET_CACHE.get(key);
  if (cached !== undefined) return cached;
  const frame = composed.frames.find((f) => f.frameId === frameId);
  const overset = Boolean(frame?.overset);
  if (OVERSET_CACHE.size >= OVERSET_CACHE_MAX) OVERSET_CACHE.clear();
  OVERSET_CACHE.set(key, overset);
  return overset;
}

export interface TextThreadOverlayProps {
  document: Document;
  selection: readonly NodeId[];
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
}

interface StoryView {
  storyId: NodeId;
  frames: Array<{
    frameId: NodeId;
    cx: number;
    cy: number;
    left: number;
    right: number;
    overset: boolean;
    selected: boolean;
  }>;
  selected: boolean;
}

function buildStoryViews(
  doc: Document,
  selection: ReadonlySet<NodeId>,
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number },
): StoryView[] {
  const views: StoryView[] = [];
  for (const story of Object.values(doc.stories ?? {})) {
    if (!story || story.thread.length === 0) continue;
    const frames: StoryView['frames'] = [];
    for (const frameId of story.thread) {
      const node = doc.nodes[frameId];
      if (node?.kind !== 'text') continue;
      const bounds = nodeWorldBounds(doc, frameId);
      if (!bounds) continue;
      const tl = worldToCanvas(bounds.x, bounds.y);
      const br = worldToCanvas(bounds.x + bounds.w, bounds.y + bounds.h);
      const cy = (tl.y + br.y) / 2;
      frames.push({
        frameId,
        cx: (tl.x + br.x) / 2,
        cy,
        left: tl.x,
        right: br.x,
        overset: oversetForFrame(doc, story.id, frameId),
        selected: selection.has(frameId),
      });
    }
    if (frames.length === 0) continue;
    views.push({
      storyId: story.id,
      frames,
      selected: frames.some((f) => f.selected),
    });
  }
  return views;
}

export const TextThreadOverlay = memo(function TextThreadOverlay({
  document,
  selection,
  worldToCanvas,
}: TextThreadOverlayProps): React.ReactNode {
  const views = useMemo(
    () => buildStoryViews(document, new Set(selection), worldToCanvas),
    [document, selection, worldToCanvas],
  );
  if (views.length === 0) return null;

  return (
    <svg
      className="text-thread-overlay"
      role="img"
      aria-label="Linked text story threads"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <title>Linked text story threads</title>
      {views.map((view) => (
        <g key={view.storyId}>
          {view.selected && view.frames.length > 1 && (
            <polyline
              points={view.frames.map((f) => `${f.cx},${f.cy}`).join(' ')}
              fill="none"
              stroke="var(--color-accent-primary)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          )}
          {view.frames.map((frame) => (
            <g key={frame.frameId}>
              <title>{`Story ${view.storyId} — frame ${frame.frameId}`}</title>
              <circle
                cx={frame.left}
                cy={frame.cy}
                r={3.5}
                fill="var(--color-surface-raised)"
                stroke="var(--color-accent-primary)"
                strokeWidth={1.5}
              />
              <circle
                cx={frame.right}
                cy={frame.cy}
                r={3.5}
                fill="var(--color-accent-primary)"
                stroke="var(--color-surface-raised)"
                strokeWidth={1}
              />
              {frame.overset && (
                <g>
                  <title>{`Overset text in frame ${frame.frameId}`}</title>
                  <circle
                    cx={frame.right - 4}
                    cy={frame.cy - 4}
                    r={5}
                    fill="var(--color-feedback-danger)"
                  />
                </g>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
});

export { storyForFrame };
