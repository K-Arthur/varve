import { describe, expect, it } from 'vitest';
import { createContrastProvider } from '../providers/contrastProvider';
import { createDpiWarningProvider } from '../providers/dpiWarningProvider';
import { createVectorIssuesProvider } from '../providers/vectorIssuesProvider';
import type { OverlayContext } from '../types';

function mockContext(overrides?: Partial<OverlayContext>): OverlayContext {
  return {
    document: {
      nodes: {
        n1: {
          kind: 'text',
          visible: true,
          fontSize: 16,
          text: 'Hello',
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          order: 'a0',
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
        },
        n2: {
          kind: 'shape',
          shape: {
            kind: 'path',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 50, y: 100 },
            ],
            closed: false,
          },
          visible: true,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          order: 'a1',
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
        } as any,
        n3: {
          kind: 'shape',
          shape: { kind: 'rect' },
          fills: [
            {
              type: 'image',
              visible: true,
              image: { src: 'test.jpg', imageWidth: 6000, imageHeight: 4000 },
            },
          ],
          visible: true,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          order: 'a2',
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          rotation: 0,
        } as any,
      },
    } as any,
    zoom: 1,
    pan: { x: 0, y: 0 },
    cameraRotation: 0,
    viewport: { width: 1920, height: 1080 },
    getWorldBounds: () => ({ x: 0, y: 0, w: 100, h: 100 }),
    getWorldTransform: () => [1, 0, 0, 1, 0, 0] as any,
    hiddenNodeIds: new Set(),
    clippedNodeIds: new Set(),
    ...overrides,
  };
}

describe('contrastProvider', () => {
  it('generates badges for text nodes', () => {
    const provider = createContrastProvider();
    const ctx = mockContext();
    const primitives = provider.getPrimitives(ctx);
    const badges = primitives.filter((p) => p.kind === 'badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges.some((b) => b.kind === 'badge' && b.findingId.startsWith('contrast-'))).toBe(
      true,
    );
  });

  it('does not generate overlays for hidden nodes', () => {
    const provider = createContrastProvider();
    const ctx = mockContext({ hiddenNodeIds: new Set(['n1']) });
    const primitives = provider.getPrimitives(ctx);
    const n1Overlays = primitives.filter((p) => p.findingId.includes('n1'));
    expect(n1Overlays).toHaveLength(0);
  });

  it('generates rect primitives for text nodes', () => {
    const provider = createContrastProvider();
    const ctx = mockContext();
    const primitives = provider.getPrimitives(ctx);
    const rects = primitives.filter((p) => p.kind === 'rect');
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });
});

describe('vectorIssuesProvider', () => {
  it('generates badge for open path issues', () => {
    const provider = createVectorIssuesProvider();
    const ctx = mockContext();
    const primitives = provider.getPrimitives(ctx);
    const badges = primitives.filter((p) => p.kind === 'badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    const vectorBadges = badges.filter(
      (b) => b.kind === 'badge' && b.findingId.includes('vector-n2'),
    );
    expect(vectorBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('generates rect with error-style for vector issues', () => {
    const provider = createVectorIssuesProvider();
    const ctx = mockContext();
    const primitives = provider.getPrimitives(ctx);
    const rects = primitives.filter((p) => p.kind === 'rect' && p.findingId.includes('vector-n2'));
    expect(rects.length).toBeGreaterThanOrEqual(1);
  });
});

describe('dpiWarningProvider', () => {
  it('generates badge for image fills with DPI info', () => {
    const provider = createDpiWarningProvider();
    const ctx = mockContext();
    const primitives = provider.getPrimitives(ctx);
    const badges = primitives.filter((p) => p.kind === 'badge');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    const dpiBadges = badges.filter((b) => b.kind === 'badge' && b.findingId.startsWith('dpi-'));
    expect(dpiBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('does not generate for non-image nodes', () => {
    const provider = createDpiWarningProvider();
    const ctx = mockContext({
      document: { nodes: { n1: { kind: 'text', visible: true } } } as any,
    });
    const primitives = provider.getPrimitives(ctx);
    expect(primitives.length).toBe(0);
  });
});
