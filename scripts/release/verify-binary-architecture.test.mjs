#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectBinary } from './verify-binary-architecture.mjs';

const root = mkdtempSync(join(tmpdir(), 'varve-binary-arch-'));
try {
  const elfX64 = Buffer.alloc(20);
  elfX64.set([0x7f, 0x45, 0x4c, 0x46]);
  elfX64.writeUInt16LE(0x3e, 18);
  writeFileSync(join(root, 'x64.elf'), elfX64);
  assert.deepEqual(inspectBinary(join(root, 'x64.elf')), {
    format: 'elf',
    machine: 0x3e,
    architecture: 'x86_64',
  });

  const elfArm = Buffer.alloc(20);
  elfArm.set([0x7f, 0x45, 0x4c, 0x46]);
  elfArm.writeUInt16LE(0xb7, 18);
  writeFileSync(join(root, 'arm.elf'), elfArm);
  assert.equal(inspectBinary(join(root, 'arm.elf')).architecture, 'aarch64');

  const peArm = Buffer.alloc(0x46);
  peArm.set([0x4d, 0x5a]);
  peArm.writeUInt32LE(0x40, 0x3c);
  peArm.set([0x50, 0x45, 0x00, 0x00], 0x40);
  peArm.writeUInt16LE(0xaa64, 0x44);
  writeFileSync(join(root, 'arm.exe'), peArm);
  assert.equal(inspectBinary(join(root, 'arm.exe')).architecture, 'aarch64');

  assert.throws(() => inspectBinary(join(root, 'missing')), /ENOENT/);
  console.log('verify-binary-architecture.test.mjs: all assertions passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}
