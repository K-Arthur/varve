import type { Asset, AssetFolder, Platform } from '@varve/platform';
import { searchAssets } from '@varve/platform';
import type { FileRejection } from '@varve/shared';
import {
  ContentSkeleton,
  FileDropZone,
  FileError,
  FileQueue,
  type FileQueueItem,
  Icon,
  type IconName,
  SearchField,
  Spinner,
  Tooltip,
} from '@varve/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HomeImportOutcome } from './homeImportNotifications';
import { useSemanticAssetSearch } from './search/useSemanticAssetSearch';

export interface AssetBrowserProps {
  platform: Platform;
  workspaceId: string;
  onInsertAsset?: (asset: Asset) => void;
  onImportComplete?: (outcome: HomeImportOutcome) => void;
}

const ASSET_KIND_ICONS: Record<string, IconName> = {
  image: 'Image',
  icon: 'Grid3x3',
  font: 'Type',
  other: 'File',
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / 1024 ** i;
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

type AssetImportItem = FileQueueItem<File>;

const ASSET_ACCEPT = 'image/*,.svg,.ttf,.otf,.woff,.woff2';
const MAX_ASSET_FILES = 50;
const MAX_ASSET_SIZE = 128 * 1024 * 1024;
let importItemSequence = 0;

function createImportItem(file: File): AssetImportItem {
  importItemSequence += 1;
  return {
    id: `asset-import-${Date.now()}-${importItemSequence}`,
    file,
    status: 'queued',
  };
}

export function AssetBrowser({
  platform,
  workspaceId,
  onInsertAsset,
  onImportComplete,
}: AssetBrowserProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importItems, setImportItems] = useState<AssetImportItem[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<FileRejection<File>[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const assetList = await platform.listAssets(workspaceId, selectedFolderId ?? undefined);
      // Search locally over the scoped asset list. This keeps query updates
      // instant and lets the browser use the same rank-fusion contract as the
      // desktop/native adapters when OCR or semantic ranks become available.
      const fetchedFolders: AssetFolder[] = [];
      setAssets(assetList);
      setFolders(fetchedFolders);
    } catch {
      setAssets([]);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [platform, workspaceId, selectedFolderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateImportItem = useCallback((id: string, patch: Partial<AssetImportItem>) => {
    setImportItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const processImportItems = useCallback(
    async (items: readonly AssetImportItem[]) => {
      setImporting(true);
      let success = 0;
      let failed = 0;
      for (const item of items) {
        updateImportItem(item.id, { status: 'processing', progress: 0, error: undefined });
        try {
          const buffer = await item.file.arrayBuffer();
          updateImportItem(item.id, { progress: 50 });
          await platform.importAsset(
            workspaceId,
            item.file.name,
            new Uint8Array(buffer),
            item.file.type || 'application/octet-stream',
          );
          updateImportItem(item.id, { status: 'complete', progress: 100 });
          success += 1;
        } catch (error) {
          updateImportItem(item.id, {
            status: 'failed',
            progress: 0,
            error: error instanceof Error ? error.message : String(error),
          });
          failed += 1;
        }
      }
      setImporting(false);
      await loadData();
      onImportComplete?.({ success, failed, total: items.length });
    },
    [loadData, onImportComplete, platform, updateImportItem, workspaceId],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      setSelectionErrors([]);
      const items = files.map(createImportItem);
      setImportItems(items);
      await processImportItems(items);
    },
    [processImportItems],
  );

  const handleReject = useCallback((rejections: FileRejection<File>[]) => {
    setSelectionErrors(rejections);
  }, []);

  const removeImportItem = useCallback((id: string) => {
    setImportItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const retryImport = useCallback(
    (id: string) => {
      const failed = importItems.find((item) => item.id === id);
      if (!failed || importing) return;
      const retryItem: AssetImportItem = { ...failed, status: 'queued', error: undefined };
      setImportItems((previous) => previous.map((item) => (item.id === id ? retryItem : item)));
      void processImportItems([retryItem]);
    },
    [importItems, importing, processImportItems],
  );

  const rootFolders = useMemo(() => folders.filter((f) => f.parentId === null), [folders]);

  const currentFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const subFolders = useMemo(
    () => folders.filter((f) => f.parentId === selectedFolderId),
    [folders, selectedFolderId],
  );

  const hasQuery = searchQuery.trim().length > 0;
  const hasImageAssets = useMemo(() => assets.some((asset) => asset.kind === 'image'), [assets]);

  const {
    semanticRanks,
    status: semanticStatus,
    semanticBusy,
    downloadImageModel,
    downloadTextModel,
    downloadProgress,
    downloadingModelId,
  } = useSemanticAssetSearch(platform, assets, searchQuery);

  const searchResults = useMemo(
    () => searchAssets(assets, searchQuery, { semanticRanks: semanticRanks ?? undefined }),
    [assets, searchQuery, semanticRanks],
  );

  return (
    <div className="asset-browser">
      <div className="asset-browser__header">
        <SearchField
          value={searchQuery}
          onChange={(v) => setSearchQuery(v)}
          placeholder="Describe an image or search by filename..."
          aria-label="Search assets"
        />
        <span className="asset-browser__search-hint" aria-hidden="true">
          Local: filename · OCR · tags · visual
        </span>
        <FileDropZone
          className="asset-browser__import-zone"
          size="compact"
          label="Drop assets to add"
          description="Images, SVG, and fonts stay local"
          actionLabel={importing ? 'Importing…' : 'Import'}
          icon="FileUp"
          accept={ASSET_ACCEPT}
          multiple
          maxFiles={MAX_ASSET_FILES}
          maxSize={MAX_ASSET_SIZE}
          processing={importing}
          onFiles={handleFiles}
          onReject={handleReject}
        />
      </div>

      {selectionErrors.length > 0 && (
        <FileError
          title="Some assets were not added"
          message={selectionErrors
            .map((rejection) => `${rejection.file.name}: ${rejection.reason}`)
            .join(' ')}
          compact
        />
      )}

      <FileQueue
        className="asset-browser__import-queue"
        items={importItems}
        label="Asset import queue"
        onRemove={removeImportItem}
        onRetry={retryImport}
      />

      {(hasQuery ||
        downloadingModelId ||
        (!semanticStatus.imageModelAvailable && hasImageAssets) ||
        (semanticStatus.indexing && semanticStatus.indexedCount < semanticStatus.totalCount)) && (
        <div className="asset-browser__semantic-status" role="status" aria-live="polite">
          {downloadingModelId ? (
            <span>
              <Icon name="Download" label={undefined} size="0.875rem" />
              Preparing visual search
              {downloadProgress !== null ? ` · ${Math.round(downloadProgress * 100)}%` : ''}
            </span>
          ) : hasQuery && !semanticStatus.textModelAvailable ? (
            <button
              type="button"
              className="asset-browser__semantic-cta"
              onClick={() => void downloadTextModel()}
            >
              <Icon name="Search" label={undefined} size="0.875rem" />
              Download natural-language search model
            </button>
          ) : !semanticStatus.imageModelAvailable && hasImageAssets ? (
            <button
              type="button"
              className="asset-browser__semantic-cta"
              onClick={() => void downloadImageModel()}
            >
              <Icon name="Image" label={undefined} size="0.875rem" />
              Download visual search model to index assets
            </button>
          ) : semanticStatus.indexing && semanticStatus.indexedCount < semanticStatus.totalCount ? (
            <span>
              <Spinner size="sm" />
              Indexing local assets · {semanticStatus.indexedCount} / {semanticStatus.totalCount}
            </span>
          ) : semanticBusy ? (
            <span>
              <Spinner size="sm" />
              Searching…
            </span>
          ) : null}
        </div>
      )}

      <div className="asset-browser__body">
        <aside className="asset-browser__sidebar" aria-label="Folders">
          <button
            type="button"
            className={`asset-browser__folder${selectedFolderId === null ? ' asset-browser__folder--active' : ''}`}
            onClick={() => setSelectedFolderId(null)}
          >
            <Icon name="Folder" label={undefined} size="1rem" />
            <span>All Assets</span>
          </button>
          {rootFolders.map((folder) => (
            <AssetFolderRow
              key={folder.id}
              folder={folder}
              subFolders={subFolders}
              selected={selectedFolderId === folder.id}
              onSelect={setSelectedFolderId}
              depth={0}
            />
          ))}
          {rootFolders.length === 0 && <p className="asset-browser__sidebar-empty">No folders</p>}
        </aside>

        <div className="asset-browser__content">
          {currentFolder && (
            <div className="asset-browser__breadcrumb">
              <button
                type="button"
                className="asset-browser__breadcrumb-link"
                onClick={() => setSelectedFolderId(null)}
              >
                All Assets
              </button>
              <span className="asset-browser__breadcrumb-sep">/</span>
              <span className="asset-browser__breadcrumb-current">{currentFolder.name}</span>
            </div>
          )}

          {loading ? (
            <div className="asset-browser__loading">
              <ContentSkeleton variant="grid" columns={3} rows={3} label="Loading assets" />
            </div>
          ) : searchResults.length === 0 && subFolders.length === 0 ? (
            <div className="asset-browser__empty">
              <Icon name="Image" label={undefined} size="2rem" />
              <p className="asset-browser__empty-text">
                {searchQuery.trim()
                  ? 'No assets match your search'
                  : 'No assets yet. Import an image, icon, or font to get started.'}
              </p>
            </div>
          ) : (
            <>
              {subFolders.length > 0 && (
                <div className="asset-browser__subfolders">
                  <span className="asset-browser__subfolder-label">Folders</span>
                  <div className="asset-browser__subfolder-grid">
                    {subFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="asset-browser__subfolder-card"
                        onClick={() => setSelectedFolderId(folder.id)}
                      >
                        <Icon name="Folder" label={undefined} size="1.5rem" />
                        <span className="asset-browser__subfolder-name">{folder.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="asset-browser__grid">
                {searchResults.map(({ asset, reasons }) => (
                  <div key={asset.id} className="asset-browser__card">
                    <div className="asset-browser__card-thumb">
                      {asset.thumbnailHash ? (
                        <img
                          src={asset.thumbnailHash}
                          alt={asset.name}
                          className="asset-browser__card-thumb-img"
                        />
                      ) : (
                        <Icon
                          name={ASSET_KIND_ICONS[asset.kind] ?? 'File'}
                          label={undefined}
                          size="1.5rem"
                        />
                      )}
                    </div>
                    <div className="asset-browser__card-body">
                      <Tooltip label={asset.name} truncationOnly>
                        <span className="asset-browser__card-name">{asset.name}</span>
                      </Tooltip>
                      <div className="asset-browser__card-meta">
                        <span className="asset-browser__card-kind">{asset.kind}</span>
                        <span>{formatFileSize(asset.size)}</span>
                      </div>
                      {searchQuery.trim() && reasons.length > 0 && (
                        <span className="asset-browser__card-reason">{reasons[0]?.label}</span>
                      )}
                    </div>
                    {onInsertAsset && (
                      <button
                        type="button"
                        className="asset-browser__card-insert"
                        onClick={() => onInsertAsset(asset)}
                        aria-label={`Insert ${asset.name}`}
                      >
                        <Icon name="Plus" label={undefined} size="0.875rem" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetFolderRow({
  folder,
  subFolders,
  selected,
  onSelect,
  depth,
}: {
  folder: AssetFolder;
  subFolders: AssetFolder[];
  selected: boolean;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const children = subFolders.filter((f) => f.parentId === folder.id);

  return (
    <>
      <button
        type="button"
        className={`asset-browser__folder${selected ? ' asset-browser__folder--active' : ''}`}
        style={{ paddingLeft: `calc(var(--space-3) + ${depth * 12}px)` }}
        onClick={() => onSelect(folder.id)}
      >
        <Icon name="Folder" label={undefined} size="1rem" />
        <span>{folder.name}</span>
      </button>
      {children.map((child) => (
        <AssetFolderRow
          key={child.id}
          folder={child}
          subFolders={subFolders}
          selected={selected}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}
