/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FontRegistry } from '../fontRegistry';
import { FontLoader } from './fontLoader';

function collectionBytes(): ArrayBuffer {
  const bytes = readFileSync(
    resolve(
      process.cwd(),
      'packages/engine/src/font/__fixtures__/liberation-collection/liberation-sans-serif.ttc',
    ),
  );
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('FontLoader collection members', () => {
  const originalFontFace = globalThis.FontFace;
  const originalFonts = (document as Document & { fonts?: unknown }).fonts;

  afterEach(() => {
    globalThis.FontFace = originalFontFace;
    if (originalFonts === undefined) Reflect.deleteProperty(document, 'fonts');
    else Object.defineProperty(document, 'fonts', { configurable: true, value: originalFonts });
  });

  it('registers only the requested member when restoring a TTC face', async () => {
    const data = collectionBytes();
    const faces: Array<{ family: string; source: unknown; descriptors: unknown }> = [];
    class MockFontFace {
      constructor(family: string, source: unknown, descriptors?: unknown) {
        faces.push({ family, source, descriptors });
      }

      async load(): Promise<this> {
        return this;
      }
    }
    globalThis.FontFace = MockFontFace as unknown as typeof FontFace;
    const fonts = {
      add: () => undefined,
      delete: () => true,
      ready: Promise.resolve(),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      [Symbol.iterator]: function* () {
        yield* [] as Array<{ family: string }>;
      },
    };
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });

    const artifactHash = '0ea773b2354098ccac1972147993c4d52c6b3cd1338e8bd56ebd0f5cbcd3eefd';
    const registry = new FontRegistry([]);
    const loader = new FontLoader(undefined, registry);
    const result = await loader.restoreFont('Liberation Serif', data, {
      providerId: 'user',
      faceKey: `sha256:${artifactHash}:1`,
      artifactHash,
      collectionIndex: 1,
      weight: 400,
      style: 'normal',
    });

    expect(result.success).toBe(true);
    const source = faces[0]?.source;
    expect(source).toBeInstanceOf(ArrayBuffer);
    expect((source as ArrayBuffer).byteLength).toBeLessThan(data.byteLength);
    expect(registry.getEntries('Liberation Serif')).toEqual([
      expect.objectContaining({
        faceKey: `sha256:${artifactHash}:1`,
        collectionIndex: 1,
      }),
    ]);
  });
});
