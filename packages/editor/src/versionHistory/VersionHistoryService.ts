/**
 * VersionHistoryService — durable document version history.
 *
 * Local-first version history built on the Platform interface. Stores
 * full document snapshots in content-addressed storage (deduplicating
 * unchanged content) with metadata records for timeline browsing.
 *
 * Role separation (see AGENTS.md §architecture decisions):
 * - Undo/redo: in-memory, per-session, bounded to 50 entries
 * - Autosave: periodic/recovery, crash protection
 * - This service: durable, browsable, restorable version history
 *
 * Research basis:
 * - Figma version history (named versions + auto-saved history)
 * - Git content-addressed object store (dedup by hash)
 * - Local-First §3 (offline, durable, no account)
 */

import type {
  CreateVersionInput,
  Platform,
  VersionEntry,
  VersionOrigin,
  VersionStats,
} from '@strata/platform';
import { contentHash } from '@strata/platform';
import type { Document } from '@strata/scene';
import { serializeDocument } from '@strata/scene';

export interface VersionHistoryConfig {
  /** Minimum interval between auto-versions (ms). */
  autoVersionIntervalMs: number;
  /** Max auto+checkpoint versions per file before pruning. */
  maxAutoVersions: number;
  /** Max total versions per file (hard cap). */
  maxTotalVersions: number;
}

const DEFAULT_CONFIG: VersionHistoryConfig = {
  autoVersionIntervalMs: 300000,
  maxAutoVersions: 100,
  maxTotalVersions: 200,
};

export interface VersionDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export class VersionHistoryService {
  private cfg: VersionHistoryConfig;
  private lastAutoVersionAt: Map<string, number> = new Map();
  private lastKnownHash: Map<string, string> = new Map();

