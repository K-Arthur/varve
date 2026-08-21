#!/usr/bin/env node
/**
 * Regression tests for the Linux package metadata that ships in deb/rpm/
 * AppImage bundles:
 *
 *   - AppStream metainfo exists, is well-formed, carries the required
 *     elements, and declares the committed release version (drift would make
 *     GNOME Software / KDE Discover / AppImageHub show stale or no data).
 *   - project_license must stay an honest source-available declaration
 *     (LicenseRef-FSL-1.1-MIT), never a bare OSI identifier.
 *   - the desktop entry declares BOTH document MIME types (.varve and legacy
 *     .strata) and opens files via %F.
 *   - tauri.conf.json actually ships the metainfo in every Linux format.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
function join(...parts) {
  return resolve(root, ...parts);
}

const tauriConf = JSON.parse(readFileSync(join('apps/desktop/src-tauri/tauri.conf.json')));
const metainfo = readFileSync(
  join('apps/desktop/src-tauri/linux/dev.varve.desktop.metainfo.xml'),
  'utf8',
);
const template = readFileSync(
  join('apps/desktop/src-tauri/linux/dev.varve.desktop.desktop'),
  'utf8',
);
const installed = readFileSync(
  join('apps/desktop/src-tauri/linux/dev.varve.desktop.installed.desktop'),
  'utf8',
);
const mimeXml = readFileSync(join('apps/desktop/src-tauri/linux/dev.varve.desktop.xml'), 'utf8');

// ── 1. AppStream metainfo: structure and required elements ────────────────
assert.ok(
  metainfo.includes('<component type="desktop-application">'),
  'metainfo must be a desktop-application component',
);
assert.ok(
  /<id>dev\.varve\.desktop<\/id>/.test(metainfo),
  'metainfo id must match the bundle identifier',
);
assert.ok(
  /<metadata_license>CC0-1\.0<\/metadata_license>/.test(metainfo),
  'metadata_license must be CC0-1.0',
);
assert.ok(
  /<launchable type="desktop-id">dev\.varve\.desktop\.desktop<\/launchable>/.test(metainfo),
  'launchable desktop-id must match the desktop file',
);

// ── 2. License honesty (source-available, never "open source") ────────────
const licenseMatch = metainfo.match(/<project_license>([^<]+)<\/project_license>/);
assert.ok(licenseMatch, 'project_license must be present');
assert.ok(
  licenseMatch[1].startsWith('LicenseRef-'),
  `project_license must be a custom SPDX reference, got: ${licenseMatch[1]}`,
);
assert.ok(
  !/open.?source|free software/i.test(metainfo.replace(/Source-available/, '')),
  'metainfo must not claim open-source/free-software status',
);

// ── 3. Release entry tracks the committed version ──────────────────────────
const release = metainfo.match(/<release version="([^"]+)" date="([^"]+)"/);
assert.ok(release, 'metainfo must carry a <release> entry with version and date');
assert.equal(
  release[1],
  tauriConf.version,
  `metainfo release version (${release[1]}) must match tauri.conf.json (${tauriConf.version})`,
);

// ── 4. Desktop entries declare both document MIME types + file opening ─────
for (const [label, content] of [
  ['template', template],
  ['installed', installed],
]) {
  assert.ok(
    content.includes('MimeType=application/x-varve;application/x-strata'),
    `${label} desktop entry must declare both application/x-varve and application/x-strata`,
  );
  assert.ok(content.includes('%F'), `${label} desktop entry must open files via Exec %F`);
}
assert.ok(mimeXml.includes('<glob pattern="*.varve"/>'), 'MIME xml must map *.varve');
assert.ok(mimeXml.includes('<glob pattern="*.strata"/>'), 'MIME xml must map *.strata');

// ── 5. Every Linux bundle format ships the metainfo ────────────────────────
for (const format of ['appimage', 'deb', 'rpm']) {
  const files = tauriConf.bundle.linux[format]?.files ?? {};
  const entry = Object.entries(files).find(([target]) =>
    target.endsWith('dev.varve.desktop.metainfo.xml'),
  );
  assert.ok(entry, `${format} bundle must install the metainfo (bundle.linux.${format}.files)`);
  assert.equal(
    entry[0],
    '/usr/share/metainfo/dev.varve.desktop.metainfo.xml',
    `${format} metainfo target must be the standard /usr/share/metainfo path`,
  );
}

console.log('linux-package-metadata tests passed');
