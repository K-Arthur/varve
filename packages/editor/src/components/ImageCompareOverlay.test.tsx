import { createDocument, type Document, type ShapeNode } from '@strata/scene';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageCompareOverlay } from './ImageCompareOverlay';

function makeImageNode(overrides: Partial<ShapeNode> = {}): ShapeNode {
  return {
    id: 'img1',
    kind: 'shape',
    name: 'Photo',
    layerColor: null,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 100 },
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    fills: [
      {
        type: 'image',
        image: { src: 'data:image/png;base64,ORIGINAL', fit: 'fill', x: 0, y: 0, scale: 1 },
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
    ...overrides,
  } as ShapeNode;
}

function makeDoc(node?: ShapeNode): Document {
  const base = createDocument('compare-test');
  return {
    ...base,
    nodes: node ? { [node.id]: node } : {},
    rootChildren: node ? [node.id] : [],
  };
}

// Identity mapping: world (x, y) -> canvas (x, y), no pan/zoom offset.
const identityWorldToCanvas = (wx: number, wy: number) => ({ x: wx, y: wy });

describe('ImageCompareOverlay', () => {
  it('renders nothing when inactive', () => {
    const node = makeImageNode();
    const { container } = render(
      <ImageCompareOverlay
        active={false}
        selection={[node]}
        document={makeDoc(node)}
        worldToCanvas={identityWorldToCanvas}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with no selection', () => {
    const { container } = render(
      <ImageCompareOverlay
        active={true}
        selection={[]}
        document={makeDoc()}
        worldToCanvas={identityWorldToCanvas}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing with a multi-node selection', () => {
    const node = makeImageNode();
    const { container } = render(
      <ImageCompareOverlay
        active={true}
        selection={[node, makeImageNode({ id: 'img2' })]}
        document={makeDoc(node)}
        worldToCanvas={identityWorldToCanvas}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the selected node is not an image', () => {
    const rect = makeImageNode({
      fills: [
        {
          type: 'solid',
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    const { container } = render(
      <ImageCompareOverlay
        active={true}
        selection={[rect]}
        document={makeDoc(rect)}
        worldToCanvas={identityWorldToCanvas}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the original image positioned over the node bounds when active', () => {
    const node = makeImageNode();
    render(
      <ImageCompareOverlay
        active={true}
        selection={[node]}
        document={makeDoc(node)}
        worldToCanvas={identityWorldToCanvas}
      />,
    );
    const overlay = screen.getByTestId('image-compare-overlay');
    expect(overlay.style.left).toBe('0px');
    expect(overlay.style.top).toBe('0px');
    expect(overlay.style.width).toBe('200px');
    expect(overlay.style.height).toBe('100px');
    const img = screen.getByAltText('Original, before edits') as HTMLImageElement;
    expect(img.src).toContain('ORIGINAL');
  });

  it('applies the worldToCanvas mapping (e.g. pan/zoom) to the overlay position', () => {
    const node = makeImageNode();
    const worldToCanvas = vi.fn((wx: number, wy: number) => ({ x: wx * 2 + 10, y: wy * 2 + 5 }));
    render(
      <ImageCompareOverlay
        active={true}
        selection={[node]}
        document={makeDoc(node)}
        worldToCanvas={worldToCanvas}
      />,
    );
    const overlay = screen.getByTestId('image-compare-overlay');
    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.top).toBe('5px');
    expect(overlay.style.width).toBe('400px');
    expect(overlay.style.height).toBe('200px');
  });
});
