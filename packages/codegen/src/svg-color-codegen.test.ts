/**
 * Tests for SVG codegen color space preservation.
 *
 * Research basis: SVG 1.1 color with ICC profiles, CSS Color 4.
 */

import { describe, expect, it } from 'vitest';
import { exportNodeToSvg } from './svg';
import type { Document, SceneNode } from '@strata/scene';

function makeDocWithNode(node: SceneNode): Document {
  return {
    id: 'doc1',
    name: 'Test',
    nodes: { [node.id]: node },
    rootChildren: [node.id],
    colorConfig: {
      mode: 'rgb',
      bitDepth: 'uint8',
      workingSpace: 'srgb',
      rgbProfile: { id: 'srgb', name: 'sRGB' },
      cmykProfile: { id: 'fogra39', name: 'Fogra39' },
      blackGeneration: { type: 'none' },
    },
  } as Document;
}

describe('exportNodeToSvg — preserveColorSpace', () => {
  it('emits rgba() for uint8 RGB by default (backward compat)', () => {
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
          opacity: 1,
          visible: true,
        },
      ],
    } as SceneNode;
    const svg = exportNodeToSvg(node, makeDocWithNode(node), { preserveColorSpace: true });
    expect(svg).toContain('rgb(255,0,0)');
    expect(svg).not.toContain('icc-color');
  });

  it('emits icc-color() for CMYK color when preserveColorSpace is true', () => {
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'cmyk', c: 100, m: 50, y: 0, k: 10, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'cmyk', c: 100, m: 50, y: 0, k: 10, a: 255 },
          opacity: 1,
          visible: true,
        },
      ],
    } as SceneNode;
    const svg = exportNodeToSvg(node, makeDocWithNode(node), { preserveColorSpace: true });
    expect(svg).toContain('icc-color');
    expect(svg).toContain('fogra39');
    expect(svg).not.toContain('rgb(');
  });

  it('emits icc-color() for float32 color with profile when preserveColorSpace is true', () => {
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: {
        space: 'rgb',
        bitDepth: 'float32',
        r: 0.5,
        g: 0.2,
        b: 0.8,
        a: 1,
        profile: 'display-p3',
      },
      fills: [
        {
          type: 'solid',
          color: {
            space: 'rgb',
            bitDepth: 'float32',
            r: 0.5,
            g: 0.2,
            b: 0.8,
            a: 1,
            profile: 'display-p3',
          },
          opacity: 1,
          visible: true,
        },
      ],
    } as SceneNode;
    const svg = exportNodeToSvg(node, makeDocWithNode(node), { preserveColorSpace: true });
    expect(svg).toContain('icc-color');
    expect(svg).toContain('display-p3');
  });

  it('falls back to rgb() with warning comment for float32 without profile', () => {
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', bitDepth: 'float32', r: 0.5, g: 0.2, b: 0.8, a: 1 },
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', bitDepth: 'float32', r: 0.5, g: 0.2, b: 0.8, a: 1 },
          opacity: 1,
          visible: true,
        },
      ],
    } as SceneNode;
    const svg = exportNodeToSvg(node, makeDocWithNode(node), { preserveColorSpace: true });
    expect(svg).toContain('rgb(');
    expect(svg).toContain('Warning');
    expect(svg).toContain('float32');
  });

  it('default behavior (preserveColorSpace: false) collapses CMYK to rgb()', () => {
    const node: SceneNode = {
      id: 'n1',
      kind: 'shape',
      name: 'Rect',
      shape: { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'cmyk', c: 100, m: 50, y: 0, k: 10, a: 255 },
      fills: [
        {
          type: 'solid',
          color: { space: 'cmyk', c: 100, m: 50, y: 0, k: 10, a: 255 },
          opacity: 1,
          visible: true,
        },
      ],
    } as SceneNode;
    const svg = exportNodeToSvg(node, makeDocWithNode(node), { preserveColorSpace: false });
    expect(svg).toContain('rgb(');
    expect(svg).not.toContain('icc-color');
  });
});
