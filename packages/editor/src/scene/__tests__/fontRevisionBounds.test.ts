/**
 * Font readiness must reach every cache that holds text geometry.
 *
 * A font becoming usable changes what text measures without touching the
 * document, so nothing in the document-diffing invalidation path can notice
 * it. These tests pin the two halves of the contract: derived bounds move when
 * the usable face set moves, and the world-bounds cache does not serve a box
 * measured against the previous one.
 */

import { addNode, createDocument, makeTextNode, type NodeId, type SceneNode } from '@varve/scene';
import { setTextAdvanceMeasurer } from '@varve/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTransformCache, getWorldBounds } from '../transformCache';

let revision = 'faces:fallback';

function installMeasurer(perCharWidth: number, nextRevision: string): void {
  revision = nextRevision;
  setTextAdvanceMeasurer({
    measureAdvance: (text, options) => text.length * (options.fontSize ?? 16) * perCharWidth,
    revision: () => revision,
  });
}

function documentWithText() {
  const base = createDocument();
  const node = makeTextNode('text-1' as NodeId, 'Hello world', {
    transform: [1, 0, 0, 1, 0, 0],
    fontSize: 20,
    fontFamily: 'Test Sans',
    textResizing: 'autoWidth',
  }) as SceneNode;
  return addNode(base, node);
}

afterEach(() => {
  setTextAdvanceMeasurer(null);
});

describe('font revision and cached text bounds', () => {
  it('re-measures cached world bounds after the usable face set changes', () => {
    installMeasurer(0.4, 'faces:fallback');
    const doc = documentWithText();
    const cache = createTransformCache();

    const fallback = getWorldBounds(cache, doc, 'text-1' as NodeId);
    expect(fallback).not.toBeNull();

    // Same document, same node identity — only the font became usable.
    installMeasurer(0.9, 'faces:loaded');
    const loaded = getWorldBounds(cache, doc, 'text-1' as NodeId);

    expect(loaded?.w).toBeGreaterThan(fallback?.w ?? 0);
  });

  it('keeps serving the cached box while the face set is unchanged', () => {
    installMeasurer(0.4, 'faces:fallback');
    const doc = documentWithText();
    const cache = createTransformCache();

    const first = getWorldBounds(cache, doc, 'text-1' as NodeId);
    const second = getWorldBounds(cache, doc, 'text-1' as NodeId);

    // Identity, not just equality: an unchanged revision must not invalidate.
    expect(second).toBe(first);
  });
});
