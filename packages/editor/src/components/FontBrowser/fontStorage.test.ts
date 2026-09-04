import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredFontCount, listStoredFonts, removeStoredFont, storeFont } from './fontStorage';

const metadata = {
  providerId: 'fontsource',
  familyId: 'inter',
  packageVersion: '5.3.0',
  upstreamVersion: 'v20',
  weight: 400,
  style: 'normal' as const,
  subset: 'latin',
  variable: false,
};

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('varve-font-storage-v2');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

describe('canonical font storage', () => {
  it('does not collide for distinct faces that share a family', async () => {
    const regular = await storeFont('Inter', new Uint8Array([1, 2, 3]).buffer, metadata);
    const italic = await storeFont('Inter', new Uint8Array([4, 5, 6]).buffer, {
      ...metadata,
      style: 'italic',
    });
    expect(regular.key).not.toBe(italic.key);
    expect(await getStoredFontCount()).toBe(2);
  });

  it('persists the content hash and can remove one exact artifact', async () => {
    const record = await storeFont('Inter', new Uint8Array([7, 8, 9]).buffer, metadata);
    expect(record.metadata.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await listStoredFonts())[0]?.metadata.familyId).toBe('inter');
    await removeStoredFont(record.key);
    expect(await getStoredFontCount()).toBe(0);
  });
});
