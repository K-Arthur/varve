/**
 * IconPackManager — pack-level storage management: browse the curated
 * catalogue, download packs with progress and cancellation, check for
 * updates via last-modified, remove packs from cache, inspect per-pack
 * storage, install the bundled starter pack, and import custom SVG packs.
 */

import {
  DEFAULT_CATALOGUE_PREFIXES,
  ICON_CATALOGUE,
  type IconPackInfo,
  isBrandPack,
  type SanitizeWarning,
  sanitizeSvg,
} from '@varve/engine';
import { Button, Icon } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadPack, type PackDownloadProgress } from './iconAcquisition';
import {
  getCacheSize,
  getPackLastModified,
  getPackStats,
  getStoredIcon,
  type IconPackStorageStats,
  type IconStorageRecord,
  removePackFromCache,
  scanCacheIntegrity,
  storeIcon,
} from './iconStorage';
import './PackManager.css';

export interface IconPackManagerProps {
  packs: IconPackInfo[];
  packsLoading: boolean;
  onClose: () => void;
  /** Opens the pack inside the icon browser (browse mode). */
  onBrowsePack: (prefix: string) => void;
  /** Called after any storage change so the browser refreshes. */
  onStorageChanged?: () => void;
  /** When true, show the starter-pack section (bundled offline content). */
  showStarterPack?: boolean;
}

const STARTER_PACK_URL = 'packs/starter-pack.json';

export interface StarterPackManifest {
  format: 'varve-starter-pack';
  version: string;
  generatedAt: string;
  packs: Array<{
    prefix: string;
    name: string;
    version?: string;
    lastModified?: number;
    spdx: string;
    licenceUrl: string;
    attributionRequired: boolean;
    icons: Array<{ name: string; body: string; width?: number; height?: number }>;
  }>;
}

