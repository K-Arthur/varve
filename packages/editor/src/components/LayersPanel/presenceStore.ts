import type { NodeId } from '@strata/scene';
import { useEffect, useState } from 'react';
import type { PresenceData } from './PresenceIndicator';

export type PresenceMap = Map<NodeId, PresenceData[]>;

const EMPTY_PRESENCES: PresenceData[] = [];

class PresenceStore {
  private presences: PresenceMap = new Map();
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPresences(nodeId: NodeId): PresenceData[] {
    return this.presences.get(nodeId) ?? EMPTY_PRESENCES;
  }

  setPresence(nodeId: NodeId, data: PresenceData): void {
    const existing = this.presences.get(nodeId) ?? [];
    const idx = existing.findIndex((p) => p.userId === data.userId);
    // Always produce a new array — React.memo'd consumers (LayersRow) do a
    // shallow prop comparison, so mutating the existing array in place would
    // silently fail to re-render a row when a second (or later) presence
    // update lands on a node that already has one.
    const next = idx >= 0 ? existing.map((p, i) => (i === idx ? data : p)) : [...existing, data];
    this.presences.set(nodeId, next);
    this.notify();
  }

  removePresence(nodeId: NodeId, userId: string): void {
    const existing = this.presences.get(nodeId) ?? [];
    const filtered = existing.filter((p) => p.userId !== userId);
    if (filtered.length > 0) {
      this.presences.set(nodeId, filtered);
    } else {
      this.presences.delete(nodeId);
    }
    this.notify();
  }

  clearUser(userId: string): void {
    for (const [nodeId, presences] of this.presences) {
      const filtered = presences.filter((p) => p.userId !== userId);
      if (filtered.length > 0) {
        this.presences.set(nodeId, filtered);
      } else {
        this.presences.delete(nodeId);
      }
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const globalPresenceStore = new PresenceStore();

/**
 * Subscribe a component to live presence data for a single node.
 * Re-renders on any presence change (setPresence/removePresence/clearUser
 * anywhere in the store) — presence updates are human-cursor-rate events,
 * not a hot path, so a coarse "any change, re-read my node" subscription is
 * simpler and safer than per-node fine-grained diffing.
 */
export function usePresence(nodeId: NodeId): PresenceData[] {
  const [, forceRender] = useState(0);
  useEffect(() => globalPresenceStore.subscribe(() => forceRender((n) => n + 1)), []);
  return globalPresenceStore.getPresences(nodeId);
}
