/**
 * Semantic asset search service for the Home asset browser.
 *
 * Keeps a reconstructible in-memory SemanticAssetIndex backed by the
 * persistent content-addressed embedding store, schedules bounded
 * background embedding jobs for assets that are not yet indexed, and
 * answers natural-language queries through the reference-parity text
 * tower. This service is engine/platform agnostic (dependencies are
 * injected) so it can be unit tested without a browser.
 *
 * The image and text towers are separate downloadable artifacts; the
 * service tracks both and reports model availability so the UI can offer
 * explicit downloads (levels 1-3 of search never depend on them).
 */
import {
  decodeSemanticImageBytes,
  type EmbeddingVector,
  embedImageForSearch,
  embedTextForSearch,
  SIGLIP_IMAGE_MODEL,
} from '@varve/engine';
import type { Asset } from '@varve/platform';
import {
  type AssetEmbeddingIdentity,
  type AssetEmbeddingRecord,
  makeAssetEmbeddingRecord,
  SemanticAssetIndex,
  SemanticEmbeddingQueue,
  type SemanticEmbeddingStore,
} from '@varve/platform';

/** Must match the identity schema used by the embedding producers. */
export const SEMANTIC_EMBEDDING_SCHEMA_VERSION = 'semantic-embedding-v1';

const MODEL_ID = SIGLIP_IMAGE_MODEL.id;
const MODEL_VERSION = SIGLIP_IMAGE_MODEL.revision;
const PREPROCESSING_VERSION = SIGLIP_IMAGE_MODEL.preprocessingVersion;

export interface SemanticSearchStatus {
  /** Model availability per artifact. */
  imageModelAvailable: boolean;
  textModelAvailable: boolean;
  /** Indexing progress over the current asset list. */
  indexedCount: number;
  totalCount: number;
  indexing: boolean;
  /** Last job failure (asset-level, non-fatal). */
  lastError: string | null;
}

export interface SemanticSearchDeps {
  store: SemanticEmbeddingStore;
  getAssetBytes: (id: string) => Promise<Uint8Array | null>;
  isImageModelAvailable: () => Promise<boolean>;
  isTextModelAvailable: () => Promise<boolean>;
  getImageModelPath: (signal: AbortSignal) => Promise<string | null>;
  getTextModelPath: (signal: AbortSignal) => Promise<string | null>;
  onStatus?: (status: SemanticSearchStatus) => void;
  /** Overridable in tests; defaults to the canonical engine pipelines. */
  embedImage?: (
    image: { width: number; height: number; data: Uint8ClampedArray },
    modelPath: string,
    signal: AbortSignal,
  ) => Promise<EmbeddingVector>;
  embedText?: (query: string, modelPath: string, signal: AbortSignal) => Promise<EmbeddingVector>;
  decodeImage?: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

const DEFAULT_EMBEDDING_IDENTITY = {
  modelId: MODEL_ID,
  modelVersion: MODEL_VERSION,
  preprocessingVersion: PREPROCESSING_VERSION,
} as const;

/** Track which content hashes already have records (avoids re-scans). */
class ContentHashIndex {
  private readonly hashes = new Set<string>();

  constructor(records: readonly AssetEmbeddingRecord[]) {
    for (const record of records) this.hashes.add(record.identity.contentHash);
  }

  has(asset: Asset): boolean {
    return this.hashes.has(asset.contentHash ?? `asset:${asset.id}`);
  }

  add(hash: string): void {
    this.hashes.add(hash);
  }
}

export class SemanticAssetSearchService {
  private readonly store: SemanticEmbeddingStore;
  private readonly deps: SemanticSearchDeps;
  private readonly queue = new SemanticEmbeddingQueue<AssetEmbeddingRecord | undefined>(1);
  private index = new SemanticAssetIndex();
  private contentHashes = new ContentHashIndex([]);
  private readonly assets = new Map<string, Asset>();
  private imageModelAvailable = false;
  private textModelAvailable = false;
  private started = false;
  private disposed = false;
  private syncCounter = 0;

  constructor(deps: SemanticSearchDeps) {
    this.deps = deps;
    this.store = deps.store;
  }

  get status(): SemanticSearchStatus {
    return {
      imageModelAvailable: this.imageModelAvailable,
      textModelAvailable: this.textModelAvailable,
      indexedCount: this.index.size,
      totalCount: this.assets.size,
      indexing: this.queue.getStats().pending + this.queue.getStats().active > 0,
      lastError: null,
    };
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    await this.reloadIndex();
    if (this.disposed) return;
    this.imageModelAvailable = await this.deps.isImageModelAvailable().catch(() => false);
    if (this.disposed) return;
    this.textModelAvailable = await this.deps.isTextModelAvailable().catch(() => false);
    this.publish();
  }

  /** Rebuild the in-memory index from the persistent store (crash-safe). */
  async reloadIndex(): Promise<void> {
    const records = await this.store.listAll().catch(() => []);
    // Corrupt or schema-mismatched records must not break search: skip them
    // so the index stays usable and rebuildable (they are derived data).
    const valid: AssetEmbeddingRecord[] = [];
    for (const record of records) {
      try {
        new SemanticAssetIndex({ schemaVersion: 1, records: [record] });
        valid.push(record);
      } catch {
        // skip invalid record
      }
    }
    const next = new SemanticAssetIndex({ schemaVersion: 1, records: valid });
    this.index = next;
    this.contentHashes = new ContentHashIndex(valid);
  }

