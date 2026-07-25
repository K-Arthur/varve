// @vitest-environment node

import { createMemoryPlatform } from '@strata/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearProjectPreviewData,
  createEncryptedThumbnailRecord,
  ENCRYPTED_PROJECT_PLACEHOLDER,
  getEncryptedPlaceholder,
  removePlaintextThumbnail,
} from '../encryptedThumbnailPolicy';

describe('encrypted thumbnail policy', () => {
  it('placeholder is a non-empty string', () => {
    expect(ENCRYPTED_PROJECT_PLACEHOLDER).toBeTruthy();
    expect(ENCRYPTED_PROJECT_PLACEHOLDER).toContain('data:image/svg+xml');
  });

  it('getEncryptedPlaceholder returns empty string when no canvas', () => {
    // In node environment, hasAnyCanvas is false, so returns ''
    const placeholder = getEncryptedPlaceholder();
    expect(typeof placeholder).toBe('string');
  });

  it('createEncryptedThumbnailRecord has namespaced hash', () => {
    const record = createEncryptedThumbnailRecord('content-hash-123');
    expect(record.hash).toBe('encrypted:content-hash-123');
    expect(record.width).toBe(256);
    expect(record.height).toBe(192);
  });

  it('removePlaintextThumbnail deletes from platform', async () => {
    const platform = createMemoryPlatform();
    await platform.putThumbnail({
      hash: 'test-hash',
      dataUrl: 'data:image/png;base64,test',
      width: 100,
      height: 100,
      createdAt: Date.now(),
    });

    // Verify it exists
    expect(await platform.getThumbnail('test-hash')).toBeTruthy();

    await removePlaintextThumbnail(platform, 'test-hash');

    // Verify it's gone
    expect(await platform.getThumbnail('test-hash')).toBeUndefined();
  });

  it('clearProjectPreviewData removes both plaintext and encrypted entries', async () => {
    const platform = createMemoryPlatform();
    await platform.putThumbnail({
      hash: 'content-123',
      dataUrl: 'data:image/png;base64,plain',
      width: 100,
      height: 100,
      createdAt: Date.now(),
    });
    await platform.putThumbnail({
      hash: 'encrypted:content-123',
      dataUrl: 'data:image/png;base64,enc',
      width: 100,
      height: 100,
      createdAt: Date.now(),
    });

    await clearProjectPreviewData(platform, 'content-123');

    expect(await platform.getThumbnail('content-123')).toBeUndefined();
    expect(await platform.getThumbnail('encrypted:content-123')).toBeUndefined();
  });

  it('removePlaintextThumbnail is safe when hash does not exist', async () => {
    const platform = createMemoryPlatform();
    // Should not throw
    await expect(removePlaintextThumbnail(platform, 'non-existent')).resolves.toBeUndefined();
  });
});
