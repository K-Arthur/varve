import type { NodeId } from '@strata/scene';
import type { PresenceData } from './PresenceIndicator';

export type PresenceMap = Map<NodeId, PresenceData[]>;

class PresenceStore {
  private presences: PresenceMap = new Map();
  private listeners: Set<() => void> = new Set();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPresences(nodeId: NodeId): PresenceData[] {
    return this.presences.get(nodeId) ?? [];
  }

  setPresence(nodeId: NodeId, data: PresenceData): void {
    const existing = this.presences.get(nodeId) ?? [];
    const idx = existing.findIndex((p) => p.userId === data.userId);
    if (idx >= 0) {
      existing[idx] = data;
    } else {
      existing.push(data);
    }
    this.presences.set(nodeId, existing);
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