  /**
   * Reconcile the service with the current asset list: drop stale records'
   * asset references, enqueue embedding jobs for new image assets. Renames
   * and duplicates are free (content-hash keyed); only new bytes embed.
   */
  async sync(assets: readonly Asset[]): Promise<void> {
    if (this.disposed) return;
    const counter = ++this.syncCounter;
    this.assets.clear();
    for (const asset of assets) this.assets.set(asset.id, asset);
    const imageAssets = assets.filter((asset) => asset.kind === 'image');
    const enqueued = new Set<string>();
    for (const asset of imageAssets) {
      if (this.contentHashes.has(asset)) continue;
      const contentKey = asset.contentHash ?? `asset:${asset.id}`;
      if (enqueued.has(contentKey)) continue;
      enqueued.add(contentKey);
      const identity: AssetEmbeddingIdentity = {
        ...DEFAULT_EMBEDDING_IDENTITY,
        contentHash: contentKey,
        embeddingSchemaVersion: SEMANTIC_EMBEDDING_SCHEMA_VERSION,
      };
      void this.queue
        .enqueue({
          id: `embed:${contentKey}`,
          priority: imageAssets.indexOf(asset),
          isCurrent: () => this.syncCounter === counter && this.assets.has(asset.id),
          run: async (signal) => {
            if (!(await this.deps.isImageModelAvailable())) return undefined;
            const modelPath = await this.deps.getImageModelPath(signal);
            if (!modelPath) return undefined;
            const bytes = await this.deps.getAssetBytes(asset.id);
            if (!bytes) return undefined;
            const decode = this.deps.decodeImage ?? decodeSemanticImageBytes;
            const embed = this.deps.embedImage ?? embedImageForSearch;
            const image = await decode(bytes, asset.mimeType);
            const embedding = await embed(image, modelPath, signal);
            const record = makeAssetEmbeddingRecord(identity, embedding.values, {
              contentId: contentKey,
              assetId: asset.id,
              sourceGeneration: contentKey,
              createdAt: Date.now(),
            });
            await this.store.put(record);
            this.index.upsert(record);
            this.contentHashes.add(contentKey);
            this.publish();
            return record;
          },
        })
        .catch(() => undefined);
    }
    this.publish();
  }

  /**
   * Rank the current asset list for a natural-language query. Returns a
   * Map of assetId -> semantic rank (1-based), or null when the semantic
   * lane is unavailable (no model, empty index, or failure).
   */
  async search(query: string, signal: AbortSignal): Promise<Map<string, number> | null> {
    if (!this.textModelAvailable) return null;
    if (this.index.size === 0) return null;
    try {
      const modelPath = await this.deps.getTextModelPath(signal);
      if (!modelPath) return null;
      const embedText = this.deps.embedText ?? embedTextForSearch;
      const embedding = await embedText(query, modelPath, signal);
      const identity: AssetEmbeddingIdentity = {
        ...DEFAULT_EMBEDDING_IDENTITY,
        contentHash: `query:${query}`,
        embeddingSchemaVersion: SEMANTIC_EMBEDDING_SCHEMA_VERSION,
      };
      const queryRecord = makeAssetEmbeddingRecord(identity, embedding.values, {
        contentId: `query:${query}`,
        sourceGeneration: query,
        createdAt: Date.now(),
      });
      const hits = this.index.search(queryRecord, this.assets.size);
      const assetsByContentHash = new Map<string, string[]>();
      for (const asset of this.assets.values()) {
        const key = asset.contentHash ?? `asset:${asset.id}`;
        const list = assetsByContentHash.get(key) ?? [];
        list.push(asset.id);
        assetsByContentHash.set(key, list);
      }
      const ranks = new Map<string, number>();
      for (const [rank, hit] of hits.entries()) {
        const key = hit.record.identity.contentHash;
        const assetIds = assetsByContentHash.get(key) ?? [];
        if (hit.record.assetId && !assetIds.includes(hit.record.assetId)) {
          assetIds.unshift(hit.record.assetId);
        }
        for (const assetId of assetIds) {
          if (this.assets.has(assetId) && !ranks.has(assetId)) {
            ranks.set(assetId, rank + 1);
          }
        }
      }
      return ranks;
    } catch {
      // The semantic lane is optional: any failure degrades to lexical-only
      // results rather than blocking search.
      return null;
    }
  }

  hasRecordFor(asset: Asset): boolean {
    return this.contentHashes.has(asset);
  }

  /** Re-check model availability and publish (after a download completes). */
  async refreshModelAvailability(): Promise<void> {
    if (this.disposed) return;
    this.imageModelAvailable = await this.deps.isImageModelAvailable().catch(() => false);
    if (this.disposed) return;
    this.textModelAvailable = await this.deps.isTextModelAvailable().catch(() => false);
    this.publish();
  }

  /** Drop all derived embeddings (Settings: Clear Search Index). */
  async clear(): Promise<void> {
    if (this.disposed) return;
    await this.store.clear();
    if (this.disposed) return;
    this.index = new SemanticAssetIndex();
    this.contentHashes = new ContentHashIndex([]);
    this.publish();
  }

  pause(): void {
    this.queue.pause();
  }

  resume(): void {
    this.queue.resume();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.syncCounter += 1;
    this.queue.close();
  }

  private publish(): void {
    if (this.disposed) return;
    this.deps.onStatus?.(this.status);
  }
}

export function createSemanticAssetSearchService(
  deps: SemanticSearchDeps,
): SemanticAssetSearchService {
  return new SemanticAssetSearchService(deps);
}
