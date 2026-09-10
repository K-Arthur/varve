/**
 * Settings — Semantic Asset Search.
 *
 * Manages the two optional local artifacts behind natural-language asset
 * search (SigLIP image tower, text tower, and the pinned tokenizer) and
 * the derived embedding index. Everything is opt-in: filename/OCR/tag
 * search never depends on these models, and the index is rebuildable
 * derived data that can always be regenerated from the library.
 */
import { DownloadManager, listAllModels, type ModelManifestEntry } from '@varve/engine';
import { IndexedDbSemanticEmbeddingStore } from '@varve/platform';
import { Button, Icon, RegionLoader } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface SemanticModelRow {
  entry: ModelManifestEntry;
  /** Download states reported by the inference DownloadManager. */
  state: Awaited<ReturnType<DownloadManager['getDownloadState']>>;
  progress: number | null;
}

interface IndexStats {
  count: number;
  bytes: number;
  loading: boolean;
}

const SEMANTIC_MODEL_IDS = [
  'siglip-base-patch16-224',
  'siglip-base-patch16-224-text',
  'siglip-tokenizer',
] as const;

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function modelLabel(id: string): string {
  switch (id) {
    case 'siglip-base-patch16-224':
      return 'Visual search model (image encoder)';
    case 'siglip-base-patch16-224-text':
      return 'Natural-language search model (text encoder)';
    case 'siglip-tokenizer':
      return 'Text tokenizer';
    default:
      return id;
  }
}

function stateLabel(state: SemanticModelRow['state']): string {
  switch (state) {
    case 'ready':
      return 'Installed';
    case 'downloading':
      return 'Downloading';
    case 'queued':
      return 'Queued';
    case 'verifying':
      return 'Verifying';
    case 'installing':
      return 'Installing';
    case 'paused':
      return 'Paused (resumes on next download)';
    case 'error':
      return 'Download failed';
    default:
      return 'Not installed';
  }
}

