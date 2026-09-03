import { describe, expect, it } from 'vitest';
import {
  addNode,
  createDocument,
  makeAdjustmentNode,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from '../document';
import {
  canReceiveLayerMask,
  canReceiveRasterMask,
  canSupplyMaskCoverage,
} from '../maskCapability';
import {
  addMask,
  canNodeHaveMask,
  defaultVectorMaskForNode,
  isMasked,
  removeMask,
  resolveMask,
  resolveMaskType,
  setMaskDensity,
  setMaskFeather,
  setMaskHideSource,
  setMaskInverted,
  setMaskLinked,
  setMaskSourceNode,
  setMaskTransform,
  setMaskType,
  setMaskVectorPath,
  setMaskVisible,
} from '../masks';
import { makeRasterLayerNode } from '../rasterLayer';

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
    expect(mask?.type).toBe('clip');
    expect(mask?.sourceNodeId).toBe('n1');
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
    expect(mask?.type).toBe('clip');
  });

  it('returns mask for adjustment nodes', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    const adj = makeAdjustmentNode('a1', 'curves', {
      channel: 'rgb',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    });
    adj.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, adj);
    const mask = resolveMask(adj);
    expect(mask).not.toBeNull();
    expect(mask?.type).toBe('alpha');
  });

  it('returns null when mask visible is false', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: false };
    expect(resolveMask(frame)).toBeNull();
  });

  it('returns mask for luminance type', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'luminance', sourceNodeId: 'n1', visible: true };
    expect(resolveMask(frame)).not.toBeNull();
    expect(resolveMask(frame)?.type).toBe('luminance');
  });
});

describe('resolveMaskType', () => {
  it('returns null for unmasked container', () => {
    const frame = makeFrameNode('f1');
    expect(resolveMaskType(frame)).toBeNull();
  });

  it('returns mask type for masked container', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    expect(resolveMaskType(frame)).toBe('clip');
  });

  it('returns luminance type', () => {
    const frame = makeFrameNode('f1');
    frame.children = ['n1'];
    frame.mask = { type: 'luminance', sourceNodeId: 'n1', visible: true };
    expect(resolveMaskType(frame)).toBe('luminance');
  });
});

describe('canNodeHaveMask', () => {
  it('returns true for frame', () => {
    expect(canNodeHaveMask(makeFrameNode('f1'))).toBe(true);
  });

  it('returns true for group', () => {
    expect(canNodeHaveMask(makeGroupNode('g1'))).toBe(true);
  });

  it('returns true for shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(canNodeHaveMask(shape)).toBe(true);
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

describe('addMask', () => {
  it('adds a clip mask to a frame', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'clip');
    const updatedFrame = doc.nodes.f1 as {
      mask?: { type?: string; sourceNodeId?: string; visible?: boolean };
    };
    expect(updatedFrame.mask).toBeDefined();
    expect(updatedFrame.mask?.type).toBe('clip');
    expect(updatedFrame.mask?.sourceNodeId).toBe('n1');
    expect(updatedFrame.mask?.visible).toBe(true);
  });

  it('adds an alpha mask to a group', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const group = makeGroupNode('g1', { children: ['n1'] });
    doc = addNode(doc, group);
    doc = addMask(doc, 'g1', 'n1', 'alpha');
    const updatedGroup = doc.nodes.g1 as { mask?: { type?: string } };
    expect(updatedGroup.mask?.type).toBe('alpha');
  });

  it('adds a luminance mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'luminance');
    const updatedFrame = doc.nodes.f1 as { mask?: { type?: string } };
    expect(updatedFrame.mask?.type).toBe('luminance');
  });

  it('rejects invalid mask type', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'invalid' as 'clip');
    const updatedFrame = doc.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });

  it('rejects when source is not a child', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1'); // no children
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'clip');
    const updatedFrame = doc.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });

  it('rejects when source does not exist', () => {
    const frame = makeFrameNode('f1', { children: ['nonexistent'] });
    const doc = addNode(createDocument(), frame);
    const result = addMask(doc, 'f1', 'nonexistent', 'clip');
    const updatedFrame = result.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });

  it('accepts optional parameters (inverted, feather, density)', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'alpha', {
      inverted: true,
      feather: 5,
      density: 0.8,
    });
    const updatedFrame = doc.nodes.f1 as {
      mask?: { inverted?: boolean; feather?: number; density?: number };
    };
    expect(updatedFrame.mask?.inverted).toBe(true);
    expect(updatedFrame.mask?.feather).toBe(5);
    expect(updatedFrame.mask?.density).toBe(0.8);
  });
});

