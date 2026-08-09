import { afterEach, describe, expect, it } from 'vitest';
import {
  imageResourceRegistrySize,
  isImageResourceHandle,
  registerImageResourceHandle,
  resetImageResourceRegistry,
  resolveImageResourceHandle,
  unregisterImageResourceHandle,
} from './imageResourceRegistry';

afterEach(() => resetImageResourceRegistry());

describe('imageResourceRegistry', () => {
  it('resolves registered handles to their loadable source', () => {
    registerImageResourceHandle('asset-abc123', 'data:image/png;base64,AAA');
    expect(resolveImageResourceHandle('asset-abc123')).toBe('data:image/png;base64,AAA');
    expect(isImageResourceHandle('asset-abc123')).toBe(true);
  });

  it('passes legacy raw sources through unchanged', () => {
    expect(resolveImageResourceHandle('data:image/png;base64,AAA')).toBe(
      'data:image/png;base64,AAA',
    );
    expect(resolveImageResourceHandle('blob:http://localhost/1')).toBe('blob:http://localhost/1');
    expect(resolveImageResourceHandle('https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    );
    expect(isImageResourceHandle('data:image/png;base64,AAA')).toBe(false);
  });

  it('is idempotent: re-registering the same handle is a no-op', () => {
    registerImageResourceHandle('asset-1', 'data:image/png;base64,AAA');
    registerImageResourceHandle('asset-1', 'data:image/png;base64,AAA');
    expect(resolveImageResourceHandle('asset-1')).toBe('data:image/png;base64,AAA');
    expect(imageResourceRegistrySize()).toBe(1);
  });

  it('tracks multiple distinct handles independently', () => {
    registerImageResourceHandle('asset-a', 'data:image/png;base64,A');
    registerImageResourceHandle('asset-b', 'data:image/png;base64,B');
    expect(resolveImageResourceHandle('asset-a')).toBe('data:image/png;base64,A');
    expect(resolveImageResourceHandle('asset-b')).toBe('data:image/png;base64,B');
    expect(imageResourceRegistrySize()).toBe(2);
  });

  it('unregisters and resets', () => {
    registerImageResourceHandle('asset-a', 'data:image/png;base64,A');
    unregisterImageResourceHandle('asset-a');
    expect(isImageResourceHandle('asset-a')).toBe(false);
    registerImageResourceHandle('asset-b', 'data:image/png;base64,B');
    resetImageResourceRegistry();
    expect(imageResourceRegistrySize()).toBe(0);
    expect(resolveImageResourceHandle('asset-b')).toBe('asset-b');
  });

  it('ignores empty/invalid handles', () => {
    expect(registerImageResourceHandle('', 'data:image/png;base64,A')).toBe('');
    expect(imageResourceRegistrySize()).toBe(0);
  });

  it('never resolves an unregistered handle to a payload', () => {
    expect(resolveImageResourceHandle('asset-not-registered')).toBe('asset-not-registered');
  });
});
