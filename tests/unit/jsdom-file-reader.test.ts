/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

/**
 * jsdom FileReader.readAsDataURL used to pass Blob._bytes straight into
 * @exodus/bytes toBase64, which asserts Uint8Array. A Blob built from an
 * ArrayBuffer then threw "Expected an Uint8Array" on a queued task after
 * the test finished. The vendor patch wraps non-Uint8Array sources.
 */
describe('jsdom FileReader.readAsDataURL', () => {
  it('encodes a Blob constructed from an ArrayBuffer', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const blob = new Blob([bytes.buffer], { type: 'application/octet-stream' });
    const reader = new FileReader();
    const result = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
    expect(result).toMatch(/^data:application\/octet-stream;base64,/);
  });
});
