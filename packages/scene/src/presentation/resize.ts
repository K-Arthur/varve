import { multiplyAffine, scaleXY, translate } from '@varve/shared';
import type { Document } from '../document';
import type { NodeId, SceneNode } from '../types';
import { findPresentationDeck } from './model';

/**
 * Deck size and aspect-ratio conversion.
 *
 * A deck declares one slide size, but its frames are ordinary artwork that may
 * sit at any position on any Design Canvas. Converting 16:9 to 4:3 therefore
 * has to change two things — the declared size and the content inside every
 * slide — without moving frames on the canvas and without silently distorting
 * anything.
 *
 * Content scaling works because a child's transform is expressed in its parent's
 * local space (verified against the reference deck: three frames at world
 * x = 0, 1460, 2920 all carry identical child transforms). Scaling the frame's
 * *direct* children by `S` in frame space resizes everything beneath them
 * automatically through `parent ∘ local` composition, so no descendant walk and
 * no geometry rewriting is needed — text sizes, gradients, and vector shapes
 * all scale with their transform.
 *
 * The scale matrix is applied on the *left* (`T·S·child`), which is the correct
 * "scale the content in frame space" operation for the shared
 * `[a,b,c,d,e,f]` = `[[a,c,e],[b,d,f]]` convention in `@varve/shared`.
 *
 * Every slide ends at the chosen size; `fit` and `crop` keep proportions by
 * scaling content uniformly and centring it, while `reflow` scales each axis
 * independently and says so before the user commits.
 */

export type PresentationResizeMode = 'fit' | 'crop' | 'reflow';

export interface PresentationResizeModeOption {
  id: PresentationResizeMode;
  name: string;
  description: string;
  /** True when the conversion changes proportions. Never a default. */
  stretchesContent: boolean;
}

export const PRESENTATION_RESIZE_MODES: readonly PresentationResizeModeOption[] = [
  {
    id: 'fit',
    name: 'Fit inside',
    description: 'Scale uniformly and centre. Nothing is cut; the frame gains empty space.',
    stretchesContent: false,
  },
  {
    id: 'crop',
    name: 'Fill and crop',
    description: 'Scale uniformly until the frame is covered; content past the edge is clipped.',
    stretchesContent: false,
  },
  {
    id: 'reflow',
    name: 'Stretch to fill',
    description: 'Scale each axis independently. This distorts proportions.',
    stretchesContent: true,
  },
];

export interface PresentationResizeTarget {
  width: number;
  height: number;
}

export interface PresentationResizeSlideChange {
  entryId: string;
  frameId: NodeId;
  frameName: string;
  /** Number of direct children whose transform is rewritten. */
  childCount: number;
  frameFrom: PresentationResizeTarget;
  frameTo: PresentationResizeTarget;
  /** What this slide's content experiences, computed against its own size. */
  contentScale: { x: number; y: number };
  contentOffset: { x: number; y: number };
  /** True when this slide did not sit at the deck's declared size. */
  differsFromDeck: boolean;
}

