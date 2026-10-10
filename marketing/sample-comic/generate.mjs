#!/usr/bin/env node
/**
 * CLI entry for the Halloween Cookies sample page.
 * Delegates to generate.ts so the document is built with @varve/scene factories.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const child = spawn(
  'pnpm',
  ['--filter', '@varve/ui', 'exec', 'tsx', join(root, 'marketing/sample-comic/generate.ts')],
  { stdio: 'inherit', cwd: root },
);
child.on('exit', (code) => process.exit(code ?? 1));
