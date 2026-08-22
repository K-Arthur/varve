#!/usr/bin/env node
/** Manifest-driven entrypoint for the seven product-truth workflow captures. */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflows = {
  'auto-layout': 'auto-layout.mjs',
  'component-variants': 'component-variants.mjs',
  'prototype-interaction': 'prototype-interaction.mjs',
  'smart-animate': 'smart-animate.mjs',
  'motion-timeline': 'motion-timeline.mjs',
  'export-react': 'export-react.mjs',
  'light-dark-ui': 'light-dark-ui.mjs',
};
const groups = {
  interaction: ['prototype-interaction', 'smart-animate'],
  motion: ['motion-timeline'],
  codegen: ['export-react'],
  theme: ['light-dark-ui'],
  layout: ['auto-layout'],
  components: ['component-variants'],
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