export interface PresentationResizePreview {
  deckId: string;
  from: PresentationResizeTarget;
  to: PresentationResizeTarget;
  mode: PresentationResizeMode;
  slideCount: number;
  changes: PresentationResizeSlideChange[];
  /** Slide references whose frame is missing or not a frame at all. */
  skippedEntryIds: string[];
  warnings: string[];
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sameSize(a: PresentationResizeTarget, b: PresentationResizeTarget): boolean {
  return Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;
}

/** Content factors for one frame, given its own size and the size it must become. */
function scaleFor(
  frame: PresentationResizeTarget,
  target: PresentationResizeTarget,
  mode: PresentationResizeMode,
): { sx: number; sy: number; dx: number; dy: number } {
  const rawX = target.width / frame.width;
  const rawY = target.height / frame.height;
  if (mode === 'reflow') return { sx: rawX, sy: rawY, dx: 0, dy: 0 };
  const factor = mode === 'fit' ? Math.min(rawX, rawY) : Math.max(rawX, rawY);
  return {
    sx: factor,
    sy: factor,
    dx: (target.width - frame.width * factor) / 2,
    dy: (target.height - frame.height * factor) / 2,
  };
}

/**
 * Build a side-effect-free conversion preview. The caller shows this before
 * dispatching `presentation.deck.resize`; cancelling it changes nothing.
 */
export function previewPresentationResize(
  document: Document,
  deckId: string,
  target: PresentationResizeTarget,
  mode: PresentationResizeMode = 'fit',
): PresentationResizePreview {
  const deck = findPresentationDeck(document, deckId);
  if (!deck) throw new Error('The selected presentation deck does not exist.');
  if (!positive(target.width) || !positive(target.height)) {
    throw new Error('Slide width and height must both be positive numbers.');
  }
  const from = { width: deck.width, height: deck.height };
  if (sameSize(from, target)) {
    throw new Error('That is already this deck’s slide size. Choose a different size.');
  }

  const changes: PresentationResizeSlideChange[] = [];
  const skippedEntryIds: string[] = [];
  let mixed = 0;

  for (const entry of deck.slides) {
    const frame = document.nodes[entry.frameId];
    if (frame?.kind !== 'frame') {
      skippedEntryIds.push(entry.id);
      continue;
    }
    const frameFrom = { width: frame.w, height: frame.h };
    const differsFromDeck = !sameSize(frameFrom, from);
    if (differsFromDeck) mixed += 1;
    const scale = scaleFor(frameFrom, target, mode);
    changes.push({
      entryId: entry.id,
      frameId: frame.id,
      frameName: frame.name,
      childCount: frame.children.filter((childId) => Boolean(document.nodes[childId]?.transform))
        .length,
      frameFrom,
      frameTo: { ...target },
      contentScale: { x: scale.sx, y: scale.sy },
      contentOffset: { x: scale.dx, y: scale.dy },
      differsFromDeck,
    });
  }

  const warnings: string[] = [];
  const option = PRESENTATION_RESIZE_MODES.find((candidate) => candidate.id === mode);
  if (option?.stretchesContent) {
    warnings.push(
      'Stretching changes proportions: circles become ellipses and text scales unevenly. Fit or Fill keeps proportions.',
    );
  }
  if (mixed > 0) {
    warnings.push(
      `${mixed} slide(s) are not at the deck’s declared size. They are converted to the new size as well, so their framing may shift — check them after applying.`,
    );
  }
  if (skippedEntryIds.length > 0) {
    warnings.push(
      `${skippedEntryIds.length} slide reference(s) have no usable frame and cannot be resized. Repair them in Slides.`,
    );
  }
  if (changes.length === 0) {
    warnings.push('No slide in this deck has a resolvable frame, so nothing would change.');
  }
  if (Math.abs(from.width / from.height - target.width / target.height) > 1e-6) {
    warnings.push(
      mode === 'reflow'
        ? 'The aspect ratio changes and content stretches to fill it, so the frame edges stay tight.'
        : 'The aspect ratio changes, so content is centred and the empty margin is clipped by the frame edge rather than left on the canvas.',
    );
  }

  return {
    deckId,
    from,
    to: { ...target },
    mode,
    slideCount: changes.length,
    changes,
    skippedEntryIds,
    warnings,
  };
}

/**
 * Applies a previously generated preview. Refuses a stale preview so a
 * conversion can never be committed against a deck that moved on.
 */
export function applyPresentationResizePreview(
  document: Document,
  preview: PresentationResizePreview,
): Document {
  const deck = findPresentationDeck(document, preview.deckId);
  if (!deck) throw new Error('The selected presentation deck no longer exists.');
  if (!sameSize({ width: deck.width, height: deck.height }, preview.from)) {
    throw new Error('The slide size changed after this preview. Preview the conversion again.');
  }

  const nodes = { ...document.nodes };
  for (const change of preview.changes) {
    const frame = nodes[change.frameId];
    if (frame?.kind !== 'frame') continue;
    const preScale = multiplyAffine(
      translate(change.contentOffset.x, change.contentOffset.y),
      scaleXY(change.contentScale.x, change.contentScale.y),
    );
    for (const childId of frame.children) {
      const child = nodes[childId];
      if (!child?.transform) continue;
      nodes[childId] = {
        ...child,
        transform: multiplyAffine(preScale, child.transform),
      } as SceneNode;
    }
    nodes[change.frameId] = {
      ...frame,
      w: preview.to.width,
      h: preview.to.height,
    } as SceneNode;
  }

  const metadata = document.presentation;
  if (!metadata) throw new Error('This document has no presentation metadata.');
  return {
    ...document,
    nodes,
    presentation: {
      ...metadata,
      decks: metadata.decks.map((candidate) =>
        candidate.id !== preview.deckId
          ? candidate
          : { ...candidate, width: preview.to.width, height: preview.to.height },
      ),
    },
  };
}
