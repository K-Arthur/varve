import { expect } from '@wdio/globals';

interface NativeFace {
  family: string;
  name: string;
  path: string;
  handle?: string;
  artifactHash?: string;
  collectionIndex?: number;
  faceKey?: string;
}

interface NativeFontProbe {
  count: number;
  uniqueKeys: boolean;
  sorted: boolean;
  loaded?: {
    family: string;
    name: string;
    artifactHash: string;
    byteLength: number;
    hash: string;
    listed: boolean;
  };
}

/**
 * Linux/WebKitGTK proof for the native font boundary. This deliberately calls
 * the command through the real Tauri bridge instead of mocking the engine
 * adapter: enumeration, opaque-face loading, original-byte hashing, and the
 * nested IPC request shape all run inside the desktop binary.
 */
describe('Tauri Desktop: Native font discovery', () => {
  it('enumerates stable faces and loads an exact original artifact', async () => {
    const probe = (await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) throw new Error('Tauri invoke bridge is unavailable');

      const faces = (await invoke('enumerate_system_fonts', {
        request: { family: null },
      })) as NativeFace[];
      const candidate = faces.find((face) => face.handle && face.artifactHash && face.faceKey);
      const keys = faces.map((face) => `${face.family}\u0000${face.name}`);
      const uniqueKeys = new Set(keys).size === keys.length;
      const sorted = keys.every((key, index) => index === 0 || keys[index - 1]! <= key);
      if (!candidate?.handle || !candidate.artifactHash) {
        return { count: faces.length, uniqueKeys, sorted } satisfies NativeFontProbe;
      }

      const bytes = (await invoke('load_system_font', {
        request: { handle: candidate.handle },
      })) as number[] | null;
      if (!bytes?.length)
        return { count: faces.length, uniqueKeys, sorted } satisfies NativeFontProbe;

      const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      return {
        count: faces.length,
        uniqueKeys,
        sorted,
        loaded: {
          family: candidate.family,
          name: candidate.name,
          artifactHash: candidate.artifactHash,
          byteLength: bytes.length,
          hash,
          listed: faces.some(
            (face) => face.family === candidate.family && face.name === candidate.name,
          ),
        },
      } satisfies NativeFontProbe;
    })) as NativeFontProbe;

    expect(probe.count).toBeGreaterThanOrEqual(0);
    expect(probe.uniqueKeys).toBe(true);
    expect(probe.sorted).toBe(true);

    // A minimal CI image may expose no readable font file. Enumeration and
    // sort invariants still provide useful coverage there; the normal Linux
    // desktop lane must provide the exact-byte assertion below.
    if (!probe.loaded) return;
    expect(probe.loaded.byteLength).toBeGreaterThan(0);
    expect(probe.loaded.hash).toBe(probe.loaded.artifactHash.toLowerCase());
    expect(probe.loaded.listed).toBe(true);
  });

  it('uses the nested family filter request without widening the result', async () => {
    const result = (await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) throw new Error('Tauri invoke bridge is unavailable');
      const all = (await invoke('enumerate_system_fonts', {
        request: { family: null },
      })) as NativeFace[];
      const first = all[0];
      if (!first) return { allCount: 0, needle: '', filteredCount: 0, allMatch: true };
      const filtered = (await invoke('enumerate_system_fonts', {
        request: { family: first.family },
      })) as NativeFace[];
      return {
        allCount: all.length,
        needle: first.family,
        filteredCount: filtered.length,
        allMatch: filtered.every((face) =>
          face.family.toLowerCase().includes(first.family.toLowerCase()),
        ),
      };
    })) as { allCount: number; needle: string; filteredCount: number; allMatch: boolean };

    expect(result.filteredCount).toBeLessThanOrEqual(result.allCount);
    if (result.filteredCount === 0) return;
    expect(result.allMatch).toBe(true);
  });
});
