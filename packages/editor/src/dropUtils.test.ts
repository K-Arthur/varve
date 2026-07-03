import type { SceneNode, ShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { applyDropPosition, isSupportedFile, validateFiles } from './dropUtils';

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
    fill: [0, 0, 0, 1] as const,
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
      fill: [0, 0, 0, 1] as const,
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
      fill: [0, 0, 0, 1] as const,
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
