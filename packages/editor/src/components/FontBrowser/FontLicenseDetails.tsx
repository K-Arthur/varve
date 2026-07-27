/**
 * FontLicenseDetails — displays font license metadata, embedding permissions,
 * and usage rights for a selected font.
 *
 * Shows the license name, URL, embedding rights classification, and a
 * permissions grid indicating what operations are permitted.
 */

import type { FontLicenseInfo } from '@strata/engine/font';
import './FontLicenseDetails.css';

export interface FontLicenseDetailsProps {
  license: FontLicenseInfo;
  onClose?: () => void;
}

const EMBEDDING_RIGHTS_LABELS: Record<string, string> = {
  installable: 'Installable — full embedding permitted',
  'preview-and-print': 'Preview & Print — document may be viewed/printed but not edited',
  editable: 'Editable — document may be edited and saved',
  restricted: 'Restricted — embedding prohibited',
  'no-subsetting': 'No subsetting — full font must be embedded',
  unknown: 'Unknown — embedding rights not determined',
};

const EMBEDDING_RIGHTS_SEVERITY: Record<string, 'positive' | 'warning' | 'negative' | 'neutral'> = {
  installable: 'positive',
  editable: 'positive',
  'preview-and-print': 'warning',
  'no-subsetting': 'warning',
  restricted: 'negative',
  unknown: 'neutral',
};

const PERMISSION_LABELS: Record<keyof FontLicenseInfo['permissions'], string> = {
  commercial: 'Commercial use',
  modification: 'Modification',
  redistribution: 'Redistribution',
  desktopInstall: 'Desktop install',
  webEmbedding: 'Web embedding',
  documentEmbedding: 'Document embedding',
  printEmbedding: 'Print embedding',
  editableEmbedding: 'Editable embedding',
};

export function FontLicenseDetails({ license, onClose }: FontLicenseDetailsProps) {
  const severity = EMBEDDING_RIGHTS_SEVERITY[license.embeddingRights] ?? 'neutral';
  const rightsLabel = EMBEDDING_RIGHTS_LABELS[license.embeddingRights] ?? 'Unknown';

  const permissions = Object.entries(license.permissions) as Array<
    [keyof FontLicenseInfo['permissions'], boolean]
  >;

  return (
    <section
      className="font-license-details"
      aria-label={`License details for ${license.familyName}`}
    >
      <div className="font-license-details__header">
        <h3 className="font-license-details__title">{license.familyName}</h3>
        {onClose && (
          <button
            type="button"
            className="font-license-details__close-btn"
            onClick={onClose}
            aria-label="Close license details"
          >
            &#x2715;
          </button>
        )}
      </div>

      {license.licenseName && (
        <div className="font-license-details__row">
          <span className="font-license-details__label">License</span>
          <span className="font-license-details__value">
            {license.licenseUrl ? (
              <a
                href={license.licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-license-details__link"
              >
                {license.licenseName}
              </a>
            ) : (
              license.licenseName
            )}
          </span>
        </div>
      )}

      <div className="font-license-details__row">
        <span className="font-license-details__label">Embedding</span>
        <span className={`font-license-details__value font-license-details__value--${severity}`}>
          {rightsLabel}
        </span>
      </div>

      {license.version && (
        <div className="font-license-details__row">
          <span className="font-license-details__label">Version</span>
          <span className="font-license-details__value">{license.version}</span>
        </div>
      )}

      {license.attribution && (
        <div className="font-license-details__row">
          <span className="font-license-details__label">Attribution</span>
          <span className="font-license-details__value">{license.attribution}</span>
        </div>
      )}

      <div className="font-license-details__permissions">
        <span className="font-license-details__label">Permissions</span>
        <dl className="font-license-details__permissions-grid">
          {permissions.map(([key, value]) => (
            <div key={key} className="font-license-details__permission-item">
              <dt className="font-license-details__permission-label">{PERMISSION_LABELS[key]}</dt>
              <dd
                className={`font-license-details__permission-value font-license-details__permission-value--${value ? 'allowed' : 'denied'}`}
              >
                {value ? 'Allowed' : 'Denied'}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {license.licenseText && (
        <details className="font-license-details__text">
          <summary className="font-license-details__text-summary">Full license text</summary>
          <pre className="font-license-details__text-content">{license.licenseText}</pre>
        </details>
      )}
    </section>
  );
}
