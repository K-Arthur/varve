/**
 * Icon attribution inventory — per-document collection of icon provenance
 * for export-time attribution reports.
 *
 * Deduplicated by pack + licence: repeated uses of the same icon produce one
 * entry per document icon asset (assets are themselves deduplicated by
 * content hash at insertion time).
 */

import type { Document } from './document';

/** Minimal licence shape for attribution reports (scene-local types). */
export interface IconAttributionLicence {
  spdxId: string;
  name: string;
  url: string;
  commercialUse: boolean;
  modification: boolean;
  redistribution: boolean;
  attributionRequired: boolean;
  attributionText: string;
}

export interface IconAttributionEntry {
  iconName: string;
  provider: string;
  pack?: string;
  licence: IconAttributionLicence;
  sourceUrl?: string;
}

/**
 * Collect every distinct attributed icon embedded in the document.
 * Unlicensed (licence-less) assets still appear with an unknown-licence
 * entry so the report never silently drops provenance.
 */
export function collectIconAttribution(doc: Document): IconAttributionEntry[] {
  const assets = doc.iconAssets ?? {};
  const entries: IconAttributionEntry[] = [];
  for (const asset of Object.values(assets)) {
    const attributionText = asset.attributionText ?? asset.attribution ?? '';
    const spdxId = asset.spdxId ?? 'unknown';
    const verified = spdxId !== 'unknown';
    const licence: IconAttributionLicence = {
      spdxId,
      name: asset.licence ?? 'Unknown Licence',
      url: asset.licenceUrl ?? '',
      commercialUse: verified,
      modification: verified,
      redistribution: verified,
      attributionRequired: Boolean(attributionText) || spdxId === 'unknown',
      attributionText,
    };
    entries.push({
      iconName: asset.name,
      provider: asset.providerId ?? 'local',
      pack: asset.prefix,
      licence,
      sourceUrl: asset.sourceUrl,
    });
  }
  // Stable ordering: by licence, then pack, then name.
  return entries.sort(
    (a, b) =>
      a.licence.spdxId.localeCompare(b.licence.spdxId) ||
      (a.pack ?? '').localeCompare(b.pack ?? '') ||
      a.iconName.localeCompare(b.iconName),
  );
}

/** True when the document contains at least one icon requiring attribution. */
export function hasAttributionRequirements(doc: Document): boolean {
  const assets = doc.iconAssets ?? {};
  return Object.values(assets).some(
    (a) => Boolean(a.attributionText || a.attribution) || !a.spdxId,
  );
}

/** Plain-text attribution report (used by the export report action). */
export function generateAttributionReportText(entries: IconAttributionEntry[]): string {
  const grouped = new Map<string, IconAttributionEntry[]>();
  for (const entry of entries) {
    const key = entry.licence.spdxId;
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }
  const lines: string[] = ['Icon Attribution Report', '======================', ''];
  for (const [spdxId, list] of grouped) {
    const licence = list[0]!.licence;
    lines.push(`## ${licence.name} (${spdxId})`);
    if (licence.url) lines.push(`URL: ${licence.url}`);
    if (!licence.commercialUse) {
      lines.push('NOTE: Commercial use is NOT permitted under this licence.');
    }
    if (licence.attributionRequired) {
      lines.push(
        `Attribution: ${licence.attributionText || `Required — credit "${licence.name}" (${spdxId}).`}`,
      );
    }
    lines.push('');
    for (const icon of list) {
      const pack = icon.pack ? ` (${icon.pack})` : '';
      lines.push(`  - "${icon.iconName}" from ${icon.provider}${pack}`);
      if (icon.sourceUrl) lines.push(`    Source: ${icon.sourceUrl}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Markdown attribution report. */
export function generateAttributionReportMarkdown(entries: IconAttributionEntry[]): string {
  const grouped = new Map<string, IconAttributionEntry[]>();
  for (const entry of entries) {
    const key = entry.licence.spdxId;
    const list = grouped.get(key) ?? [];
    list.push(entry);
    grouped.set(key, list);
  }
  const lines: string[] = ['# Icon Attribution', ''];
  for (const [spdxId, list] of grouped) {
    const licence = list[0]!.licence;
    lines.push(`## ${licence.name} (${spdxId})`);
    if (licence.url) lines.push(`License URL: ${licence.url}`);
    if (!licence.commercialUse) {
      lines.push('> Note: commercial use is NOT permitted under this licence.');
    }
    lines.push('');
    for (const icon of list) {
      const pack = icon.pack ? ` (${icon.pack})` : '';
      lines.push(`- "${icon.iconName}" by ${icon.provider}${pack}`);
      if (icon.sourceUrl) lines.push(`  Source: ${icon.sourceUrl}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
