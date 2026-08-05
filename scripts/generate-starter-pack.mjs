#!/usr/bin/env node
/**
 * generate-starter-pack.mjs — deterministic build-time generation of the
 * bundled offline starter pack.
 *
 * Fetches a pinned, curated set of common UI icons from the Iconify public
 * API (Material Design Icons + Lucide), writes
 * `apps/desktop/public/packs/starter-pack.json` with verified licence
 * metadata. The output is committed; the app installs it from the local
 * file (no network at runtime).
 *
 * Run: node scripts/generate-starter-pack.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.iconify.design';

const PACKS = {
  mdi: {
    name: 'Material Design Icons',
    spdx: 'Apache-2.0',
    licenceUrl: 'https://github.com/Templarian/MaterialDesign/blob/master/LICENSE',
    attributionRequired: true,
    icons: [
      'home',
      'account',
      'account-group',
      'magnify',
      'settings',
      'cog',
      'delete',
      'check',
      'close',
      'plus',
      'minus',
      'pencil',
      'email',
      'phone',
      'calendar',
      'clock-outline',
      'map-marker',
      'heart',
      'star',
      'eye',
      'eye-off',
      'lock',
      'lock-open-variant',
      'download',
      'upload',
      'refresh',
      'share-variant',
      'link-variant',
      'alert',
      'information',
      'help-circle',
      'chevron-left',
      'chevron-right',
      'chevron-up',
      'chevron-down',
      'menu',
      'bell',
      'cart',
      'image',
    ],
  },
  lucide: {
    name: 'Lucide',
    spdx: 'ISC',
    licenceUrl: 'https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    attributionRequired: true,
    icons: [
      'home',
      'user',
      'search',
      'settings',
      'trash',
      'check',
      'x',
      'plus',
      'minus',
      'pencil',
      'mail',
      'phone',
      'calendar',
      'clock',
      'map-pin',
      'heart',
      'star',
      'eye',
      'lock',
      'download',
      'upload',
      'refresh-cw',
      'share-2',
      'link',
      'alert-circle',
      'info',
      'help-circle',
      'chevron-left',
      'chevron-right',
      'chevron-up',
      'chevron-down',
      'menu',
      'bell',
      'shopping-cart',
      'image',
      'arrow-left',
      'arrow-right',
      'arrow-up',
      'arrow-down',
    ],
  },
};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

async function main() {
  const out = {
    format: 'varve-starter-pack',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    packs: [],
  };

  for (const [prefix, pack] of Object.entries(PACKS)) {
    const collection = await fetchJson(`${API}/collections?prefixes=${prefix}`);
    const info = collection[prefix] ?? {};
    const data = await fetchJson(`${API}/${prefix}.json?icons=${pack.icons.join(',')}`);
    const icons = [];
    for (const name of pack.icons) {
      const direct = data.icons?.[name];
      const alias = data.aliases?.[name];
      if (direct) {
        icons.push({
          name,
          body: direct.body,
          width: direct.width ?? data.width,
          height: direct.height ?? data.height,
        });
      } else if (alias) {
        // Alias resolution through the parent chain.
        let parent = alias.parent;
        const seen = new Set([name]);
        while (parent && !seen.has(parent)) {
          seen.add(parent);
          const resolved = data.icons?.[parent];
          if (resolved) {
            icons.push({
              name,
              body: resolved.body,
              width: resolved.width ?? data.width,
              height: resolved.height ?? data.height,
            });
            break;
          }
          parent = data.aliases?.[parent]?.parent;
        }
      }
    }
    out.packs.push({
      prefix,
      name: info.name ?? pack.name,
      version: info.version,
      lastModified: data.lastModified ?? info.lastModified,
      spdx: info.license?.spdx ?? pack.spdx,
      licenceUrl: info.license?.url ?? pack.licenceUrl,
      attributionRequired: pack.attributionRequired,
      icons,
    });
    console.log(`${prefix}: ${icons.length}/${pack.icons.length} icons resolved`);
  }

  const target = join(__dirname, '../apps/desktop/public/packs/starter-pack.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
  console.log(
    `wrote ${target} (${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)} KiB)`,
  );
}

main().catch((err) => {
  console.error('starter pack generation failed:', err.message);
  process.exit(1);
});
