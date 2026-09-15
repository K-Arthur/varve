/**
 * Metadata policy resolution for canonical export (Strata export pipeline,
 * Phase 5).
 *
 * `resolveMetadataContent` turns a {@link MetadataPolicy} into the concrete
 * metadata fields that should be embedded, applying the policy's per-field
 * decisions to the source document metadata. The policy contract lives in
 * @varve/shared; this module is the engine-side *writer* logic.
 *
 * Privacy default: `privacy-strip` keeps authorship/copyright but drops GPS,
 * device identifiers, timestamps, and editing history — matching the task
 * requirement that public/social exports never unintentionally retain precise
 * location or machine metadata.
 */

import type { MetadataFieldKey, MetadataPolicy } from '@varve/shared';
import { createMetadataPolicy, resolveMetadataFieldDecision } from '@varve/shared';
import type { PngTextEntry } from './png';

export interface MetadataContent {
  title?: string;
  description?: string;
  author?: string;
  copyright?: string;
  keywords: string[];
  software?: string;
  gps?: { latitude: number; longitude: number };
  device?: string;
  timestamp?: string;
  history?: string[];
}

export interface ResolveMetadataOptions {
  /** Force a policy (used by the exporter with the config policy). */
  policy?: MetadataPolicy;
}

/**
 * Apply the policy to source metadata, returning only the fields that survive.
 * `deterministic` mode additionally drops volatile fields (timestamps) even
 * when the policy would keep them, so repeated exports produce stable bytes.
 */
export function resolveMetadataContent(
  source: MetadataContent | undefined,
  options: ResolveMetadataOptions = {},
): MetadataContent {
  const policy = options.policy ?? createMetadataPolicy();
  if (!source) return { keywords: [] };
  const keep = (field: MetadataFieldKey): boolean =>
    resolveMetadataFieldDecision(policy, field) === 'keep';

  const out: MetadataContent = { keywords: [] };
  if (
    source.keywords.length > 0 &&
    policy.kind !== 'strip-all' &&
    policy.kind !== 'copyright-only'
  ) {
    out.keywords = source.keywords;
  }
  if (source.title) out.title = source.title;
  if (source.description) out.description = source.description;
  if (source.copyright && keep('copyright')) out.copyright = source.copyright;
  if (source.author && keep('creator')) out.author = source.author;
  if (source.software && keep('device') && !policy.deterministic) out.software = source.software;
  if (source.gps && keep('gps')) out.gps = source.gps;
  if (source.device && keep('device')) out.device = source.device;
  if (source.timestamp && keep('timestamps') && !policy.deterministic) {
    out.timestamp = source.timestamp;
  }
  if (source.history && keep('history')) out.history = source.history;
  if (policy.deterministic) {
    // Deterministic output must not embed volatile fields even if preserved.
    delete out.timestamp;
    delete out.history;
    delete out.gps;
  }
  return out;
}

/** Whether the policy keeps any GPS/device data (for the privacy warning). */
export function policyKeepsSensitiveData(policy: MetadataPolicy): boolean {
  return (
    resolveMetadataFieldDecision(policy, 'gps') === 'keep' ||
    resolveMetadataFieldDecision(policy, 'device') === 'keep'
  );
}

/** Map resolved metadata to PNG tEXt/iTXt entries. */
export function metadataToPngEntries(content: MetadataContent): PngTextEntry[] {
  const entries: PngTextEntry[] = [];
  if (content.title) entries.push({ keyword: 'Title', text: content.title, utf8: true });
  if (content.description) {
    entries.push({ keyword: 'Description', text: content.description, utf8: true });
  }
  if (content.author) entries.push({ keyword: 'Author', text: content.author, utf8: true });
  if (content.copyright) {
    entries.push({ keyword: 'Copyright', text: content.copyright, utf8: true });
  }
  if (content.software) entries.push({ keyword: 'Software', text: content.software, utf8: true });
  if (content.keywords.length > 0) {
    entries.push({ keyword: 'Keywords', text: content.keywords.join(', '), utf8: true });
  }
  if (content.gps) {
    entries.push({
      keyword: 'GPSLatitude',
      text: String(content.gps.latitude),
      utf8: true,
    });
    entries.push({
      keyword: 'GPSLongitude',
      text: String(content.gps.longitude),
      utf8: true,
    });
  }
  if (content.device) entries.push({ keyword: 'Device', text: content.device, utf8: true });
  if (content.timestamp) entries.push({ keyword: 'DateTime', text: content.timestamp, utf8: true });
  return entries;
}
