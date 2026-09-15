import { describe, expect, it } from 'vitest';
import {
  deserializeLutFromDocument,
  estimateLutMemoryUsage,
  fingerprintLut,
  parseLutFile,
  serializeLutForDocument,
} from './lutService';
import { makeIdentityLut1D, makeIdentityLut3D } from './types';

describe('LUT document codec', () => {
  it('round-trips 1D LUTs as real typed arrays', () => {
    const original = makeIdentityLut1D(4, { title: 'Identity' });
    const restored = deserializeLutFromDocument(serializeLutForDocument(original));

    expect(restored.kind).toBe('1d');
    if (restored.kind === '1d') {
      expect(restored.r).toBeInstanceOf(Float64Array);
      expect(restored.g).toBeInstanceOf(Float64Array);
      expect(restored.b).toBeInstanceOf(Float64Array);
      expect(Array.from(restored.r)).toEqual(Array.from(original.r));
      expect(restored.metadata.title).toBe('Identity');
    }
  });

  it('round-trips 3D LUTs and preserves their byte accounting', () => {
    const original = makeIdentityLut3D(3);
    const restored = deserializeLutFromDocument(serializeLutForDocument(original));

    expect(restored.kind).toBe('3d');
    if (restored.kind === '3d') {
      expect(restored.data).toBeInstanceOf(Float64Array);
      expect(Array.from(restored.data)).toEqual(Array.from(original.data));
      expect(estimateLutMemoryUsage(restored)).toBe(original.data.byteLength);
    }
  });

  it('recovers legacy JSON.stringify(Float64Array) payloads', () => {
    const legacy = JSON.stringify(makeIdentityLut3D(2));
    const restored = deserializeLutFromDocument(legacy);

    expect(restored.kind).toBe('3d');
    if (restored.kind === '3d') {
      expect(restored.data).toBeInstanceOf(Float64Array);
      expect(restored.data).toHaveLength(24);
      expect(restored.data[23]).toBe(1);
    }
  });

  it('rejects corrupt, incomplete, and non-finite serialized transforms', () => {
    expect(() => deserializeLutFromDocument('{}')).toThrow(/kind/i);
    expect(() =>
      deserializeLutFromDocument(
        JSON.stringify({
          kind: '3d',
          size: 2,
          data: [0, 0, 0],
          inputMin: [0, 0, 0],
          inputMax: [1, 1, 1],
          metadata: {},
        }),
      ),
    ).toThrow(/24/);
    expect(() =>
      deserializeLutFromDocument(
        '{"kind":"1d","size":2,"r":[0,1],"g":[0,1],"b":[0,null],"inputMin":[0,0,0],"inputMax":[1,1,1],"metadata":{}}',
      ),
    ).toThrow(/finite/);
  });

  it('produces a stable content fingerprint that changes with LUT values', () => {
    const first = makeIdentityLut1D(3);
    const same = makeIdentityLut1D(3, { title: 'Different display name' });
    const changed = makeIdentityLut1D(3);
    changed.r[1] = 0.75;

    expect(fingerprintLut(first)).toBe(fingerprintLut(same));
    expect(fingerprintLut(changed)).not.toBe(fingerprintLut(first));
  });
});

describe('LUT import safety', () => {
  it('rejects excessive text input before parsing', () => {
    expect(() => parseLutFile('huge.cube', 'x'.repeat(32 * 1024 * 1024 + 1))).toThrow(
      /exceeds the 32 MiB limit/,
    );
  });

  it('returns a fingerprint for duplicate detection', () => {
    const data = `LUT_1D_SIZE 2
0 0 0
1 1 1
`;
    const first = parseLutFile('identity.cube', data);
    const second = parseLutFile('copy.cube', data);

    expect(first.fingerprint).toMatch(/^lut-[0-9a-f]{16}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
