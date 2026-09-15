#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  ARCHITECTURES,
  currentTargetId,
  normalizeArchitecture,
  normalizeTargetId,
  RELEASE_TARGETS,
  targetById,
  targetFor,
} from './targets.mjs';

assert.deepEqual(Object.keys(ARCHITECTURES).sort(), ['aarch64', 'x86_64']);
assert.equal(normalizeArchitecture('arm64'), 'aarch64');
assert.equal(normalizeArchitecture('ARM64'), 'aarch64');
assert.equal(normalizeArchitecture('amd64'), 'x86_64');
assert.equal(normalizeArchitecture('x64'), 'x86_64');
assert.equal(normalizeTargetId('windows-arm64'), 'windows-aarch64');
assert.equal(currentTargetId('linux', 'arm64'), 'linux-aarch64');
assert.equal(currentTargetId('win32', 'x64'), 'windows-x86_64');

assert.throws(() => normalizeArchitecture('armv7'), /ARM32/);
assert.throws(() => targetFor('plan9', 'aarch64'), /Unsupported release target/);
assert.throws(() => normalizeTargetId('linux'), /Invalid release target/);

const ids = RELEASE_TARGETS.map((target) => target.id);
assert.deepEqual(ids, [
  'linux-x86_64',
  'linux-aarch64',
  'windows-x86_64',
  'windows-aarch64',
  'macos-aarch64',
]);

for (const target of RELEASE_TARGETS) {
  assert.equal(targetById(target.id), target);
  assert.equal(targetFor(target.os, target.architecture), target);
  assert.equal(target.nativeRuntimeKey, target.id);
  assert.equal(target.updateTarget, target.id);
  assert.ok(target.rustTarget.startsWith(`${target.architecture}-`));
  assert.ok(target.packageFormats.length > 0);
}

console.log(`Release target registry: ${RELEASE_TARGETS.length} targets verified.`);
