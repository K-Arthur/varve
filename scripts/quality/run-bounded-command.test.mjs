#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
    [runner, '150', tempDir, process.execPath, '-e', source, marker],
    { encoding: 'utf8', timeout: 8_000 },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 124, `expected timeout exit; got ${result.status}: ${result.stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  assert.equal(existsSync(marker), false, 'a descendant process survived the command timeout');
  console.log('bounded command timeout kills descendants');

  for (const status of [0, 7]) {
    const result = spawnSync(
      process.execPath,
      [runner, '1000', tempDir, process.execPath, '-e', `process.exit(${status})`],
      { encoding: 'utf8', timeout: 8000 },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, status, 'completed commands preserve their exit status');
    assert.doesNotMatch(result.stderr, /timed out|cancelled/);
  }

  // pnpm starts children in separate process groups. Exercise the real CLI,
  // including a grandchild which ignores TERM and requires bounded cleanup.
  // These fixtures never acquire or reclaim a repository lease.
  if (process.platform !== 'win32') {
    for (const cancellation of [false, true]) {
      const ready = join(tempDir, `detached-${cancellation}.json`);
      let owner;
      let sentinel;
      let owned = [];
      try {
        const grandchild = [
          "const fs = require('node:fs');",
          "process.on('SIGTERM', () => {});",
          'fs.writeFileSync(process.argv[1], JSON.stringify({ parent: Number(process.argv[2]), grandchild: process.pid }));',
          'setInterval(() => {}, 1000);',
        ].join('\n');
        const parent = [
          "const { spawn } = require('node:child_process');",
          "process.on('SIGTERM', () => {});",
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[1], String(process.pid)], { detached: true, stdio: 'ignore' });`,
          "child.on('exit', () => process.exit(0));",
          'setInterval(() => {}, 1000);',
        ].join('\n');
        sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          stdio: 'ignore',
        });
        let stderr = '';
        owner = spawn(
          process.execPath,
          [runner, cancellation ? '10000' : '1000', tempDir, process.execPath, '-e', parent, ready],
          { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        owner.stderr.on('data', (chunk) => {
          stderr += chunk;
        });
        const exit = new Promise((resolve, reject) => {
          owner.once('error', reject);
          owner.once('exit', (code, signal) => resolve({ code, signal }));
        });
        const readyDeadline = Date.now() + 3000;
        while (!existsSync(ready) && Date.now() < readyDeadline)
          await new Promise((resolve) => setTimeout(resolve, 5));
        assert.ok(existsSync(ready), 'detached fixture must start before termination');
        const pids = JSON.parse(readFileSync(ready, 'utf8'));
        owned = [pids.parent, pids.grandchild].map(processRecord);
        assert.ok(owned.every(Boolean), 'both owned processes must be live');
        if (process.platform === 'linux')
          assert.notEqual(
            owned[0].group,
            owned[1].group,
            'fixture must use separate process groups',
          );
        // Allow a periodic ownership snapshot before sending cancellation.
        if (cancellation) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          owner.kill('SIGTERM');
        }
        const result = await Promise.race([
          exit,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('bounded detached cleanup did not finish')),
              7000,
            ).unref(),
          ),
        ]);
        assert.equal(result.code, cancellation ? 143 : 124);
        assert.equal(result.signal, null, 'wrapper records an explicit nonzero exit');
        for (const record of owned)
          assert.equal(processRecord(record.pid), null, 'an owned detached process survived');
        assert.ok(processRecord(sentinel.pid), 'an unrelated sibling must remain alive');
        assert.match(stderr, cancellation ? /cancelled by SIGTERM/ : /command timed out after 1s/);
        assert.match(stderr, /owned-process cleanup completed/);
        assert.doesNotMatch(stderr, cancellation ? /command timed out/ : /cancelled by/);
      } finally {
        // Only identities recorded from this fixture can be force-cleaned.
        for (const record of owned) {
          const current = processRecord(record?.pid);
          if (!current || current.identity !== record.identity) continue;
          try {
            process.kill(record.pid, 'SIGKILL');
          } catch {}
        }
        owner?.kill('SIGKILL');
        sentinel?.kill('SIGKILL');
      }
    }
    console.log(
      'bounded deadlines and cancellation clean detached descendants, preserving unrelated work',
    );
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function processRecord(pid) {
  if (!Number.isSafeInteger(pid)) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      return fields[0] === 'Z' ? null : { pid, identity: fields[19], group: Number(fields[2]) };
    }
    process.kill(pid, 0);
    return { pid, identity: null };
  } catch {
    return null;
  }
}