export function SemanticSearchTab() {
  const managerRef = useRef<DownloadManager | null>(null);
  const [rows, setRows] = useState<SemanticModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [indexStats, setIndexStats] = useState<IndexStats>({
    count: 0,
    bytes: 0,
    loading: true,
  });
  const [clearBusy, setClearBusy] = useState(false);
  const [rebuildBusy, setRebuildBusy] = useState(false);

  const refresh = useCallback(async () => {
    const catalog = listAllModels();
    const dm = new DownloadManager();
    for (const entry of catalog) {
      dm.registerModel(entry as unknown as Parameters<DownloadManager['registerModel']>[0]);
    }
    managerRef.current = dm;

    const next: SemanticModelRow[] = [];
    for (const id of SEMANTIC_MODEL_IDS) {
      const entry = catalog.find((m) => m.id === id);
      if (!entry) continue;
      const state = await dm.getDownloadState(id);
      next.push({ entry, state, progress: null });
    }
    setRows(next);
    setLoading(false);
  }, []);
  const refreshIndex = useCallback(async () => {
    setIndexStats((prev) => ({ ...prev, loading: true }));
    try {
      const store = new IndexedDbSemanticEmbeddingStore();
      const records = await store.listAll();
      const bytes = records.reduce((sum, record) => sum + record.bytes.byteLength, 0);
      setIndexStats({ count: records.length, bytes, loading: false });
    } catch {
      setIndexStats({ count: 0, bytes: 0, loading: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshIndex();
  }, [refresh, refreshIndex]);

  const handleDownload = useCallback(async (modelId: string) => {
    const dm = managerRef.current;
    if (!dm) return;
    setBusyId(modelId);
    setRows((prev) =>
      prev.map((row) =>
        row.entry.id === modelId ? { ...row, state: 'downloading', progress: 0 } : row,
      ),
    );
    const unsub = dm.subscribeDownloadProgress(modelId, (progress) => {
      setRows((prev) =>
        prev.map((row) =>
          row.entry.id === modelId
            ? { ...row, progress: progress.total > 0 ? progress.loaded / progress.total : null }
            : row,
        ),
      );
    });
    try {
      await dm.startDownload(modelId);
      const state = await dm.getDownloadState(modelId);
      setRows((prev) => prev.map((row) => (row.entry.id === modelId ? { ...row, state } : row)));
    } finally {
      unsub();
      setBusyId(null);
    }
  }, []);

  const handleDelete = useCallback(async (modelId: string) => {
    const dm = managerRef.current;
    if (!dm) return;
    setBusyId(modelId);
    try {
      await dm.deleteModel(modelId);
      setRows((prev) =>
        prev.map((row) =>
          row.entry.id === modelId ? { ...row, state: 'not-downloaded', progress: null } : row,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleClearIndex = useCallback(async () => {
    setClearBusy(true);
    try {
      await new IndexedDbSemanticEmbeddingStore().clear();
      await refreshIndex();
    } finally {
      setClearBusy(false);
    }
  }, [refreshIndex]);

  const handleRebuildIndex = useCallback(async () => {
    setRebuildBusy(true);
    try {
      await new IndexedDbSemanticEmbeddingStore().clear();
      await refreshIndex();
    } finally {
      setRebuildBusy(false);
    }
  }, [refreshIndex]);

  const tokenizerInstalled = useMemo(
    () => rows.find((row) => row.entry.id === 'siglip-tokenizer')?.state === 'ready',
    [rows],
  );

  return (
    <div className="settings-section">
      <p className="settings-section__hint">
        Natural-language asset search is local and opt-in: you describe an image and matching assets
        rank by visual content. Models are downloaded explicitly with SHA-256 verification, and
        filename, OCR, tags, and metadata search work without them. Queries, embeddings, and ranking
        never leave this device.
      </p>

      <h3 className="settings-section__title">Models</h3>
      <RegionLoader label="Loading semantic search model status" loading={loading}>
        <ul className="bg-models-list" aria-label="Semantic search models">
          {rows.map((row) => (
            <li key={row.entry.id} className="bg-models-list__row">
              <div className="bg-models-list__info">
                <span className="bg-models-list__name">{modelLabel(row.entry.id)}</span>
                <span className="bg-models-list__meta">
                  {formatSize(row.entry.sizeBytes)} — {stateLabel(row.state)}
                  {row.entry.precision === 'int8' && ' (quantized)'}
                </span>
                {row.entry.id === 'siglip-base-patch16-224-text' && !tokenizerInstalled && (
                  <span className="bg-models-list__desc">
                    Requires the text tokenizer; install it first for natural-language queries.
                  </span>
                )}
                {row.entry.id === 'siglip-tokenizer' && (
                  <span className="bg-models-list__desc">
                    SentencePiece vocabulary used by the text encoder.
                  </span>
                )}
                {row.state === 'downloading' && row.progress !== null && (
                  <div
                    className="insp-progress"
                    role="progressbar"
                    aria-valuenow={Math.round(row.progress * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="insp-progress__bar"
                      style={{ width: `${Math.round(row.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="bg-models-list__actions">
                {row.state === 'ready' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(row.entry.id)}
                    disabled={busyId !== null}
                  >
                    <Icon name="Trash2" label={undefined} size="0.875rem" />
                    Remove
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleDownload(row.entry.id)}
                    disabled={busyId !== null}
                  >
                    <Icon name="Download" label={undefined} size="0.875rem" />
                    {row.state === 'paused' ? 'Resume' : 'Download'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </RegionLoader>

      <h3 className="settings-section__title">Search index</h3>
      <p className="settings-section__hint">
        Derived data: embeddings are recomputed from your assets whenever they change. Clearing the
        index keeps every asset and all filename/OCR/tag search intact; the Asset Browser rebuilds
        it in the background as it re-encodes images.
      </p>
      <div className="semantic-settings__index-stats" aria-live="polite">
        {indexStats.loading ? (
          <span>Counting indexed assets…</span>
        ) : (
          <span>{`Indexed assets: ${indexStats.count} · Search index: ${formatSize(indexStats.bytes)}`}</span>
        )}
      </div>
      <div className="semantic-settings__index-actions">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleRebuildIndex()}
          disabled={clearBusy || rebuildBusy}
        >
          <Icon name="RefreshCw" label={undefined} size="0.875rem" />
          Rebuild Index
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleClearIndex()}
          disabled={clearBusy || rebuildBusy}
        >
          <Icon name="Trash2" label={undefined} size="0.875rem" />
          Clear Index
        </Button>
      </div>
      {(clearBusy || rebuildBusy) && (
        <p className="semantic-settings__busy" role="status">
          {rebuildBusy
            ? 'Clearing index — assets re-index when the Asset Browser opens'
            : 'Clearing index…'}
        </p>
      )}
    </div>
  );
}