describe('removeMask', () => {
  it('removes an existing mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = removeMask(doc, 'f1');
    const updatedFrame = doc.nodes.f1 as { mask?: unknown };
    expect(updatedFrame.mask).toBeUndefined();
  });

  it('is idempotent (no mask to remove)', () => {
    const frame = makeFrameNode('f1');
    const doc = addNode(createDocument(), frame);
    const result = removeMask(doc, 'f1');
    expect(result).toBe(doc);
  });

  it('source node still exists after mask removal', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = removeMask(doc, 'f1');
    expect(doc.nodes.n1).toBeDefined();
  });
});

describe('setMaskInverted', () => {
  it('sets inverted to true', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskInverted(doc, 'f1', true);
    const m = (doc.nodes.f1 as { mask?: { inverted?: boolean } }).mask;
    expect(m?.inverted).toBe(true);
  });

  it('removes inverted when set to false', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true, inverted: true };
    doc = addNode(doc, frame);
    doc = setMaskInverted(doc, 'f1', false);
    const m = (doc.nodes.f1 as { mask?: { inverted?: boolean } }).mask;
    expect(m?.inverted).toBeUndefined();
  });
});

describe('setMaskFeather', () => {
  it('sets feather radius', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskFeather(doc, 'f1', 10);
    const m = (doc.nodes.f1 as { mask?: { feather?: number } }).mask;
    expect(m?.feather).toBe(10);
  });

  it('clamps negative values to 0', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskFeather(doc, 'f1', -5);
    const m = (doc.nodes.f1 as { mask?: { feather?: number } }).mask;
    expect(m?.feather).toBeUndefined();
  });

  it('removes feather when set to 0', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true, feather: 5 };
    doc = addNode(doc, frame);
    doc = setMaskFeather(doc, 'f1', 0);
    const m = (doc.nodes.f1 as { mask?: { feather?: number } }).mask;
    expect(m?.feather).toBeUndefined();
  });
});

describe('setMaskDensity', () => {
  it('sets density to 0.5', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskDensity(doc, 'f1', 0.5);
    const m = (doc.nodes.f1 as { mask?: { density?: number } }).mask;
    expect(m?.density).toBe(0.5);
  });

  it('clamps density to [0, 1]', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskDensity(doc, 'f1', 1.5);
    const m = (doc.nodes.f1 as { mask?: { density?: number } }).mask;
    // density=1 is treated as default (undefined)
    expect(m?.density).toBeUndefined();
  });

  it('removes density when set to 1 (full effect)', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true, density: 0.5 };
    doc = addNode(doc, frame);
    doc = setMaskDensity(doc, 'f1', 1);
    const m = (doc.nodes.f1 as { mask?: { density?: number } }).mask;
    expect(m?.density).toBeUndefined();
  });
});

describe('setMaskVisible', () => {
  it('toggles visible', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskVisible(doc, 'f1', false);
    const m = (doc.nodes.f1 as { mask?: { visible?: boolean } }).mask;
    expect(m?.visible).toBe(false);
    doc = setMaskVisible(doc, 'f1', true);
    const m2 = (doc.nodes.f1 as { mask?: { visible?: boolean } }).mask;
    expect(m2?.visible).toBe(true);
  });
});

describe('hideMaskSource', () => {
  it('defaults to false when adding a mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'alpha');
    const m = (doc.nodes.f1 as { mask?: { hideMaskSource?: boolean } }).mask;
    expect(m?.hideMaskSource).toBeUndefined();
  });

  it('sets hideMaskSource to true via addMask opts', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    doc = addNode(doc, frame);
    doc = addMask(doc, 'f1', 'n1', 'alpha', { hideMaskSource: true });
    const m = (doc.nodes.f1 as { mask?: { hideMaskSource?: boolean } }).mask;
    expect(m?.hideMaskSource).toBe(true);
  });

  it('toggles hideMaskSource on and off', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'alpha', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskHideSource(doc, 'f1', true);
    const m1 = (doc.nodes.f1 as { mask?: { hideMaskSource?: boolean } }).mask;
    expect(m1?.hideMaskSource).toBe(true);
    doc = setMaskHideSource(doc, 'f1', false);
    const m2 = (doc.nodes.f1 as { mask?: { hideMaskSource?: boolean } }).mask;
    expect(m2?.hideMaskSource).toBeUndefined();
  });
});

