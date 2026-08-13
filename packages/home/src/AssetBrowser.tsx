import type { Asset, AssetFolder, Platform } from '@varve/platform';
import { searchAssets } from '@varve/platform';
import { ContentSkeleton, Icon, type IconName, Tooltip } from '@varve/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface AssetBrowserProps {
  platform: Platform;
  workspaceId: string;
  onInsertAsset?: (asset: Asset) => void;
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

export function AssetBrowser({ platform, workspaceId, onInsertAsset }: AssetBrowserProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleImport = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        const buffer = await file.arrayBuffer();
        await platform.importAsset(workspaceId, file.name, new Uint8Array(buffer), file.type);
        await loadData();
      } catch {
        // Silently fail
      } finally {
        setImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [platform, workspaceId, loadData],
  );

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const rootFolders = useMemo(() => folders.filter((f) => f.parentId === null), [folders]);

  const currentFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );

  const subFolders = useMemo(
    () => folders.filter((f) => f.parentId === selectedFolderId),
    [folders, selectedFolderId],
  );

  const searchResults = useMemo(() => searchAssets(assets, searchQuery), [assets, searchQuery]);

  return (
    <div className="asset-browser">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg,.ttf,.otf,.woff,.woff2"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      <div className="asset-browser__header">
        <div className="asset-browser__search">
          <Icon name="Search" label={undefined} size="1rem" />
          <input
            type="text"
            className="asset-browser__search-input"
            placeholder="Describe an image or search by filename…"
            value={searchQuery}
            onChange={handleSearchChange}
            aria-label="Search assets"
          />
          {searchQuery && (
            <button
              type="button"
              className="asset-browser__search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <Icon name="X" label={undefined} size="0.875rem" />
            </button>
          )}
        </div>
        <span className="asset-browser__search-hint" aria-hidden="true">
          Local: filename · OCR · tags
        </span>
        <button
          type="button"
          className="asset-browser__import-btn"
          onClick={handleImport}
          disabled={importing}
        >
          <Icon name="Upload" label={undefined} size="1rem" />
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>

      <div className="asset-browser__body">
        <aside className="asset-browser__sidebar">
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
