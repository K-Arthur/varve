/** @vitest-environment jsdom */

import 'fake-indexeddb/auto';
import { getFontRegistry, resetFontRegistry } from '@varve/engine';
import { storeFont } from '@varve/engine/font';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreStoredFonts } from './restoreStoredFonts';

const FONT_DB = 'varve-font-storage-v2';

function installFontLoadingMocks(): void {
  const faces: Array<{ family: string }> = [];

  // @ts-expect-error — jsdom does not provide FontFace
  globalThis.FontFace = class MockFontFace {
    family: string;

    constructor(family: string) {
      this.family = family;
    }

    load(): Promise<void> {
      return Promise.resolve();
    }
  };

  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add(face: { family: string }) {
        faces.push(face);
      },
      ready: Promise.resolve(),
      [Symbol.iterator]() {
        return faces[Symbol.iterator]();
      },
    },
  });
}

async function deleteFontDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(FONT_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('restoreStoredFonts', () => {
  beforeEach(async () => {
    resetFontRegistry();
    await deleteFontDatabase();
    installFontLoadingMocks();
  });

  afterEach(() => {
    resetFontRegistry();
  });

  it('restores a persisted Fontsource face into the runtime registry', async () => {
    await storeFont('Carrois Gothic', new Uint8Array([1, 2, 3, 4]).buffer, {
      providerId: 'fontsource',
      familyId: 'carrois-gothic',
      packageVersion: '5.3.0',
      upstreamVersion: 'v1.0.0',
      weight: 400,
      style: 'normal',
      subset: 'latin',
      variable: false,
    });

    await expect(restoreStoredFonts()).resolves.toEqual({ restored: 1, failed: 0 });
    expect(getFontRegistry().getEntries('Carrois Gothic')).toEqual([
      expect.objectContaining({
        family: 'Carrois Gothic',
        weight: 400,
        style: 'normal',
        source: 'fontsource',
      }),
    ]);
  });
});
