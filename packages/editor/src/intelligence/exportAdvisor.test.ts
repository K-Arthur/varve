import type { NodeId, SceneNode } from '@strata/scene';
import { createDocument } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { suggestExportFormat } from './exportAdvisor';

function makeShapeNodeWith(
  id: NodeId,
  kind: string,
  extra: Record<string, unknown> = {},
): SceneNode {
  return {
    id,
    kind: 'shape',
    name: 'Node',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0] as SceneNode['transform'],
    shape: { kind, x: 0, y: 0, w: 100, h: 100 } as never,
    ...extra,
  } as unknown as SceneNode;
}

function makeTextNodeWith(id: NodeId, extra: Record<string, unknown> = {}): SceneNode {
  return {
    id,
    kind: 'text',
    name: 'Text',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0] as SceneNode['transform'],
    text: 'hello',
    fontSize: 16,
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    ...extra,
  } as SceneNode;
}

function makeFrameNodeWith(
  id: NodeId,
  children: NodeId[],
  extra: Record<string, unknown> = {},
): SceneNode {
  return {
    id,
    kind: 'frame',
    name: 'Frame',
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 0, 0] as SceneNode['transform'],
    w: 200,
    h: 200,
    children,
    ...extra,
  } as SceneNode;
}

describe('suggestExportFormat', () => {
  it('suggests SVG for closed path nodes', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNodeWith('n1' as NodeId, 'path', { closed: true });
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('svg');
  });

  it('suggests SVG for text nodes', () => {
    const doc = createDocument('test', true);
    const node = makeTextNodeWith('n1' as NodeId);
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('svg');
  });

  it('suggests JPEG for JPEG source images', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNodeWith('n1' as NodeId, 'rect', {
      fills: [
        {
          type: 'image',
          image: { src: 'photo.jpg', fit: 'fill' as const },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    });
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('image/jpeg');
  });

  it('suggests PNG for image fills with transparency', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNodeWith('n1' as NodeId, 'rect', {
      fills: [
        {
          type: 'image',
          image: { src: 'logo.png', fit: 'fill' as const },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    });
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('image/png');
  });

  it('suggests PNG @2x for frames with mixed vector and image content', () => {
    const doc = createDocument('test', true);
    const child1 = makeShapeNodeWith('c1' as NodeId, 'rect');
    const child2 = makeShapeNodeWith('c2' as NodeId, 'rect', {
      fills: [
        {
          type: 'image',
          image: { src: 'photo.png', fit: 'fill' as const },
          opacity: 1,
          blendMode: 'normal' as const,
          visible: true,
        },
      ],
    });
    const node = makeFrameNodeWith('n1' as NodeId, ['c1' as NodeId, 'c2' as NodeId]);
    const docWithNodes = {
      ...doc,
      nodes: {
        ...doc.nodes,
        ['n1' as NodeId]: node,
        ['c1' as NodeId]: child1,
        ['c2' as NodeId]: child2,
      },
    };
    const result = suggestExportFormat(node, docWithNodes);
    expect(result.format).toBe('image/png');
    expect(result.scale).toBe(2);
    expect(result.reason).toContain('Mixed');
  });

  it('suggests SVG for frames with only vector children', () => {
    const doc = createDocument('test', true);
    const child1 = makeShapeNodeWith('c1' as NodeId, 'rect');
    const child2 = makeShapeNodeWith('c2' as NodeId, 'ellipse');
    const child3 = makeShapeNodeWith('c3' as NodeId, 'path');
    const node = makeFrameNodeWith('n1' as NodeId, [
      'c1' as NodeId,
      'c2' as NodeId,
      'c3' as NodeId,
    ]);
    const docWithNodes = {
      ...doc,
      nodes: {
        ...doc.nodes,
        ['n1' as NodeId]: node,
        ['c1' as NodeId]: child1,
        ['c2' as NodeId]: child2,
        ['c3' as NodeId]: child3,
      },
    };
    const result = suggestExportFormat(node, docWithNodes);
    expect(result.format).toBe('svg');
  });

  it('suggests JPEG for large nodes (w > 2000)', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNodeWith('n1' as NodeId, 'rect', {
      shape: { kind: 'rect', x: 0, y: 0, w: 2500, h: 1000 },
    });
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('image/jpeg');
  });

  it('suggests SVG for groups with only paths', () => {
    const doc = createDocument('test', true);
    const child1 = makeShapeNodeWith('c1' as NodeId, 'path');
    const child2 = makeShapeNodeWith('c2' as NodeId, 'path');
    const node = makeFrameNodeWith('n1' as NodeId, ['c1' as NodeId, 'c2' as NodeId]);
    const docWithNodes = {
      ...doc,
      nodes: {
        ...doc.nodes,
        ['n1' as NodeId]: node,
        ['c1' as NodeId]: child1,
        ['c2' as NodeId]: child2,
      },
    };
    const result = suggestExportFormat(node, docWithNodes);
    expect(result.format).toBe('svg');
  });

  it('suggests SVG for plain vector shapes', () => {
    const doc = createDocument('test', true);
    const node = makeShapeNodeWith('n1' as NodeId, 'rect');
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('svg');
  });

  it('returns PNG as fallback for empty frames', () => {
    const doc = createDocument('test', true);
    const node = makeFrameNodeWith('n1' as NodeId, []);
    const result = suggestExportFormat(node, doc);
    expect(result.format).toBe('image/png');
  });

  it('includes a reason string', () => {
    const doc = createDocument('test', true);
    const node = makeTextNodeWith('n1' as NodeId);
    const result = suggestExportFormat(node, doc);
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
