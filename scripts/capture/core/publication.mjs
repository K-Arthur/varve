/** Explicit archive policy; unlisted workflows remain active website deliverables. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const assetNames = (slug) => ({
  webm: `${slug}.webm`,
  mp4: `${slug}.mp4`,
  poster: `${slug}-poster.png`,
});
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function loadArchive(path) {
  const archive = JSON.parse(readFileSync(path, 'utf8'));
  if (
    archive?.schemaVersion !== 1 ||
    !isObject(archive.clips) ||
    typeof archive.reason !== 'string' ||
    !archive.reason.trim()
  ) {
    throw new Error(
      'workflow archive requires schemaVersion 1, a reason, and an explicit clips map',
    );
  }
  for (const [slug, entry] of Object.entries(archive.clips)) {
    if (
      !SLUG.test(slug) ||
      !isObject(entry) ||
      Object.keys(entry).sort().join(',') !== 'assets,manifestSha256' ||
      !SHA256.test(entry.manifestSha256 ?? '') ||
      !isObject(entry.assets) ||
      Object.keys(entry.assets).sort().join(',') !== 'mp4,poster,webm' ||
      Object.values(entry.assets).some((hash) => !SHA256.test(hash))
    ) {
      throw new Error(`invalid workflow archive entry: ${slug}`);
    }
  }
  return archive;
}

export function assertActiveWorkflow(archive, slug) {
  if (!SLUG.test(slug)) throw new Error(`invalid workflow slug: ${slug}`);
  if (Object.hasOwn(archive.clips, slug)) {
    throw new Error(
      `${slug}: archived workflow is read-only; review its publication decision before recording or encoding`,
    );
  }
}

export function archiveInventoryFindings(archive, slugs) {
  return Object.keys(archive.clips)
    .filter((slug) => !slugs.includes(slug))
    .map((slug) => `archived manifest missing: ${slug}.capture.json`);
}

export function publicationFindings({ slug, canonicalDir, websiteDir, archive }) {
  const findings = [];
  const names = assetNames(slug);
  const archived = Object.hasOwn(archive.clips, slug) ? archive.clips[slug] : null;
  if (archived) {
    const hashes = {
      [`${slug}.capture.json`]: archived.manifestSha256,
      ...Object.fromEntries(
        Object.entries(names).map(([kind, name]) => [name, archived.assets[kind]]),
      ),
    };
    for (const [name, hash] of Object.entries(hashes)) {
      const path = join(canonicalDir, name);
      if (!existsSync(path)) {
        findings.push(`archived canonical file missing: ${name}`);
      } else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) {
        findings.push(`archived canonical hash changed: ${name}`);
      }
    }
    for (const name of Object.values(names)) {
      if (existsSync(join(websiteDir, name)))
        findings.push(`archived file is still published: ${name}`);
    }
    return findings;
  }
  for (const name of Object.values(names)) {
    const canonical = join(canonicalDir, name);
    const published = join(websiteDir, name);
    if (!existsSync(canonical)) findings.push(`canonical file missing: ${name}`);
    else if (!existsSync(published)) findings.push(`website copy missing: ${name}`);
    else if (!readFileSync(canonical).equals(readFileSync(published))) {
      findings.push(`website copy differs from canonical: ${name}`);
    }
  }
  return findings;
}