describe('setMaskLinked', () => {
  it('unlinks mask from container', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskLinked(doc, 'f1', false);
    const m = (doc.nodes.f1 as { mask?: { linked?: boolean } }).mask;
    expect(m?.linked).toBe(false);
  });

  it('re-links mask to container (removes linked field)', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true, linked: false };
    doc = addNode(doc, frame);
    doc = setMaskLinked(doc, 'f1', true);
    const m = (doc.nodes.f1 as { mask?: { linked?: boolean } }).mask;
    expect(m?.linked).toBeUndefined();
  });
});

describe('setMaskTransform', () => {
  it('sets independent mask transform', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true, linked: false };
    doc = addNode(doc, frame);
    const t: [number, number, number, number, number, number] = [2, 0, 0, 2, 100, 100];
    doc = setMaskTransform(doc, 'f1', t);
    const m = (doc.nodes.f1 as { mask?: { transform?: number[] } }).mask;
    expect(m?.transform).toEqual(t);
  });

  it('removes transform when set to undefined', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = {
      type: 'clip',
      sourceNodeId: 'n1',
      visible: true,
      linked: false,
      transform: [2, 0, 0, 2, 100, 100],
    };
    doc = addNode(doc, frame);
    doc = setMaskTransform(doc, 'f1', undefined);
    const m = (doc.nodes.f1 as { mask?: { transform?: unknown } }).mask;
    expect(m?.transform).toBeUndefined();
  });
});

describe('setMaskType', () => {
  it('changes mask type', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskType(doc, 'f1', 'alpha');
    const m = (doc.nodes.f1 as { mask?: { type?: string } }).mask;
    expect(m?.type).toBe('alpha');
  });

  it('changes to luminance', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskType(doc, 'f1', 'luminance');
    const m = (doc.nodes.f1 as { mask?: { type?: string } }).mask;
    expect(m?.type).toBe('luminance');
  });

  it('rejects invalid type', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskType(doc, 'f1', 'invalid' as 'clip');
    const m = (doc.nodes.f1 as { mask?: { type?: string } }).mask;
    expect(m?.type).toBe('clip');
  });
});

