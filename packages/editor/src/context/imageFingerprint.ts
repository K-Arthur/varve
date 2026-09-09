/** Fingerprint decoded image pixels for async mask/session identity checks. */
export async function fingerprintImageData(imageData: ImageData): Promise<string> {
  const bytes = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  );
  const header = new TextEncoder().encode(`${imageData.width}x${imageData.height}:`);
  const input = new Uint8Array(header.byteLength + bytes.byteLength);
  input.set(header);
  input.set(bytes, header.byteLength);

  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', input);
    return `sha256:${hex(new Uint8Array(digest))}`;
  }

  // Non-secure test runtimes can omit SubtleCrypto. This is still a stable
  // exact-pixel fingerprint for the lifetime of the process, and the browser
  // path above is collision-resistant for persisted model/session identity.
  let hash = 2_166_136_261;
  for (const byte of input) hash = Math.imul(hash ^ byte, 16_777_619);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
