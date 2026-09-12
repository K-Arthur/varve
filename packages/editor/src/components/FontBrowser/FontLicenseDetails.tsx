/**
 * FontLicenseDetails — compact license and provenance panel for a font family.
 *
 * Displays copyright, license, vendor, embedding rights, and format metadata
 * from the FontRegistry. Empty fields are omitted so the panel stays clean.
 */
import { embeddingPolicyFromRights, getFontRegistry } from '@varve/engine';
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
  const embeddingPolicy =
    meta?.embeddingPolicy ??
    (meta?.embeddingRights ? embeddingPolicyFromRights(meta.embeddingRights) : undefined);
  const licenseProvenance = meta?.licenseProvenance ?? (meta?.license ? 'declared' : 'unknown');

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

      {embeddingPolicy && (
        <>
          <p className="font-license-details__row">
            <span className="font-license-details__label">Base embedding</span>
            <span
              className={`font-license-details__value font-license-details__value--${embeddingPolicy.baseRights}`}
            >
              {embeddingPolicy.baseRights}
            </span>
          </p>
          <p className="font-license-details__row">
            <span className="font-license-details__label">No subsetting</span>
            <span
              className={`font-license-details__value ${embeddingPolicy.noSubsetting ? 'font-license-details__value--warning' : 'font-license-details__value--neutral'}`}
            >
              {embeddingPolicy.noSubsetting ? 'Declared' : 'No'}
            </span>
          </p>
          <p className="font-license-details__row">
            <span className="font-license-details__label">Bitmap only</span>
            <span
              className={`font-license-details__value ${embeddingPolicy.bitmapOnly ? 'font-license-details__value--warning' : 'font-license-details__value--neutral'}`}
            >
              {embeddingPolicy.bitmapOnly ? 'Declared' : 'No'}
            </span>
          </p>
        </>
      )}

      {meta?.license && (
        <p className="font-license-details__row">
          <span className="font-license-details__label">License</span>
          <span className="font-license-details__value font-license-details__value--license">
            {meta.license}
          </span>
        </p>
      )}

      <p className="font-license-details__row">
        <span className="font-license-details__label">License source</span>
        <span
          className={`font-license-details__value font-license-details__value--${licenseProvenance}`}
        >
          {licenseProvenance === 'declared' ? 'Declared by font' : 'Unknown — verify before export'}
        </span>
      </p>

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
