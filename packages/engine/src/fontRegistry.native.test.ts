/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadNative } = vi.hoisted(() => ({
  loadNative: vi.fn(),
}));

vi.mock('./font/fontSystemBridge', () => ({
  loadSystemFontFace: loadNative,
}));

import { FontRegistry } from './fontRegistry';

function fixture(): ArrayBuffer {
  const bytes = readFileSync(
    resolve(
      process.cwd(),
      'packages/engine/src/font/__fixtures__/liberation-collection/liberation-sans-serif.ttc',
    ),
  );
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function installFontDom(): {
  fonts: {
    add: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
  };
  restore: () => void;
} {
  const originalFonts = (document as Document & { fonts?: unknown }).fonts;
  const originalFontFace = globalThis.FontFace;
  const fonts = {
    add: vi.fn(),
    load: vi.fn().mockResolvedValue([]),
    check: vi.fn().mockReturnValue(true),
    ready: Promise.resolve(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  class MockFontFace {
    family: string;
    source: unknown;
    descriptors: unknown;

    constructor(family: string, source: unknown, descriptors?: unknown) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
    }

    async load(): Promise<this> {
      return this;
    }
  }
  globalThis.FontFace = MockFontFace as unknown as typeof FontFace;

  return {
    fonts,
    restore: () => {
      if (originalFonts === undefined) {
        Reflect.deleteProperty(document, 'fonts');
      } else {
        Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts });
      }
      globalThis.FontFace = originalFontFace;
    },
  };
}

describe('FontRegistry native exact-face loading', () => {
  let restoreDom: (() => void) | undefined;
  let domFonts: ReturnType<typeof installFontDom>['fonts'];

  beforeEach(() => {
    loadNative.mockReset();
    const dom = installFontDom();
    domFonts = dom.fonts;
    restoreDom = dom.restore;
  });

  afterEach(() => {
    restoreDom?.();
    restoreDom = undefined;
  });

  it('loads the selected collection member from the opaque native handle', async () => {
    const data = fixture();
    loadNative.mockResolvedValue(data);
    const registry = new FontRegistry([]);
    const artifactHash = '0ea773b2354098ccac1972147993c4d52c6b3cd1338e8bd56ebd0f5cbcd3eefd';
    registry.register({
      family: 'Liberation Serif',
      weight: 400,
      style: 'normal',
      source: 'system',
      sourceHandle: 'native-member-1',
      collectionIndex: 1,
      faceKey: `sha256:${artifactHash}:1`,
    });

    const result = await registry.ensureDocumentFonts([
      {
        family: 'Liberation Serif',
        weight: 400,
        style: 'normal',
        fontReference: { artifactHash, collectionIndex: 1 },
      },
    ]);

    expect(result).toBeUndefined();
    expect(loadNative).toHaveBeenCalledWith('native-member-1');
    expect((document.fonts.add as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const face = (document.fonts.add as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      source: ArrayBuffer;
    };
    expect(face.source.byteLength).toBeLessThan(data.byteLength);
    expect(registry.state('Liberation Serif')).toBe('loaded');
  });

  it('does not fall back by family when an exact reference is absent', async () => {
    const registry = new FontRegistry([]);
    await registry.ensureDocumentFonts([
      {
        family: 'Shared Family',
        fontReference: { artifactHash: 'f'.repeat(64), collectionIndex: 0 },
      },
    ]);

    expect(loadNative).not.toHaveBeenCalled();
    expect(domFonts.load).not.toHaveBeenCalled();
    expect(registry.state('Shared Family')).toBe('error');
  });

  it('reports a stale native handle without attempting local family fallback', async () => {
    loadNative.mockResolvedValue(null);
    const registry = new FontRegistry([]);
    registry.register({
      family: 'Stale Native',
      weight: 400,
      style: 'normal',
      source: 'system',
      sourceHandle: 'stale-handle',
      faceKey: `sha256:${'1'.repeat(64)}:single`,
    });

    await registry.ensureDocumentFonts([
      {
        family: 'Stale Native',
        fontReference: { artifactHash: '1'.repeat(64) },
      },
    ]);

    expect(loadNative).toHaveBeenCalledWith('stale-handle');
    expect(domFonts.load).not.toHaveBeenCalled();
    expect(registry.state('Stale Native')).toBe('error');
  });

  it('can remove a refreshed native face by its opaque handle', () => {
    const registry = new FontRegistry([]);
    registry.register({
      family: 'Refreshable Native',
      weight: 400,
      style: 'normal',
      source: 'system',
      sourceHandle: 'refresh-handle',
      faceKey: `sha256:${'2'.repeat(64)}:single`,
    });

    expect(registry.unregisterFace({ sourceHandle: 'refresh-handle' })).toBe(true);
    expect(registry.getEntries('Refreshable Native')).toEqual([]);
  });
});
