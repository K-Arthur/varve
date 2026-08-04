/**
 * IconDetailsPanel — provenance, licence, and action surface for the
 * selected icon.
 */

import type { IconSourceDescriptor } from '@varve/engine';
import { Button, Icon, SolidIcon } from '@varve/ui';
import { SafeSvg } from './SafeSvg';

export interface IconDetailsPanelProps {
  descriptor: IconSourceDescriptor;
  svg?: string;
  isFavourite: boolean;
  isInDocument: boolean;
  isCached: boolean;
  isBrand: boolean;
  isAcquiring: boolean;
  onInsert: () => void;
  onToggleFavourite: () => void;
  onToggleCache: () => void;
  onCopySvg: () => void;
}

const LICENCE_LABELS: Record<string, string> = {
  'Apache-2.0': 'Apache License 2.0',
  MIT: 'MIT License',
  ISC: 'ISC License',
  'CC0-1.0': 'CC0 1.0 Universal',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-NC-4.0': 'CC BY-NC 4.0',
};

export function IconDetailsPanel({
  descriptor,
  svg,
  isFavourite,
  isInDocument,
  isCached,
  isBrand,
  isAcquiring,
  onInsert,
  onToggleFavourite,
  onToggleCache,
  onCopySvg,
}: IconDetailsPanelProps) {
  const licence = descriptor.licence;
  const licenceName = licence.spdxId
    ? (LICENCE_LABELS[licence.spdxId] ?? licence.spdxId)
    : (licence.title ?? 'Unknown licence');
  const commercial = licence.commercialUse === true;
  const attributionRequired = licence.attributionRequired === true;

  return (
    <div className="icon-details">
      <div className="icon-details__preview">
        {svg ? (
          <SafeSvg
            svg={svg}
            label={`${descriptor.displayName} preview`}
            className="icon-details__svg"
          />
        ) : isAcquiring ? (
          <div className="icon-details__preview-loading" role="status" aria-label="Loading preview">
            <Icon name="Loader" size={24} className="icon-card__spinner" />
          </div>
        ) : (
          <div
            className="icon-details__preview-loading"
            role="status"
            aria-label="No preview available"
          >
            <Icon name="Image" size={24} />
          </div>
        )}
      </div>

      <div className="icon-details__body">
        <h3 className="icon-details__name">{descriptor.displayName}</h3>
        <div className="icon-details__pack">
          {descriptor.packId}
          {descriptor.width && descriptor.height
            ? ` 00b7 ${descriptor.width}x${descriptor.height}`
            : ''}
        </div>

        <dl className="icon-details__meta">
          {descriptor.aliases.length > 0 && (
            <div className="icon-details__meta-row">
              <dt>Also known as</dt>
              <dd>{descriptor.aliases.join(', ')}</dd>
            </div>
          )}
          <div className="icon-details__meta-row">
            <dt>Pack</dt>
            <dd>
              {descriptor.packId}
              {descriptor.author ? ` — ${descriptor.author}` : ''}
            </dd>
          </div>
          {descriptor.sourceUrl && (
            <div className="icon-details__meta-row">
              <dt>Source</dt>
              <dd>
                <a
                  href={descriptor.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="icon-details__link"
                >
                  {descriptor.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40)}
                </a>
              </dd>
            </div>
          )}
          <div className="icon-details__meta-row">
            <dt>Licence</dt>
            <dd>
              <span className={licence.unverified ? 'icon-details__licence--unknown' : ''}>
                {licenceName}
              </span>
              {licence.unverified && (
                <span className="icon-details__licence-note"> (unverified)</span>
              )}
              {licence.url && (
                <a
                  href={licence.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="icon-details__link"
                >
                  {' '}
                  — terms
                </a>
              )}
            </dd>
          </div>
          <div className="icon-details__meta-row">
            <dt>Commercial use</dt>
            <dd>
              {licence.unverified ? (
                <span className="icon-details__warn">Not verified</span>
              ) : commercial ? (
                'Permitted'
              ) : (
                <span className="icon-details__warn">Not permitted</span>
              )}
            </dd>
          </div>
          <div className="icon-details__meta-row">
            <dt>Attribution</dt>
            <dd>
              {licence.unverified ? (
                <span className="icon-details__warn">Unknown</span>
              ) : attributionRequired ? (
                'Required'
              ) : (
                'Not required'
              )}
            </dd>
          </div>
          {descriptor.paletteType === 'multicolor' && (
            <div className="icon-details__meta-row">
              <dt>Palette</dt>
              <dd>Multicolour</dd>
            </div>
          )}
          {descriptor.version && (
            <div className="icon-details__meta-row">
              <dt>Version</dt>
              <dd>{descriptor.version}</dd>
            </div>
          )}
          <div className="icon-details__meta-row">
            <dt>Offline</dt>
            <dd>{isCached ? 'Downloaded' : 'Online only'}</dd>
          </div>
        </dl>

        {isBrand && (
          <div className="icon-details__trademark" role="note">
            Brand icon: the SVG files are freely licensed, but the depicted logos remain trademarks
            of their owners. Confirm trademark clearance before commercial use.
          </div>
        )}
        {isInDocument && (
          <div className="icon-details__in-doc" role="note">
            Already used in this document — inserting adds another instance without duplicating the
            embedded asset.
          </div>
        )}

        <div className="icon-details__actions">
          <Button variant="primary" size="sm" onClick={onInsert} disabled={isAcquiring || !svg}>
            {isAcquiring ? 'Loading…' : 'Insert'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleFavourite}
            aria-pressed={isFavourite}
          >
            <SolidIcon name={isFavourite ? 'HeartFill' : 'Heart'} size={14} />
            {isFavourite ? 'Favourited' : 'Favourite'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopySvg} disabled={!svg}>
            <Icon name="Copy" size={14} />
            Copy SVG
          </Button>
          <Button variant="ghost" size="sm" onClick={onToggleCache} disabled={!svg}>
            <Icon name={isCached ? 'Trash2' : 'Download'} size={14} />
            {isCached ? 'Remove' : 'Download'}
          </Button>
        </div>
      </div>
    </div>
  );
}
