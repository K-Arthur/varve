#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./run-bounded-command.mjs', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'varve-bounded-command-'));
const marker = join(tempDir, 'orphan-survived.txt');
const source = [
  "const { spawn } = require('node:child_process');",
  'const marker = process.argv[1];',
  `spawn(process.execPath, ['-e', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 1500); setInterval(() => {}, 1000)", marker], { stdio: 'ignore' });`,
  'setInterval(() => {}, 1000);',
].join('\n');

try {
  const result = spawnSync(
    process.execPath,
    [runner, '150', tempDir, process.execPath, '-e', source],
    { encoding: 'utf8', timeout: 8_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 124, `expected timeout exit; got ${result.status}: ${result.stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  assert.equal(existsSync(marker), false, 'a descendant process survived the command timeout');
  console.log('bounded command timeout kills descendants');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
