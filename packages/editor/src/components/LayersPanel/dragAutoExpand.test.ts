/**
 * Tests for drag-time auto-expand restoration policy.
 *
 * A 500ms hover on a collapsed container springs it open mid-drag. When the
 * drag ends somewhere else — or is cancelled — that expansion must revert,
 * or a drag that merely passed through a group permanently changed the
 * user's disclosure (the failure mode Photoshop/Figma users report).
 */

import type { Document, NodeId } from '@varve/scene';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
  reparentNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { resolveAutoExpandRestore } from './useLayersDnD';

/**
 * Frame Outer
 * ├── Frame Inner
 * │   └── Deep
 * └── Loose
 */
function makeDoc(): { doc: Document; outer: NodeId; inner: NodeId } {
  let doc = createDocument('expand-restore', true);
  const o = nextNodeId(doc);
  doc = addNode(o.doc, makeFrameNode(o.id, { w: 100, h: 100, children: [], name: 'Outer' }));
  const i = nextNodeId(doc);
  doc = addNode(i.doc, makeFrameNode(i.id, { w: 50, h: 50, children: [], name: 'Inner' }));
  doc = reparentNode(doc, i.id, o.id, 0);
  const d = nextNodeId(doc);
  doc = addNode(
    d.doc,
    makeShapeNode(d.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }, { name: 'Deep' }),
  );
  doc = reparentNode(doc, d.id, i.id, 0);
  const l = nextNodeId(doc);
  doc = addNode(
    l.doc,
    makeShapeNode(l.id, { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }, { name: 'Loose' }),
  );
  return { doc, outer: o.id, inner: i.id };
}

describe('resolveAutoExpandRestore', () => {
  it('restores everything when the drop lands nowhere (cancel / invalid / root)', () => {
    const { doc, outer, inner } = makeDoc();
    const opened = new Set<NodeId>([outer, inner]);
    expect(resolveAutoExpandRestore(opened, null, doc, null)).toEqual([outer, inner]);
  });

  it('keeps the dropped-into container and its opened ancestors open', () => {
    const { doc, outer, inner } = makeDoc();
    const opened = new Set<NodeId>([outer, inner]);
    // Drop landed inside Inner: Inner stays open, and so does Outer (its
    // ancestor) so the landing place remains visible — nothing reverts.
    expect(resolveAutoExpandRestore(opened, inner, doc, null)).toEqual([]);
    // Drop landed in Outer itself: Outer stays, Inner (opened on the way
    // past, not on the landed path) reverts.
    expect(resolveAutoExpandRestore(opened, outer, doc, null)).toEqual([inner]);
  });
});
