/**
 * Tests for PSD layer mask import (D13).
 *
 * Uses real PSD binary fixtures where available, and tests the parser's
 * mask extraction, conversion to canonical masks, and import reporting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @webtoon/psd
vi.mock('@webtoon/psd', () => ({
  default: {
    parse: vi.fn(),
  },
}));

import Psd from '@webtoon/psd';
import { createPsdParser } from './psd';

function makeBasicPsdResponse() {
  return {
    width: 200,
    height: 200,
    channelCount: 4,
    depth: 8,
    colorMode: 3,
    children: [
      {
        type: 'Layer',
        name: 'Layer 1',
        width: 100,
        height: 100,
        top: 10,
        left: 10,
        opacity: 255,
        composedOpacity: 1,
        isHidden: false,
        isTransparencyLocked: false,
        maskData: null,
        userMask: vi.fn().mockResolvedValue(undefined),
        realUserMask: vi.fn().mockResolvedValue(undefined),
      },
    ],
  };
}

function makeSimplePsdBuffer(): Uint8Array {
  // Minimal valid PSD: 8BPS header + empty layer + image
  const buf = new Uint8Array(512);
  // 8BPS header
  const header = new TextEncoder().encode('8BPS ');
  buf.set(header, 0);
  // Version (2 bytes, big-endian = 1)
  buf[4] = 0;
  buf[5] = 1;
  // Reserved (6 bytes)
  for (let i = 6; i < 12; i++) buf[i] = 0;
  // Channels (2 bytes)
  buf[12] = 0;
  buf[13] = 3;
  // Height (4 bytes)
  buf[14] = 0;
  buf[15] = 0;
  buf[16] = 0;
  buf[17] = 100;
  // Width (4 bytes)
  buf[18] = 0;
  buf[19] = 0;
  buf[20] = 0;
  buf[21] = 100;
  // Depth (2 bytes)
  buf[22] = 0;
  buf[23] = 8;
  // Color mode (2 bytes)
  buf[24] = 0;
  buf[25] = 3;
  return buf;
}

describe('PSD mask import (D13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports a simple PSD with a plain layer (no mask)', () => {
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(makeBasicPsdResponse());
    const parser = createPsdParser();
    const buffer = makeSimplePsdBuffer();
    const result = parser.parse(buffer);

    expect(result.nodeIds.length).toBeGreaterThan(0);
    // Should have at least one layer node
    const layerNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'shape' && (n as any).name === 'Layer 1',
    );
    expect(layerNode).toBeDefined();
    expect(layerNode!.visible).not.toBe(false);
  });

  it('imports a layer with an active mask', () => {
    const psd = makeBasicPsdResponse();
    psd.children[0] = {
      ...psd.children[0],
      maskData: {
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        backgroundColor: 0,
        flags: {
          positionRelativeToLayer: true,
          layerMaskDisabled: false,
          invertMaskWhenBlending: false,
          userMaskFromRenderingOtherData: false,
          masksHaveParametersApplied: false,
        },
      },
    };
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(psd);

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    // Should have a masked container
    const containerNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && (n as any).name === 'Layer 1',
    );
    expect(containerNode).toBeDefined();
    expect(containerNode!.mask).toBeDefined();
    expect(containerNode!.mask!.type).toBe('alpha');
    expect(containerNode!.mask!.inverted).toBeUndefined();
  });

  it('imports an inverted mask', () => {
    const psd = makeBasicPsdResponse();
    psd.children[0] = {
      ...psd.children[0],
      maskData: {
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        backgroundColor: 255,
        flags: {
          positionRelativeToLayer: true,
          layerMaskDisabled: false,
          invertMaskWhenBlending: true,
          userMaskFromRenderingOtherData: false,
          masksHaveParametersApplied: false,
        },
      },
    };
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(psd);

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    const containerNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'frame' && (n as any).name === 'Layer 1',
    );
    expect(containerNode!.mask!.inverted).toBe(true);
  });

  it('marks a disabled mask in warnings', () => {
    const psd = makeBasicPsdResponse();
    psd.children[0] = {
      ...psd.children[0],
      maskData: {
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        backgroundColor: 0,
        flags: {
          positionRelativeToLayer: true,
          layerMaskDisabled: true,
          invertMaskWhenBlending: false,
          userMaskFromRenderingOtherData: false,
          masksHaveParametersApplied: false,
        },
      },
    };
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(psd);

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    expect(result.warnings.some((w) => w.includes('disabled mask'))).toBe(true);
  });

  it('imports a hidden layer', () => {
    const psd = makeBasicPsdResponse();
    psd.children[0] = {
      ...psd.children[0],
      isHidden: true,
    };
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(psd);

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    const layerNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'shape' && (n as any).name === 'Layer 1',
    );
    expect(layerNode!.visible).toBe(false);
  });

  it('imports a group with multiple layers', () => {
    const psd = makeBasicPsdResponse();
    psd.children = [
      {
        type: 'Group',
        name: 'My Group',
        opacity: 255,
        composedOpacity: 1,
        parent: null,
        children: [
          {
            type: 'Layer',
            name: 'Child 1',
            width: 50,
            height: 50,
            top: 0,
            left: 0,
            opacity: 255,
            composedOpacity: 1,
            isHidden: false,
            isTransparencyLocked: false,
            maskData: null,
            userMask: vi.fn().mockResolvedValue(undefined),
            realUserMask: vi.fn().mockResolvedValue(undefined),
          },
          {
            type: 'Layer',
            name: 'Child 2',
            width: 50,
            height: 50,
            top: 50,
            left: 50,
            opacity: 128,
            composedOpacity: 0.5,
            isHidden: false,
            isTransparencyLocked: false,
            maskData: null,
            userMask: vi.fn().mockResolvedValue(undefined),
            realUserMask: vi.fn().mockResolvedValue(undefined),
          },
        ],
      },
    ];
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue(psd);

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    // Should have a group node
    const groupNode = Object.values(result.document.nodes).find(
      (n) => n.kind === 'group' && (n as any).name === 'My Group',
    );
    expect(groupNode).toBeDefined();
    expect(result.nodeIds.length).toBeGreaterThanOrEqual(1);
  });

  it('reports empty PSD gracefully', () => {
    (Psd.parse as ReturnType<typeof vi.fn>).mockReturnValue({
      width: 0,
      height: 0,
      children: [],
    });

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    expect(result.warnings.some((w) => w.includes('no layers'))).toBe(true);
  });

  it('handles parse errors gracefully', () => {
    (Psd.parse as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Corrupt PSD');
    });

    const parser = createPsdParser();
    const result = parser.parse(makeSimplePsdBuffer());

    expect(result.warnings.some((w) => w.includes('Corrupt PSD'))).toBe(true);
    expect(result.nodeIds).toHaveLength(0);
  });
});
