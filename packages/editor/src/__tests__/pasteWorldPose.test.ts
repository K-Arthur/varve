/**
 * World-pose-preserving paste conversion tests.
 *
 * copySelected records each selection root's placed-world transform; paste
 * rebases it into the destination frame's local space (newLocal =
 * targetWorld⁻¹ · anchor) or uses it directly at the document top level.
 * These tests verify the conversion math that the paste action relies on.
 */

import { addChild, addNode, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import type { Affine } from '@varve/shared';
import { multiplyAffine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldTransform, rebaseWorldTransformToParent } from '../scene/world';

const EPS = 1e-9;

describe('world-anchored paste conversion', () => {
  it('rebases a source anchor into a destination frame (cross-artboard paste)', () => {
    const doc = createDocument();
    const artA = makeFrameNode('artA', { transform: [1, 0, 0, 1, 1600, 0] });
    const withArtA = addNode(doc, artA);
    // Child of artA at local (40, 80): world anchor (1640, 80).
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      {
        transform: [1, 0, 0, 1, 40, 80],
      },
    );
    const withChild = addChild(withArtA, 'artA', child);

    // Anchor computed exactly as copySelected does: placed world transform.
    const anchor = nodeWorldTransform(withChild, 'child');
    expect(anchor[4]).toBeCloseTo(1640, EPS);
    expect(anchor[5]).toBeCloseTo(80, EPS);

    // Destination: artB at (2000, 1400).
    const artB = makeFrameNode('artB', { transform: [1, 0, 0, 1, 2000, 1400] });
    const withArtB = addNode(withChild, artB);

    // newLocal = artBWorld⁻¹ · anchor → (1640-2000, 80-1400) = (-360, -1320).
    const local = rebaseWorldTransformToParent(nodeWorldTransform(withArtB, 'artB'), anchor)!;
    expect(local).not.toBeNull();
    expect(local[4]).toBeCloseTo(-360, EPS);
    expect(local[5]).toBeCloseTo(-1320, EPS);

    // Round trip: composing artBWorld · local reproduces the anchor exactly.
    const roundTrip = multiplyAffine(nodeWorldTransform(withArtB, 'artB'), local);
    for (let i = 0; i < 6; i++) {
      expect(roundTrip[i]).toBeCloseTo(anchor[i]!, EPS);
    }
  });

  it('uses the anchor directly at the document top level (no target frame)', () => {
    const doc = createDocument();
    const artA = makeFrameNode('artA', { transform: [1, 0, 0, 1, -800, -400] });
    const withArtA = addNode(doc, artA);
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      {
        transform: [1, 0, 0, 1, 25, 75],
      },
    );
    const withChild = addChild(withArtA, 'artA', child);

    const anchor = nodeWorldTransform(withChild, 'child');
    expect(anchor[4]).toBeCloseTo(-775, EPS);
    expect(anchor[5]).toBeCloseTo(-325, EPS);

    // Top-level paste: the anchor IS the new local transform (document root
    // has no transform in placed-world space) — world pose preserved.
    const local = anchor;
    expect(local[4]).toBeCloseTo(-775, EPS);
    expect(local[5]).toBeCloseTo(-325, EPS);
  });

  it('handles a rotated destination frame via the full inverse', () => {
    const doc = createDocument();
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
      {
        transform: [1, 0, 0, 1, 100, 100],
      },
    );
    const withChild = addNode(doc, child);
    const anchor = nodeWorldTransform(withChild, 'child');

    // Destination frame rotated 90 degrees about (500, 500).
    const angle = Math.PI / 2;
    const rot: Affine = [
      Math.cos(angle),
      Math.sin(angle),
      -Math.sin(angle),
      Math.cos(angle),
      500,
      500,
    ];
    const frame = makeFrameNode('rot', { transform: rot });
    const withFrame = addNode(withChild, frame);

    const local = rebaseWorldTransformToParent(nodeWorldTransform(withFrame, 'rot'), anchor)!;
    expect(local).not.toBeNull();
    // Round trip through the rotated parent reproduces the world anchor.
    const roundTrip = multiplyAffine(nodeWorldTransform(withFrame, 'rot'), local);
    for (let i = 0; i < 6; i++) {
      expect(roundTrip[i]).toBeCloseTo(anchor[i]!, EPS);
    }
  });

  it('returns null for a non-invertible destination frame', () => {
    const doc = createDocument();
    const frame = makeFrameNode('flat', { transform: [0, 0, 0, 0, 100, 100] });
    const withFrame = addNode(doc, frame);
    const local = rebaseWorldTransformToParent(
      nodeWorldTransform(withFrame, 'flat'),
      [1, 0, 0, 1, 50, 50],
    );
    expect(local).toBeNull();
  });
});
