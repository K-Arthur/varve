#!/usr/bin/env node
/**
 * Validate Flatpak manifest has required app-id.
 * Extracted from inline YAML step to avoid js-yaml colon-parsing issues.
 */
import { readFileSync } from 'node:fs';

const content = readFileSync('packaging/flatpak/dev.varve.desktop.yml', 'utf8');
if (!content.includes('app-id: dev.varve.desktop')) {
  console.error('Missing app-id in Flatpak manifest');
  process.exit(1);
}
