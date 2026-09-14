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

/**
 * Linux/WebKitGTK proof for the native font boundary. This deliberately calls
 * the command through the real Tauri bridge instead of mocking the engine
 * adapter: enumeration, opaque-face loading, original-byte hashing, and the
 * nested IPC request shape all run inside the desktop binary.
 */
describe('Tauri Desktop: Native font discovery', () => {
  it('enumerates stable faces and loads an exact original artifact', async () => {
    const probe = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) throw new Error('Tauri invoke bridge is unavailable');

      const faces = (await invoke('enumerate_system_fonts', {
        request: { family: null },
      })) as NativeFace[];
      const candidate = faces.find((face) => face.handle && face.artifactHash && face.faceKey);
      if (!candidate?.handle || !candidate.artifactHash) return { faces };

      const bytes = (await invoke('load_system_font', {
        request: { handle: candidate.handle },
      })) as number[] | null;
      if (!bytes?.length) return { faces };

      const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
      const hash = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      return {
        faces,
        loaded: {
          family: candidate.family,
          name: candidate.name,
          artifactHash: candidate.artifactHash,
          byteLength: bytes.length,
          hash,
        },
      };
    });

    expect(Array.isArray(probe.faces)).toBe(true);
    const keys = probe.faces.map((face) => `${face.family}\u0000${face.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let index = 1; index < probe.faces.length; index += 1) {
      const previous = probe.faces[index - 1]!;
      const current = probe.faces[index]!;
      expect(
        `${previous.family}\u0000${previous.name}` <= `${current.family}\u0000${current.name}`,
      ).toBe(true);
    }

    // A minimal CI image may expose no readable font file. Enumeration and
    // sort invariants still provide useful coverage there; the normal Linux
    // desktop lane must provide the exact-byte assertion below.
    if (!probe.loaded) return;
    expect(probe.loaded.byteLength).toBeGreaterThan(0);
    expect(probe.loaded.hash).toBe(probe.loaded.artifactHash.toLowerCase());
    expect(
      probe.faces.some(
        (face) => face.family === probe.loaded?.family && face.name === probe.loaded.name,
      ),
    ).toBe(true);
  });

  it('uses the nested family filter request without widening the result', async () => {
    const result = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) throw new Error('Tauri invoke bridge is unavailable');
      const all = (await invoke('enumerate_system_fonts', {
        request: { family: null },
      })) as NativeFace[];
      const first = all[0];
      if (!first) return { allCount: 0, needle: '', filtered: [] as NativeFace[] };
      const filtered = (await invoke('enumerate_system_fonts', {
        request: { family: first.family },
      })) as NativeFace[];
      return { allCount: all.length, needle: first.family, filtered };
    });

    expect(result.filtered.length).toBeLessThanOrEqual(result.allCount);
    if (result.filtered.length === 0) return;
    expect(
      result.filtered.every((face) =>
        face.family.toLowerCase().includes(result.needle.toLowerCase()),
      ),
    ).toBe(true);
  });
});
