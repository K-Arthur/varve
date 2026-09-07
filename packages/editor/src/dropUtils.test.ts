import type { SceneNode, ShapeNode } from '@varve/scene';
import { addNode, createDocument, makeFrameNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  applyDropPosition,
  isDragLeaveOutside,
  isPointInsideRect,
  isSupportedFile,
  resolvePasteDestination,
  validateFiles,
} from './dropUtils';

function makeRectNode(overrides?: Partial<ShapeNode>): SceneNode {
  return {
    id: 'test',
    kind: 'shape',
    name: 'Rect',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, 100, 200] as const,
    shape: { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
    fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
    fills: [],
    strokes: [],
    effects: [],
    ...overrides,
  } as SceneNode;
}

describe('applyDropPosition', () => {
  it('offsets a node transform by the given world position', () => {
    const node = makeRectNode();
    const result = applyDropPosition(node, { x: 300, y: 400 });
    // local bounds center was at (25, 25) transformed by [1,0,0,1,100,200] → world (125, 225)
    // offset = (300, 400) - (125, 225) = (175, 175)
    // new transform = [1, 0, 0, 1, 100 + 175, 200 + 175] = [1, 0, 0, 1, 275, 375]
    expect(result.transform[4]).toBeCloseTo(275);
    expect(result.transform[5]).toBeCloseTo(375);
  });

  it('returns the same node when no position is given', () => {
    const node = makeRectNode();
    const result = applyDropPosition(node, undefined);
    expect(result).toBe(node);
  });

  it('handles frame nodes', () => {
    const node = {
      id: 'frame1',
      kind: 'frame',
      name: 'Frame',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 50, 60] as const,
      children: ['child1'],
      w: 200,
      h: 160,
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
      fills: [],
      strokes: [],
      effects: [],
    } as SceneNode;
    const result = applyDropPosition(node, { x: 0, y: 0 });
    // center was (150, 140), offset = (0, 0) - (150, 140) = (-150, -140)
    // new transform = [1, 0, 0, 1, 50 - 150, 60 - 140] = [1, 0, 0, 1, -100, -80]
    expect(result.transform[4]).toBeCloseTo(-100);
    expect(result.transform[5]).toBeCloseTo(-80);
  });

  it('handles text nodes', () => {
    const node = {
      id: 'text1',
      kind: 'text',
      name: 'Text',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 200, 200] as const,
      text: 'Hello',
      fontSize: 16,
      fontFamily: 'Inter',
      fill: { space: 'rgb' as const, r: 0, g: 0, b: 0, a: 1 },
      fills: [],
      strokes: [],
      effects: [],
    } as SceneNode;
    const result = applyDropPosition(node, { x: 500, y: 500 });
    // offset from current center to new position
    expect(result.transform[4]).not.toBe(200);
    expect(result.transform[5]).not.toBe(200);
  });
});

describe('resolvePasteDestination', () => {
  it('uses the selected frame center in placed world space', () => {
    const frame = makeFrameNode('target', {
      transform: [2, 0, 0, 2, 100, 200],
      w: 200,
      h: 100,
    });
    const doc = addNode(createDocument('Paste'), frame);

    expect(resolvePasteDestination(doc, ['target'], { x: 10, y: 20 })).toEqual({
      targetId: 'target',
      center: { x: 300, y: 300 },
      kind: 'selected-container',
    });
  });

  it('uses the transformed geometric center rather than a rotated AABB center', () => {
    const frame = makeFrameNode('rotated-target', {
      transform: [1, 0, 0, 1, 500, 400],
      rotation: 90,
      w: 200,
      h: 100,
    });
    const doc = addNode(createDocument('Paste'), frame);

    expect(resolvePasteDestination(doc, ['rotated-target'], { x: 10, y: 20 }).center).toEqual({
      x: 450,
      y: 500,
    });
  });

  it('uses the viewport center for ambiguous or ineligible selections', () => {
    const doc = addNode(createDocument('Paste'), makeFrameNode('target'));
    const center = { x: 410, y: 275 };

    expect(resolvePasteDestination(doc, ['target', 'target'], center)).toEqual({
      targetId: null,
      center,
      kind: 'viewport',
    });
    expect(
      resolvePasteDestination(
        { ...doc, nodes: { ...doc.nodes, target: { ...doc.nodes.target!, locked: true } } },
        ['target'],
        center,
      ),
    ).toEqual({ targetId: null, center, kind: 'viewport' });
  });
});

