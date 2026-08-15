#!/usr/bin/env node

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CHANNELS = new Set(['stable', 'beta', 'nightly']);
const MODES = new Set(['signed', 'manual-only']);

export function buildUpdaterConfig(channel, mode) {
  if (!CHANNELS.has(channel)) {
    throw new Error(`invalid update channel: ${channel}`);
  }
  if (!MODES.has(mode)) {
    throw new Error(`invalid updater mode: ${mode}`);
  }

  const updater = {
    endpoints: [`https://varve.studio/updates/${channel}.json`],
  };
  const config = { plugins: { updater } };
  if (mode === 'manual-only') {
    // Tauri's bundler parses the updater key whenever createUpdaterArtifacts
    // is true. Manual releases must disable artifact generation and provide a
    // schema-valid inactive updater config; a null/missing pubkey is rejected
    // by the bundler before it can produce the installer.
    config.bundle = { createUpdaterArtifacts: false };
    updater.active = false;
    updater.pubkey = '';
  }
  return config;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith('--')) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const channel = readOption(process.argv.slice(2), '--channel');
  const mode = readOption(process.argv.slice(2), '--mode');
  const output = readOption(process.argv.slice(2), '--output');
  writeFileSync(output, `${JSON.stringify(buildUpdaterConfig(channel, mode), null, 2)}\n`);
}