  constructor(
    public readonly platform: Platform,
    config?: Partial<VersionHistoryConfig>,
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  async listVersions(fileId: string): Promise<VersionEntry[]> {
    return this.platform.listVersions(fileId);
  }

  async getVersionStats(fileId: string): Promise<VersionStats> {
    return this.platform.getVersionStats(fileId);
  }

  /**
   * Create a version from the given document. Performs content-dedup:
   * if the latest version already has the same hash, skips creation
   * (unless `force` is set, e.g. for named checkpoints).
   */
  async createVersion(
    input: Omit<CreateVersionInput, 'documentJson' | 'contentHash' | 'size'>,
    document: Document,
    opts?: { force?: boolean; thumbnail?: string },
  ): Promise<VersionEntry | null> {
    const json = serializeDocument(document);
    const hash = contentHash(json);

    if (!opts?.force) {
      const lastHash = this.lastKnownHash.get(input.fileId);
      if (lastHash === hash) return null;
    }

    const platformInput: CreateVersionInput = {
      ...input,
      documentJson: json,
      contentHash: hash,
      size: new TextEncoder().encode(json).length,
      thumbnail: opts?.thumbnail,
      schemaVersion: document.formatVersion,
    };
    const entry = await this.platform.createVersion(platformInput);
    this.lastKnownHash.set(input.fileId, hash);
    return entry;
  }

  /**
   * Create a named checkpoint (always creates, never deduped).
   */
  async createNamedCheckpoint(
    fileId: string,
    document: Document,
    name: string,
    description?: string,
  ): Promise<VersionEntry> {
    const entry = await this.createVersion(
      {
        fileId,
        kind: 'named',
        name,
        description,
        origin: 'checkpoint',
      },
      document,
      { force: true },
    );
    if (entry) return entry;
    const versions = await this.listVersions(fileId);
    return (
      versions[0] ??
      ({
        id: 'empty',
        fileId,
        kind: 'named',
        origin: 'checkpoint',
        size: 0,
        pinned: false,
        timestamp: 0,
        documentHash: '',
      } as VersionEntry)
    );
  }

  /**
   * Potentially create an auto-version if enough time has passed since
   * the last auto-version for this file. Returns the new entry or null.
   */
  async maybeAutoVersion(
    fileId: string,
    document: Document,
    origin: VersionOrigin = 'autosave',
  ): Promise<VersionEntry | null> {
    const now = Date.now();
    const lastAt = this.lastAutoVersionAt.get(fileId);
    if (lastAt !== undefined && now - lastAt < this.cfg.autoVersionIntervalMs) {
      return null;
    }
    const entry = await this.createVersion({ fileId, kind: 'auto', origin }, document);
    if (entry) {
      this.lastAutoVersionAt.set(fileId, now);
    }
    return entry;
  }

  /**
   * Create a checkpoint before a destructive operation (restore, flatten,
   * boolean op, etc.). Always creates a version regardless of dedup.
   */
  async createSafetyCheckpoint(
    fileId: string,
    document: Document,
    reason: string,
  ): Promise<VersionEntry> {
    const entry = await this.createVersion(
      { fileId, kind: 'checkpoint', origin: reason as VersionOrigin, pinned: false },
      document,
      { force: true },
    );
    if (entry) return entry;
    const versions = await this.listVersions(fileId);
    return (
      versions[0] ??
      ({
        id: 'empty',
        fileId,
        kind: 'checkpoint',
        origin: 'checkpoint',
        size: 0,
        pinned: false,
        timestamp: 0,
        documentHash: '',
      } as VersionEntry)
    );
  }

  /**
   * Restore a version's document JSON. Returns the serialized string for
   * the caller to decode and apply.
   */
  async restoreVersion(versionId: string): Promise<string> {
    return this.platform.restoreVersionById(versionId);
  }

  /**
   * Delete a version record (content garbage-collected if unreferenced).
   */
  async deleteVersion(versionId: string): Promise<void> {
    await this.platform.deleteVersionInfo(versionId);
  }

  async renameVersion(versionId: string, name?: string, description?: string): Promise<void> {
    await this.platform.renameVersion(versionId, name, description);
  }

  async pinVersion(versionId: string, pinned: boolean): Promise<void> {
    await this.platform.pinVersion(versionId, pinned);
  }

  /**
   * Prune auto/checkpoint versions beyond the configured limit.
   * Named and pinned versions are never pruned.
   */
  async prune(fileId: string): Promise<number> {
    return this.platform.pruneVersions(fileId, this.cfg.maxAutoVersions);
  }

  /**
   * Compare two versions and return a structural diff of node ids.
   */
  async compareVersions(aId: string, bId: string): Promise<VersionDiff> {
    const [aJson, bJson] = await Promise.all([
      this.platform.restoreVersionById(aId),
      this.platform.restoreVersionById(bId),
    ]);
    return diffDocuments(aJson, bJson);
  }

  /**
   * Cache the current document hash so the next auto-version call can
   * dedup even without a fresh listVersions round-trip.
   */
  primeHash(fileId: string, document: Document): void {
    const json = serializeDocument(document);
    this.lastKnownHash.set(fileId, contentHash(json));
  }
}

function diffDocuments(aJson: string, bJson: string): VersionDiff {
  const aIds = extractNodeIds(aJson);
  const bIds = extractNodeIds(bJson);
  const aSet = new Set(aIds);
  const bSet = new Set(bIds);

  const added = bIds.filter((id) => !aSet.has(id));
  const removed = aIds.filter((id) => !bSet.has(id));
  const modified: string[] = [];
  for (const id of aIds) {
    if (bSet.has(id) && !added.includes(id) && !removed.includes(id)) {
      modified.push(id);
    }
  }
  return { added, removed, modified };
}

function extractNodeIds(json: string): string[] {
  try {
    const doc = JSON.parse(json) as { nodes?: Record<string, unknown> };
    return doc.nodes ? Object.keys(doc.nodes) : [];
  } catch {
    return [];
  }
}