describe('isSupportedFile', () => {
  it('returns true for supported formats', () => {
    expect(isSupportedFile('photo.png')).toBe(true);
    expect(isSupportedFile('drawing.svg')).toBe(true);
    expect(isSupportedFile('doc.pdf')).toBe(true);
    expect(isSupportedFile('design.psd')).toBe(true);
    expect(isSupportedFile('image.jpg')).toBe(true);
    expect(isSupportedFile('image.jpeg')).toBe(true);
    expect(isSupportedFile('image.webp')).toBe(true);
    expect(isSupportedFile('image.gif')).toBe(true);
    expect(isSupportedFile('image.tif')).toBe(true);
    expect(isSupportedFile('image.avif')).toBe(true);
  });

  it('returns false for unsupported formats', () => {
    expect(isSupportedFile('file.txt')).toBe(false);
    expect(isSupportedFile('file.docx')).toBe(false);
    expect(isSupportedFile('file.xlsx')).toBe(false);
    expect(isSupportedFile('file.mp4')).toBe(false);
    expect(isSupportedFile('noext')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSupportedFile('PHOTO.PNG')).toBe(true);
    expect(isSupportedFile('Drawing.SVG')).toBe(true);
  });
});

describe('isDragLeaveOutside', () => {
  it('keeps a drag active while moving between descendants', () => {
    const surface = document.createElement('div');
    const child = document.createElement('span');
    surface.append(child);

    expect(isDragLeaveOutside(surface, child)).toBe(false);
    expect(isDragLeaveOutside(surface, document.createElement('div'))).toBe(true);
    expect(isDragLeaveOutside(surface, null)).toBe(true);
  });
});

describe('isPointInsideRect', () => {
  const rect = { left: 10, right: 110, top: 20, bottom: 120 };

  it('includes the boundary and rejects adjacent surfaces', () => {
    expect(isPointInsideRect({ x: 10, y: 20 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 110, y: 120 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 111, y: 60 }, rect)).toBe(false);
    expect(isPointInsideRect({ x: 60, y: 121 }, rect)).toBe(false);
  });
});

describe('validateFiles', () => {
  it('accepts valid files', () => {
    const files = [
      { name: 'a.svg', data: '<svg></svg>' },
      { name: 'b.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
    ];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects unsupported formats', () => {
    const files = [
      { name: 'a.txt', data: 'hello world' },
      { name: 'b.docx', data: 'binary' },
    ];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]?.reason).toContain('Unsupported');
  });

  it('rejects files that are too small', () => {
    const files = [{ name: 'tiny.svg', data: 'ab' }];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('empty');
  });

  it('rejects files that are too large', () => {
    const largeData = new Uint8Array(201 * 1024 * 1024);
    const files = [{ name: 'huge.png', data: largeData }];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('too large');
  });

  it('warns about large files within limit', () => {
    const data = new Uint8Array(51 * 1024 * 1024);
    const files = [{ name: 'big.svg', data }];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('big.svg');
  });

  it('rejects too many files', () => {
    const files = Array.from({ length: 501 }, (_, i) => ({
      name: `f${i}.svg`,
      data: '<svg></svg>',
    }));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toContain('Too many');
  });

  it('warns about many files within limit', () => {
    const files = Array.from({ length: 51 }, (_, i) => ({
      name: `f${i}.svg`,
      data: '<svg></svg>',
    }));
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(51);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles mixed valid and invalid files', () => {
    const files = [
      { name: 'good.svg', data: '<svg></svg>' },
      { name: 'bad.txt', data: 'text' },
      { name: 'good2.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) },
    ];
    const result = validateFiles(files);
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });
});
