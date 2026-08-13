import { describe, expect, it } from 'vitest';
import {
  claimOperationLease,
  hasActiveOperationLease,
  isActiveUpdateState,
  isSettledUpdateState,
  releaseOperationLease,
  renewOperationLease,
  UPDATE_LEASE_KEY,
  type UpdateLease,
} from './updateWindowSync';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const storage = () => new MemoryStorage();

describe('update window lease', () => {
  it('lets one window claim an operation and blocks a second', () => {
    const store = storage();
    expect(claimOperationLease(store, 'download', 'window-a', 1000)).toBe(true);
    expect(claimOperationLease(store, 'download', 'window-b', 1001)).toBe(false);
    expect(hasActiveOperationLease(store, 1002)).toBe('download');
  });

  it('blocks a different operation while one is active', () => {
    const store = storage();
    claimOperationLease(store, 'download', 'window-a', 1000);
    expect(claimOperationLease(store, 'install', 'window-b', 1001)).toBe(false);
  });

  it('releases a claim only for its owner', () => {
    const store = storage();
    claimOperationLease(store, 'download', 'window-a', 1000);
    releaseOperationLease(store, 'download', 'window-b');
    expect(hasActiveOperationLease(store, 1001)).toBe('download');
    releaseOperationLease(store, 'download', 'window-a');
    expect(hasActiveOperationLease(store, 1002)).toBeNull();
  });

  it('expires claims so a crashed window cannot block updates forever', () => {
    const store = storage();
    claimOperationLease(store, 'download', 'window-a', 1000, 10_000);
    expect(hasActiveOperationLease(store, 10_999)).toBe('download');
    expect(hasActiveOperationLease(store, 11_001)).toBeNull();
    expect(claimOperationLease(store, 'download', 'window-b', 11_002)).toBe(true);
  });

  it('renews a lease and ignores renewal by other owners', () => {
    const store = storage();
    claimOperationLease(store, 'download', 'window-a', 1000, 10_000);
    renewOperationLease(store, 'download', 'window-b', 5_000, 10_000);
    expect((JSON.parse(store.getItem(UPDATE_LEASE_KEY)!) as UpdateLease).expiresAt).toBe(11_000);
    renewOperationLease(store, 'download', 'window-a', 6_000, 10_000);
    expect((JSON.parse(store.getItem(UPDATE_LEASE_KEY)!) as UpdateLease).expiresAt).toBe(16_000);
  });

  it('treats a corrupt lease as claimable', () => {
    const store = storage();
    store.setItem(UPDATE_LEASE_KEY, '{not json');
    expect(claimOperationLease(store, 'download', 'window-a', 1000)).toBe(true);
  });
});

describe('update state classification', () => {
  it('classifies settled and active states', () => {
    expect(isSettledUpdateState('idle')).toBe(true);
    expect(isSettledUpdateState('ready-to-install')).toBe(false);
    expect(isSettledUpdateState('update-available')).toBe(false);
    expect(isSettledUpdateState('downloading')).toBe(false);
    expect(isActiveUpdateState('downloading')).toBe(true);
    expect(isActiveUpdateState('idle')).toBe(false);
  });
});
