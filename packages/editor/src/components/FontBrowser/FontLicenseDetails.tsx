/**
 * FontLicenseDetails — compact license and provenance panel for a font family.
 *
 * Displays copyright, license, vendor, embedding rights, and format metadata
 * from the FontRegistry. Empty fields are omitted so the panel stays clean.
 */
import { getFontRegistry } from '@varve/engine';
import { useMemo } from 'react';
import './FontLicenseDetails.css';

export interface FontLicenseDetailsProps {
  family: string;
}

export function FontLicenseDetails({ family }: FontLicenseDetailsProps) {
  const registry = useMemo(() => getFontRegistry(), []);
  const meta = registry.getMetadata(family);
  const entries = registry.getEntries(family);
  const firstEntry = entries[0];

  return (
    <div className="font-license-details">
      <div className="font-license-details__header">
        <span className="font-license-details__family">{family}</span>
        {meta?.format && <span className="font-license-details__format">{meta.format}</span>}
      </div>

      {meta?.copyright && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">Copyright</span>
          <span className="font-license-details__value">{meta.copyright}</span>
        </p>
      )}

      {meta?.vendor && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">Vendor</span>
          <span className="font-license-details__value">{meta.vendor}</span>
        </p>
      )}

      {meta?.version && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">Version</span>
          <span className="font-license-details__value">{meta.version}</span>
        </p>
      )}

      {meta?.embeddingRights && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">Embedding</span>
          <span
            className={`font-license-details__value font-license-details__value--${meta.embeddingRights}`}
          >
            {meta.embeddingRights}
          </span>
        </p>
      )}

      {meta?.license && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">License</span>
          <span className="font-license-details__value font-license-details__value--license">
            {meta.license}
          </span>
        </p>
      )}

      {firstEntry && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">Variants</span>
          <span className="font-license-details__value">
            {entries.length} face{entries.length === 1 ? '' : 's'} · weight {firstEntry.weight}
            {firstEntry.style !== 'normal' ? ` · ${firstEntry.style}` : ''}
          </span>
        </p>
      )}
    </div>
  );
}