describe('setMaskSourceNode', () => {
  it('changes mask source node', () => {
    const shape1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const shape2 = makeShapeNode('n2', { kind: 'ellipse', cx: 25, cy: 25, rx: 20, ry: 20 });
    let doc = addNode(createDocument(), shape1);
    doc = addNode(doc, shape2);
    const frame = makeFrameNode('f1', { children: ['n1', 'n2'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskSourceNode(doc, 'f1', 'n2');
    const m = (doc.nodes.f1 as { mask?: { sourceNodeId?: string } }).mask;
    expect(m?.sourceNodeId).toBe('n2');
  });

  it('rejects if new source is not a child', () => {
    const shape1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape1);
    doc = addNode(doc, shape2);
    const frame = makeFrameNode('f1', { children: ['n1'] });
    frame.mask = { type: 'clip', sourceNodeId: 'n1', visible: true };
    doc = addNode(doc, frame);
    doc = setMaskSourceNode(doc, 'f1', 'n2');
    const m = (doc.nodes.f1 as { mask?: { sourceNodeId?: string } }).mask;
    expect(m?.sourceNodeId).toBe('n1');
  });
});

// ── Leaf-node mask tests (unified cross-media masking) ──────────────────────

describe('canNodeHaveMask — leaf nodes', () => {
  it('returns true for raster layer', () => {
    expect(canNodeHaveMask(makeRasterLayerNode('rl1', { width: 100, height: 100 }))).toBe(true);
  });

  it('returns true for text node', () => {
    expect(canNodeHaveMask(makeTextNode('t1', 'Hello'))).toBe(true);
  });

  it('returns true for vector shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    expect(canNodeHaveMask(shape)).toBe(true);
  });
});

describe('unified mask capabilities', () => {
  it('treats vector, text, and raster leaves as equivalent mask targets', () => {
    const vector = makeShapeNode('vector', { kind: 'ellipse', cx: 30, cy: 20, rx: 30, ry: 20 });
    const text = makeTextNode('text', 'Mask me');
    const raster = makeRasterLayerNode('raster', { width: 64, height: 32 });

    for (const node of [vector, text, raster]) {
      expect(canReceiveLayerMask(node)).toBe(true);
      expect(canReceiveRasterMask(node)).toBe(true);
      expect(canSupplyMaskCoverage(node)).toBe(true);
    }
  });

  it('creates a local vector path covering a visual leaf', () => {
    const ellipse = makeShapeNode('ellipse', { kind: 'ellipse', cx: 40, cy: 30, rx: 40, ry: 30 });
    const mask = defaultVectorMaskForNode(ellipse, createDocument());

    expect(mask).toMatchObject({ closed: true, fillRule: 'nonzero' });
    expect(mask?.points.map(({ x, y }) => [x, y])).toEqual([
      [0, 0],
      [80, 0],
      [80, 60],
      [0, 60],
    ]);
  });
});

describe('addMask — vector mask on leaf nodes', () => {
  const vectorPath = {
    points: [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: 100, handleIn: null, handleOut: null },
    ],
    closed: true,
    fillRule: 'nonzero' as const,
  };

  it('adds a vector clip mask to a shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'clip', { vectorMask: vectorPath });
    const m = doc.nodes.n1?.mask;
    expect(m).toBeDefined();
    expect(m?.type).toBe('clip');
    expect(m?.vectorMask).toEqual(vectorPath);
  });

  it('adds a vector alpha mask to a shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', { vectorMask: vectorPath });
    const m = doc.nodes.n1?.mask;
    expect(m?.type).toBe('alpha');
    expect(m?.vectorMask).toEqual(vectorPath);
  });

  it('adds a vector mask to a text node', () => {
    const text = makeTextNode('t1', 'Hello');
    let doc = addNode(createDocument(), text);
    doc = addMask(doc, 't1', undefined, 'alpha', { vectorMask: vectorPath });
    const m = doc.nodes.t1?.mask;
    expect(m).toBeDefined();
    expect(m?.type).toBe('alpha');
    expect(m?.vectorMask).toEqual(vectorPath);
  });

  it('adds a vector mask to a raster layer', () => {
    const rl = makeRasterLayerNode('rl1', { width: 200, height: 200 });
    let doc = addNode(createDocument(), rl);
    doc = addMask(doc, 'rl1', undefined, 'alpha', { vectorMask: vectorPath });
    const m = doc.nodes.rl1?.mask;
    expect(m).toBeDefined();
    expect(m?.type).toBe('alpha');
    expect(m?.vectorMask).toEqual(vectorPath);
  });

  it('adds a vector luminance mask to a shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'luminance', { vectorMask: vectorPath });
    const m = doc.nodes.n1?.mask;
    expect(m?.type).toBe('luminance');
  });

  it('rejects clip mask on leaf without vector path', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'clip');
    expect(doc.nodes.n1?.mask).toBeUndefined();
  });

  it('rejects sourceNodeId on leaf nodes', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    doc = addNode(doc, shape2);
    doc = addMask(doc, 'n1', 'n2', 'alpha');
    expect(doc.nodes.n1?.mask).toBeUndefined();
  });

  it('rejects matteSource kind scene-node on leaf nodes', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const shape2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 50, h: 50 });
    let doc = addNode(createDocument(), shape);
    doc = addNode(doc, shape2);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: 'n2' },
    });
    expect(doc.nodes.n1?.mask).toBeUndefined();
  });
});

describe('resolveMask — leaf nodes', () => {
  it('returns vector mask on shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    const mask = resolveMask(doc.nodes.n1!);
    expect(mask).not.toBeNull();
    expect(mask?.type).toBe('alpha');
    expect(mask?.vectorMask).toBeDefined();
  });

  it('returns null for shape with invisible mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const doc = addNode(createDocument(), shape);
    doc.nodes.n1!.mask = {
      type: 'alpha',
      visible: false,
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    };
    expect(resolveMask(doc.nodes.n1!)).toBeNull();
  });

  it('returns raster mask on raster layer', () => {
    const rl = makeRasterLayerNode('rl1', { width: 200, height: 200 });
    let doc = addNode(createDocument(), rl);
    doc = addNode(doc, makeRasterLayerNode('rl1', { width: 200, height: 200 }));
    doc.nodes.rl1!.mask = {
      type: 'alpha',
      visible: true,
      rasterMask: {
        assetId: 'test-asset',
        coordinateSpace: 'node-local-pixels',
        sourceIdentity: { kind: 'source-metadata', locator: 'node-local:rl1', revision: 1 },
      },
    };
    const mask = resolveMask(doc.nodes.rl1!);
    expect(mask).not.toBeNull();
    expect(mask?.type).toBe('alpha');
    expect(mask?.rasterMask).toBeDefined();
  });

  it('returns null for leaf with empty vector mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const doc = addNode(createDocument(), shape);
    doc.nodes.n1!.mask = {
      type: 'alpha',
      visible: true,
      vectorMask: { points: [], closed: true, fillRule: 'nonzero' },
    };
    expect(resolveMask(doc.nodes.n1!)).toBeNull();
  });
});

