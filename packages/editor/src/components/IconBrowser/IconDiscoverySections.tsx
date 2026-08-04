/**
 * IconDiscoverySections — curated discovery surface shown before a search:
 * recommended packs, recents, favourites, downloaded, and the browse-packs
 * catalogue groups.
 */

import {
  DEFAULT_CATALOGUE_PREFIXES,
  ICON_CATALOGUE,
  type IconPackInfo,
  isBrandPack,
} from '@varve/engine';
import { Icon, SolidIcon } from '@varve/ui';
import type { RecentIconEntry } from './recents';
import { SafeSvg } from './SafeSvg';

export interface IconDiscoverySectionsProps {
  recents: RecentIconEntry[];
  favouriteCount: number;
  downloadedCount: number;
  packs: IconPackInfo[];
  packsLoading: boolean;
  recentSvg: Map<string, string>;
  onOpenPack: (prefix: string) => void;
  onSelectRecent: (canonicalId: string) => void;
  onSelectFavourites: () => void;
  onSelectDownloaded: () => void;
  onOpenPackManager: () => void;
}

export function IconDiscoverySections({
  recents,
  favouriteCount,
  downloadedCount,
  packs,
  packsLoading,
  recentSvg,
  onOpenPack,
  onSelectRecent,
  onSelectFavourites,
  onSelectDownloaded,
  onOpenPackManager,
}: IconDiscoverySectionsProps) {
  const catalogue = DEFAULT_CATALOGUE_PREFIXES.map((prefix) => {
    const live = packs.find((p) => p.prefix === prefix);
    return {
      prefix,
      name: live?.name ?? ICON_CATALOGUE[prefix]?.name ?? prefix,
      total: live?.total ?? 0,
      spdx: ICON_CATALOGUE[prefix]?.spdx ?? live?.licence?.spdxId,
      brand: isBrandPack(prefix),
    };
  });

  return (
    <div className="icon-discovery">
      {recents.length > 0 && (
        <section className="icon-discovery__section">
          <h4 className="icon-discovery__heading">Recent</h4>
          <div className="icon-discovery__row">
            {recents.slice(0, 8).map((recent) => (
              <button
                type="button"
                key={recent.canonicalId}
                className="icon-discovery__tile"
                onClick={() => onSelectRecent(recent.canonicalId)}
                aria-label={`Insert ${recent.name}`}
              >
                {recentSvg.get(recent.canonicalId) ? (
                  <SafeSvg
                    svg={recentSvg.get(recent.canonicalId)!}
                    label={recent.name}
                    className="icon-discovery__tile-svg"
                  />
                ) : (
                  <Icon name="Clock" size={16} />
                )}
                <span className="icon-discovery__tile-name">{recent.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(favouriteCount > 0 || downloadedCount > 0) && (
        <section className="icon-discovery__section">
          <h4 className="icon-discovery__heading">Your library</h4>
          <div className="icon-discovery__actions">
            <button type="button" className="icon-discovery__action" onClick={onSelectFavourites}>
              <SolidIcon name="Heart" size={16} />
              Favourites
              <span className="icon-discovery__count">{favouriteCount}</span>
            </button>
            <button type="button" className="icon-discovery__action" onClick={onSelectDownloaded}>
              <Icon name="Download" size={16} />
              Downloaded
              <span className="icon-discovery__count">{downloadedCount}</span>
            </button>
            <button type="button" className="icon-discovery__action" onClick={onOpenPackManager}>
              <Icon name="Package" size={16} />
              Pack manager
            </button>
          </div>
        </section>
      )}

      <section className="icon-discovery__section">
        <div className="icon-discovery__heading-row">
          <h4 className="icon-discovery__heading">Browse packs</h4>
          {packsLoading && <span className="icon-discovery__loading">Loading…</span>}
        </div>
        <div className="icon-discovery__pack-list">
          {catalogue.map((pack) => (
            <button
              type="button"
              key={pack.prefix}
              className="icon-discovery__pack"
              onClick={() => onOpenPack(pack.prefix)}
            >
              <span className="icon-discovery__pack-name">
                {pack.name}
                {pack.brand && (
                  <span className="icon-discovery__pack-brand" title="Brand/trademark pack">
                    TM
                  </span>
                )}
              </span>
              <span className="icon-discovery__pack-meta">
                {pack.total > 0 ? `${pack.total.toLocaleString()} icons` : '…'}
                {pack.spdx ? ` · ${pack.spdx}` : ''}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
