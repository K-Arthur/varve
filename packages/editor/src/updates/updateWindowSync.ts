/**
 * Cross-window update coordination.
 *
 * Varve can open several windows in one process. Each window mounts its own
 * UpdateCoordinator, but the update transaction must be process-scoped: only
 * one window may run check/download/install at a time, and every window must
 * see the same state. This module provides:
 *
 *  - an operation lease (localStorage) so a second window never starts a
 *    duplicate download or install while the first one owns the operation;
 *  - a BroadcastChannel so every window mirrors state and preference changes
 *    published by the owning window.
 *
 * localStorage is synchronous and shared across windows of the same origin in
 * the desktop webview; BroadcastChannel is same-origin and needs no capability.
 */

export type UpdateWindowOperation = 'check' | 'download' | 'install';

export interface UpdateLease {
  kind: UpdateWindowOperation;
  owner: string;
  expiresAt: number;
}

export type WindowSyncMessage =
  | { type: 'state'; state: unknown }
  | { type: 'preferences'; preferences: unknown };

export interface WindowSyncTransport {
  publish(message: WindowSyncMessage): void;
  subscribe(listener: (message: WindowSyncMessage) => void): () => void;
  close(): void;
}

export const UPDATE_LEASE_KEY = 'varve-update-operation-lease';
export const UPDATE_SYNC_CHANNEL = 'varve-update-sync';
export const UPDATE_LEASE_TTL_MS = 10 * 60 * 1000;
export const UPDATE_ACTIVE_STALE_MS = 2 * 60 * 1000;

/** Pure claim logic over a storage-like map so it is unit-testable. */
export function claimOperationLease(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  kind: UpdateWindowOperation,
  owner: string,
  now: number,
  ttlMs: number = UPDATE_LEASE_TTL_MS,
): boolean {
  const raw = storage.getItem(UPDATE_LEASE_KEY);
  if (raw) {
    try {
      const existing = JSON.parse(raw) as UpdateLease;
      if (existing.kind === kind && existing.expiresAt > now) return false;
      if (existing.expiresAt > now && existing.kind !== kind) return false;
    } catch {
      // A corrupt lease must not block the update forever.
    }
  }
  storage.setItem(
    UPDATE_LEASE_KEY,
    JSON.stringify({ kind, owner, expiresAt: now + ttlMs } satisfies UpdateLease),
  );
  return true;
}

export function renewOperationLease(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  kind: UpdateWindowOperation,
  owner: string,
  now: number,
  ttlMs: number = UPDATE_LEASE_TTL_MS,
): void {
  const raw = storage.getItem(UPDATE_LEASE_KEY);
  if (!raw) return;
  try {
    const existing = JSON.parse(raw) as UpdateLease;
    if (existing.kind !== kind || existing.owner !== owner) return;
    storage.setItem(
      UPDATE_LEASE_KEY,
      JSON.stringify({ ...existing, expiresAt: now + ttlMs } satisfies UpdateLease),
    );
  } catch {
    // Ignore corrupt leases; the claim path repairs them.
  }
}

export function releaseOperationLease(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  kind: UpdateWindowOperation,
  owner: string,
): void {
  const raw = storage.getItem(UPDATE_LEASE_KEY);
  if (!raw) return;
  try {
    const existing = JSON.parse(raw) as UpdateLease;
    if (existing.kind === kind && existing.owner === owner) {
      storage.removeItem(UPDATE_LEASE_KEY);
    }
  } catch {
    storage.removeItem(UPDATE_LEASE_KEY);
  }
}

export function hasActiveOperationLease(
  storage: Pick<Storage, 'getItem'>,
  now: number,
): UpdateWindowOperation | null {
  const raw = storage.getItem(UPDATE_LEASE_KEY);
  if (!raw) return null;
  try {
    const existing = JSON.parse(raw) as UpdateLease;
    return existing.expiresAt > now ? existing.kind : null;
  } catch {
    return null;
  }
}

/** Settled states never hold a half-finished native operation. */
export function isSettledUpdateState(kind: string): boolean {
  return [
    'consent-required',
    'disabled',
    'idle',
    'up-to-date',
    'deferred',
    'cancelled',
    'error',
    'unsupported',
    'externally-managed',
  ].includes(kind);
}

/** Active states describe an operation another window may still be running. */
export function isActiveUpdateState(kind: string): boolean {
  return ['checking', 'downloading', 'verifying', 'installing'].includes(kind);
}

export class BroadcastWindowSync {
  private readonly channel: BroadcastChannel;
  private readonly listeners = new Set<(message: WindowSyncMessage) => void>();

  constructor(
    name: string = UPDATE_SYNC_CHANNEL,
    private readonly storage: Storage = window.localStorage,
    private readonly owner: string = Math.random().toString(36).slice(2),
  ) {
    this.channel = new BroadcastChannel(name);
    this.channel.onmessage = (event) => {
      const message = event.data as WindowSyncMessage;
      for (const listener of this.listeners) listener(message);
    };
  }

  getOwner(): string {
    return this.owner;
  }

  claim(kind: UpdateWindowOperation): boolean {
    return claimOperationLease(this.storage, kind, this.owner, Date.now());
  }

  renew(kind: UpdateWindowOperation): void {
    renewOperationLease(this.storage, kind, this.owner, Date.now());
  }

  release(kind: UpdateWindowOperation): void {
    releaseOperationLease(this.storage, kind, this.owner);
  }

  getActiveOperation(): UpdateWindowOperation | null {
    return hasActiveOperationLease(this.storage, Date.now());
  }

  publish(message: WindowSyncMessage): void {
    this.channel.postMessage(message);
  }

  subscribe(listener: (message: WindowSyncMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.channel.close();
    this.listeners.clear();
  }
}

export function createWindowSync(): WindowSyncTransport {
  return new BroadcastWindowSync();
}