describe('setMaskVectorPath — leaf nodes', () => {
  it('sets vector path on a shape with existing mask', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    const newPoints = [
      { x: 10, y: 10, handleIn: null, handleOut: null },
      { x: 90, y: 10, handleIn: null, handleOut: null },
      { x: 50, y: 90, handleIn: null, handleOut: null },
    ];
    doc = setMaskVectorPath(doc, 'n1', newPoints, true, 'evenodd');
    const m = doc.nodes.n1?.mask;
    expect(m?.vectorMask?.points).toHaveLength(3);
    expect(m?.vectorMask?.fillRule).toBe('evenodd');
  });

  it('removes mask when vector path is emptied and no other source', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    doc = setMaskVectorPath(doc, 'n1', [], true);
    expect(doc.nodes.n1?.mask).toBeUndefined();
  });
});

describe('removeMask — leaf nodes', () => {
  it('removes vector mask from shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    expect(doc.nodes.n1?.mask).toBeDefined();
    doc = removeMask(doc, 'n1');
    expect(doc.nodes.n1?.mask).toBeUndefined();
  });

  it('removes vector mask from text node', () => {
    const text = makeTextNode('t1', 'Hello');
    let doc = addNode(createDocument(), text);
    doc = addMask(doc, 't1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    doc = removeMask(doc, 't1');
    expect(doc.nodes.t1?.mask).toBeUndefined();
  });
});

describe('setMask properties — leaf nodes', () => {
  function maskedShape() {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    return doc;
  }

  it('toggles visibility', () => {
    let doc = maskedShape();
    doc = setMaskVisible(doc, 'n1', false);
    expect(doc.nodes.n1?.mask?.visible).toBe(false);
    doc = setMaskVisible(doc, 'n1', true);
    expect(doc.nodes.n1?.mask?.visible).toBe(true);
  });

  it('toggles inversion', () => {
    let doc = maskedShape();
    doc = setMaskInverted(doc, 'n1', true);
    expect(doc.nodes.n1?.mask?.inverted).toBe(true);
    doc = setMaskInverted(doc, 'n1', false);
    expect(doc.nodes.n1?.mask?.inverted).toBeUndefined();
  });

  it('sets feather', () => {
    let doc = maskedShape();
    doc = setMaskFeather(doc, 'n1', 5);
    expect(doc.nodes.n1?.mask?.feather).toBe(5);
  });

  it('sets density', () => {
    let doc = maskedShape();
    doc = setMaskDensity(doc, 'n1', 0.75);
    expect(doc.nodes.n1?.mask?.density).toBe(0.75);
  });

  it('toggles linked', () => {
    let doc = maskedShape();
    doc = setMaskLinked(doc, 'n1', false);
    expect(doc.nodes.n1?.mask?.linked).toBe(false);
    doc = setMaskLinked(doc, 'n1', true);
    expect(doc.nodes.n1?.mask?.linked).toBeUndefined();
  });

  it('sets transform', () => {
    let doc = maskedShape();
    doc = setMaskLinked(doc, 'n1', false);
    const t: [number, number, number, number, number, number] = [2, 0, 0, 2, 50, 50];
    doc = setMaskTransform(doc, 'n1', t);
    expect(doc.nodes.n1?.mask?.transform).toEqual(t);
  });

  it('changes type', () => {
    let doc = maskedShape();
    doc = setMaskType(doc, 'n1', 'luminance');
    expect(doc.nodes.n1?.mask?.type).toBe('luminance');
  });
});

describe('isMasked — leaf nodes', () => {
  it('returns true for masked shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    let doc = addNode(createDocument(), shape);
    doc = addMask(doc, 'n1', undefined, 'alpha', {
      vectorMask: {
        points: [{ x: 0, y: 0, handleIn: null, handleOut: null }],
        closed: true,
        fillRule: 'nonzero',
      },
    });
    expect(isMasked(doc.nodes.n1!)).toBe(true);
  });

  it('returns false for unmasked shape', () => {
    const shape = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 });
    const doc = addNode(createDocument(), shape);
    expect(isMasked(doc.nodes.n1!)).toBe(false);
  });
});
