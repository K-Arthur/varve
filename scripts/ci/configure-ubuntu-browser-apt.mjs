#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMainModule } from '../is-main-module.mjs';

export const BROWSER_ACQUIRE_CONFIG =
  'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n';

export function preferOfficialArchive(contents) {
  const lines = contents.split('\n');
  const retained = lines.filter(
    (line) => !/^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?(?:\s|$)/.test(line.trim()),
  );
  if (retained.length === lines.length) return { changed: false, contents };
  assert.ok(
    retained.some((line) => /^https:\/\/archive\.ubuntu\.com\/ubuntu\/?(?:\s|$)/.test(line.trim())),
    'Removing the stalled mirror requires the existing official HTTPS archive fallback',
  );
  return { changed: true, contents: retained.join('\n') };
}

function installConfiguration(path, contents) {
  if (process.getuid() === 0) writeFileSync(path, contents);
  else
    execFileSync('sudo', ['tee', path], { input: contents, stdio: ['pipe', 'ignore', 'inherit'] });
}

if (isMainModule(import.meta.url)) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64', 'These browser jobs use Ubuntu x64, not the ARM ports archive');
  assert.match(readFileSync('/etc/os-release', 'utf8'), /^ID=ubuntu$/m);
  const mirrors = '/etc/apt/apt-mirrors.txt';
  if (existsSync(mirrors)) {
    const result = preferOfficialArchive(readFileSync(mirrors, 'utf8'));
    if (result.changed) installConfiguration(mirrors, result.contents);
    console.log('APT mirrors (Ubuntu signing and source suites remain unchanged):');
    console.log(readFileSync(mirrors, 'utf8'));
  }
  installConfiguration('/etc/apt/apt.conf.d/zz-varve-network-bounds', BROWSER_ACQUIRE_CONFIG);
  process.stdout.write(
    execFileSync('apt-config', [
      'dump',
      'Acquire::Retries',
      'Acquire::http::Timeout',
      'Acquire::https::Timeout',
    ]),
  );
}
