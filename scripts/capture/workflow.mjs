#!/usr/bin/env node
/** Manifest-driven entrypoint for the seven product-truth workflow captures. */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflows = {
  'raster-to-vector': 'raster-to-vector.mjs',
  'bezier-node-edit': 'bezier-node-edit.mjs',
  'poster-to-print': 'poster-to-print.mjs',
  'rgb-to-cmyk': 'rgb-to-cmyk.mjs',
  'variable-font': 'variable-font.mjs',
  'text-on-path': 'text-on-path.mjs',
  'export-svg': 'export-svg.mjs',
};
const groups = {
  vector: ['raster-to-vector', 'bezier-node-edit'],
  print: ['poster-to-print', 'rgb-to-cmyk'],
  type: ['variable-font', 'text-on-path'],
  export: ['export-svg'],
};

function usage() {
  console.error(
    'Usage: pnpm capture:workflow <slug> | pnpm capture:group <name> | pnpm capture:all [--no-mp4]',
  );
  console.error(`Workflows: ${Object.keys(workflows).join(', ')}`);
  console.error(`Groups: ${Object.keys(groups).join(', ')}`);
}

const args = process.argv.slice(2);
const all = args.includes('--all');
const groupIndex = args.indexOf('--group');
const group = groupIndex >= 0 ? args[groupIndex + 1] : null;
const passthrough = args.filter(
  (arg, index) => arg !== '--all' && index !== groupIndex && index !== groupIndex + 1,
);
const requested = all
  ? Object.keys(workflows)
  : group
    ? (groups[group] ?? [])
    : args.filter((arg) => !arg.startsWith('-'));

if (requested.length === 0 || requested.some((slug) => !workflows[slug])) {
  usage();
  process.exitCode = 2;
} else {
  for (const slug of requested) {
    const script = join(root, 'scripts', 'capture', 'workflows', workflows[slug]);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, ...passthrough], {
        cwd: root,
        env: {
          ...process.env,
          VARVE_CAPTURE_PORT: String(14000 + ((process.pid + requested.indexOf(slug)) % 900)),
        },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`${slug} exited ${code ?? `via ${signal}`}`));
      });
    }).catch((error) => {
      console.error(`[capture] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
    if (process.exitCode) break;
  }
}
