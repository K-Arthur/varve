import { describe, expect, it } from 'vitest';
import { addNode, createDocument, makeFrameNode, makeGroupNode, makeShapeNode } from '../document';
import { resolveMask, isMasked } from '../masks';

describe('resolveMask', () => {
  it('returns null for non-container nodes', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(resolveMask(shape)).toBeNull();
  });

  it('returns null when no mask is set on frame', () => {
    const frame = makeFrameNode('f1');
    expect(resolveMask(frame)).toBeNull();
  });

  it('returns mask when set on frame with valid child', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    const mask = resolveMask(frame);
    expect(mask).not.toBeNull();
    expect(mask!.type).toBe('clip');
    expect(mask!.sourceNodeId).toBe('n1');
  });

  it('returns null when mask source node is no longer a child', () => {
    const frame = makeFrameNode('f1');
    frame.children = [];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    expect(resolveMask(frame)).toBeNull();
  });

  it('returns mask for groups with mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    const group = makeGroupNode('g1');
    group.children = ['n1'];
    group.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, group);
    const mask = resolveMask(group);
    expect(mask).not.toBeNull();
    expect(mask!.type).toBe('clip');
  });
});

describe('isMasked', () => {
  it('returns false for unmasked container', () => {
    const frame = makeFrameNode('f1');
    expect(isMasked(frame)).toBe(false);
  });

  it('returns true for masked container', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    expect(isMasked(frame)).toBe(true);
  });

  it('returns false when mask is invisible', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: false };
    expect(isMasked(frame)).toBe(false);
  });
});