export function IconPackManager({
  packs,
  packsLoading,
  onClose,
  onBrowsePack,
  onStorageChanged,
  showStarterPack = true,
}: IconPackManagerProps) {
  const [stats, setStats] = useState<IconPackStorageStats[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [progress, setProgress] = useState<Record<string, PackDownloadProgress>>({});
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [starterState, setStarterState] = useState<'idle' | 'installing' | 'done' | 'error'>(
    'idle',
  );
  const [integrity, setIntegrity] = useState<{ total: number; corrupt: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<Map<string, AbortController>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setStats(await getPackStats());
    setTotalBytes(await getCacheSize());
    setIntegrity(await scanCacheIntegrity());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const catalogue = DEFAULT_CATALOGUE_PREFIXES.map((prefix) => {
    const live = packs.find((p) => p.prefix === prefix);
    const installed = stats.find((s) => s.prefix === prefix);
    return {
      prefix,
      name: live?.name ?? ICON_CATALOGUE[prefix]?.name ?? prefix,
      total: live?.total ?? 0,
      spdx: live?.licence?.spdxId ?? ICON_CATALOGUE[prefix]?.spdx,
      licenceUrl: live?.licence?.url,
      brand: isBrandPack(prefix),
      installed: installed?.count ?? 0,
      bytes: installed?.bytes ?? 0,
    };
  });

  const startDownload = useCallback(
    async (prefix: string) => {
      if (installing.has(prefix) || abortRef.current.has(prefix)) return;
      const controller = new AbortController();
      abortRef.current.set(prefix, controller);
      setInstalling((prev) => new Set(prev).add(prefix));
      setNotice(null);
      const result = await downloadPack(prefix, {
        signal: controller.signal,
        onProgress: (p) => setProgress((prev) => ({ ...prev, [prefix]: p })),
        incremental: true,
        yieldMs: 5,
      });
      setProgress((prev) => ({ ...prev, [prefix]: result }));
      setInstalling((prev) => {
        const next = new Set(prev);
        next.delete(prefix);
        return next;
      });
      abortRef.current.delete(prefix);
      if (result.status === 'complete') {
        setNotice(`Pack "${prefix}" downloaded (${result.completed.toLocaleString()} icons).`);
      } else if (result.status === 'cancelled') {
        setNotice(
          `Pack "${prefix}" download cancelled (${result.completed.toLocaleString()} icons stored).`,
        );
      } else {
        setNotice(
          `Pack "${prefix}" finished with ${result.failed} failures — retry the failed icons or reinstall.`,
        );
      }
      await refresh();
      onStorageChanged?.();
    },
    [installing, refresh, onStorageChanged],
  );

  const cancelDownload = useCallback((prefix: string) => {
    abortRef.current.get(prefix)?.abort();
  }, []);

  const removePack = useCallback(
    async (prefix: string) => {
      const removed = await removePackFromCache(prefix);
      setNotice(`Removed ${removed} cached icons from "${prefix}".`);
      await refresh();
      onStorageChanged?.();
    },
    [refresh, onStorageChanged],
  );

  const checkUpdate = useCallback(async (prefix: string) => {
    try {
      const { getIconProviderRegistry } = await import('@varve/engine');
      const provider = getIconProviderRegistry().get('iconify');
      if (!provider?.getLastModified) return;
      const modified = await provider.getLastModified([prefix]);
      const remote = modified[prefix];
      const local = await getPackLastModified(prefix);
      if (remote === undefined) return;
      if (local === undefined) {
        setNotice(`Pack "${prefix}" has no cached data yet.`);
        return;
      }
      if (remote > local) {
        setNotice(
          `An update is available for "${prefix}" — download it again to refresh cached icons.`,
        );
      } else {
        setNotice(`Pack "${prefix}" is up to date.`);
      }
    } catch {
      setNotice(`Could not check for updates (offline?).`);
    }
  }, []);

  const installStarterPack = useCallback(async () => {
    setStarterState('installing');
    setNotice(null);
    try {
      const res = await fetch(STARTER_PACK_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = (await res.json()) as StarterPackManifest;
      if (manifest.format !== 'varve-starter-pack') throw new Error('invalid manifest');
      let installed = 0;
      for (const pack of manifest.packs) {
        for (const icon of pack.icons) {
          const canonicalId = `iconify:${pack.prefix}:${icon.name}`;
          const cached = await getStoredIcon(canonicalId);
          if (cached?.svg) continue;
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width ?? 24} ${icon.height ?? 24}" ` +
            `width="${icon.width ?? 24}" height="${icon.height ?? 24}"><title>${escapeXml(icon.name)}</title>${icon.body}</svg>`;
          let sanitized: string;
          try {
            sanitized = sanitizeSvg(svg).svg;
          } catch {
            continue;
          }
          const record: IconStorageRecord = {
            id: canonicalId,
            name: icon.name,
            providerId: 'iconify',
            prefix: pack.prefix,
            canonicalId,
            svg: sanitized,
            licence: pack.name,
            spdxId: pack.spdx,
            licenceUrl: pack.licenceUrl,
            attributionText: pack.attributionRequired ? `Licensed under ${pack.spdx}` : undefined,
            styles: ['outline'],
            storedAt: Date.now(),
            lastAccessedAt: Date.now(),
            byteSize: new TextEncoder().encode(sanitized).byteLength,
            sourceVersion: pack.version,
            lastModified: pack.lastModified,
            sanitizerVersion: '2.0.0',
            pinned: true,
          };
          try {
            await storeIcon(record);
            installed++;
          } catch {
            // quota — stop installing further icons
            break;
          }
        }
      }
      setStarterState(installed > 0 ? 'done' : 'error');
      setNotice(
        installed > 0
          ? `Starter pack installed: ${installed} icons ready for offline use.`
          : 'Starter pack icons were already installed.',
      );
      await refresh();
      onStorageChanged?.();
    } catch (err) {
      setStarterState('error');
      setNotice(
        `Could not install the starter pack: ${err instanceof Error ? err.message : 'unknown error'}.`,
      );
    }
  }, [refresh, onStorageChanged]);

  const importCustomSvgs = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const prefix = 'custom';
      let installed = 0;
      let failed = 0;
      setNotice(null);
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith('.svg')) {
          failed++;
          continue;
        }
        try {
          const text = await file.text();
          const name = file.name
            .replace(/\.svg$/i, '')
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-');
          const canonicalId = `local:${prefix}:${name}`;
          let sanitized: string;
          try {
            sanitized = sanitizeSvg(text).svg;
          } catch {
            failed++;
            continue;
          }
          const record: IconStorageRecord = {
            id: canonicalId,
            name,
            providerId: 'local',
            prefix,
            canonicalId,
            svg: sanitized,
            styles: ['outline'],
            storedAt: Date.now(),
            lastAccessedAt: Date.now(),
            byteSize: new TextEncoder().encode(sanitized).byteLength,
            sanitizerVersion: '2.0.0',
            pinned: true,
          };
          await storeIcon(record);
          installed++;
        } catch {
          failed++;
        }
      }
      setNotice(
        `Imported ${installed} custom SVG${installed === 1 ? '' : 's'}${failed > 0 ? ` (${failed} rejected)` : ''}.`,
      );
      await refresh();
      onStorageChanged?.();
    },
    [refresh, onStorageChanged],
  );

  return (
    <div className="icon-pack-manager" role="dialog" aria-label="Icon pack manager">
      <div className="icon-pack-manager__header">
        <h3 className="icon-pack-manager__title">Icon packs</h3>
        <div className="icon-pack-manager__header-actions">
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Icon name="Upload" size={14} /> Import SVG
          </Button>
          <button
            type="button"
            className="icon-pack-manager__close"
            onClick={onClose}
            aria-label="Close pack manager"
          >
            <Icon name="X" size={16} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => void importCustomSvgs(e.target.files)}
        />
      </div>

      {notice && (
        <div className="icon-pack-manager__notice" role="status">
          {notice}
        </div>
      )}

      <div className="icon-pack-manager__summary">
        <span>{stats.reduce((sum, s) => sum + s.count, 0).toLocaleString()} icons cached</span>
        <span>{(totalBytes / 1024 / 1024).toFixed(1)} MiB</span>
        {integrity && (
          <span className={integrity.corrupt > 0 ? 'icon-pack-manager__summary--warn' : ''}>
            {integrity.corrupt > 0
              ? `${integrity.corrupt} corrupt entries`
              : `${integrity.total} entries ok`}
          </span>
        )}
      </div>

      <div className="icon-pack-manager__scroll">
        {showStarterPack && (
          <section className="icon-pack-manager__section">
            <h4 className="icon-pack-manager__section-title">Offline starter pack</h4>
            <p className="icon-pack-manager__section-desc">
              ~40 common UI icons (Material Design Icons + Lucide) bundled with the app for instant
              offline use. Licences: Apache-2.0 and ISC.
            </p>
            <Button
              variant={starterState === 'done' ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void installStarterPack()}
              disabled={starterState === 'installing'}
            >
              <Icon name={starterState === 'done' ? 'Check' : 'Download'} size={14} />
              {starterState === 'installing'
                ? 'Installing…'
                : starterState === 'done'
                  ? 'Installed'
                  : 'Install starter pack'}
            </Button>
          </section>
        )}

        <section className="icon-pack-manager__section">
          <h4 className="icon-pack-manager__section-title">Curated packs</h4>
          {packsLoading ? (
            <p className="icon-pack-manager__loading">Loading pack metadata…</p>
          ) : (
            <ul className="icon-pack-manager__list">
              {catalogue.map((pack) => {
                const p = progress[pack.prefix];
                const isInstalling = installing.has(pack.prefix);
                return (
                  <li key={pack.prefix} className="icon-pack-manager__pack">
                    <div className="icon-pack-manager__pack-main">
                      <span className="icon-pack-manager__pack-name">
                        {pack.name}
                        {pack.brand && (
                          <span className="icon-pack-manager__tm" title="Brand/trademark pack">
                            TM
                          </span>
                        )}
                      </span>
                      <span className="icon-pack-manager__pack-meta">
                        {pack.total > 0 ? `${pack.total.toLocaleString()} icons` : '…'}
                        {pack.spdx ? ` · ${pack.spdx}` : ' · licence unknown'}
                        {pack.installed > 0 && ` · ${pack.installed.toLocaleString()} cached`}
                        {pack.bytes > 0 && ` (${(pack.bytes / 1024 / 1024).toFixed(1)} MiB)`}
                      </span>
                    </div>
                    <div className="icon-pack-manager__pack-actions">
                      <Button variant="ghost" size="sm" onClick={() => onBrowsePack(pack.prefix)}>
                        Browse
                      </Button>
                      {isInstalling ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => cancelDownload(pack.prefix)}
                        >
                          <Icon name="Square" size={12} />
                          {p ? `${Math.round((p.completed / Math.max(1, p.total)) * 100)}%` : '…'}
                        </Button>
                      ) : pack.installed > 0 ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void checkUpdate(pack.prefix)}
                          >
                            Check update
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void removePack(pack.prefix)}
                          >
                            Remove
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void startDownload(pack.prefix)}
                        >
                          <Icon name="Download" size={14} /> Download
                        </Button>
                      )}
                    </div>
                    {p && isInstalling && (
                      <div
                        className="icon-pack-manager__progress"
                        role="progressbar"
                        aria-valuenow={p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="icon-pack-manager__progress-bar"
                          style={{
                            width: `${p.total > 0 ? Math.min(100, (p.completed / p.total) * 100) : 0}%`,
                          }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type { SanitizeWarning };
