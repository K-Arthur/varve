#!/usr/bin/env node
/** Reproducible stored-ZIP builder and real guest ABI smoke test. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const target = join(root, 'target', 'wasm32-unknown-unknown', 'release');
const guests = [
  { directory: 'style-audit', binary: 'varve_example_style_audit.wasm' },
  { directory: 'batch-rename', binary: 'varve_example_batch_rename.wasm' },
];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stored entries use a fixed order and zero timestamps for reproducible ZIPs. */
function packageZip(manifest, wasm, thumbnail) {
  const files = [
    { name: 'manifest.json', data: manifest },
    { name: 'module.wasm', data: wasm },
    ...(thumbnail ? [{ name: 'thumbnail.png', data: thumbnail }] : []),
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.data);
    const local = Buffer.alloc(30 + name.length + file.data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, record) => sum + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function runBuild() {
  // The import and maximum memory contract is shared with guestWorker.ts.
  const flags = [
    process.env.RUSTFLAGS ?? '',
    '-C link-arg=--import-memory',
    '-C link-arg=--initial-memory=4194304',
    '-C link-arg=--max-memory=16777216',
  ]
    .filter(Boolean)
    .join(' ');
  const command = spawnSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      join(root, 'Cargo.toml'),
      '--locked',
      '--release',
      '--target',
      'wasm32-unknown-unknown',
    ],
    { cwd: root, env: { ...process.env, RUSTFLAGS: flags }, stdio: 'inherit' },
  );
  if (command.error) throw command.error;
  if (command.status !== 0) throw new Error(`cargo build failed (${command.status})`);
}

/** Invoke the same linear-memory ABI as the host worker with representative data. */
async function smoke(wasm, directory) {
  const module = await WebAssembly.compile(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'env', name: 'memory', kind: 'memory' },
  ]);
  const memory = new WebAssembly.Memory({ initial: 64, maximum: 256 });
  const instance = await WebAssembly.instantiate(module, { env: { memory } });
  const { alloc, run, result_len: resultLen } = instance.exports;
  for (const fn of [alloc, run, resultLen]) assert.equal(typeof fn, 'function');
  const input = encoder.encode(
    JSON.stringify({
      apiVersion: 1,
      commandId: directory === 'style-audit' ? 'analyze' : 'rename',
      documentId: 'example-document',
      revision: 4,
      selection: [
        {
          id: 'frame-1',
          name: '  Card  ',
          kind: 'frame',
          locked: false,
          style: { opacity: 1, blendMode: 'normal', paintCount: 2, strokeCount: 1 },
        },
        {
          id: 'text-1',
          name: 'Title',
          kind: 'text',
          locked: true,
          style: {
            opacity: 0.5,
            blendMode: 'multiply',
            paintCount: 1,
            strokeCount: 0,
            fontFamily: 'Inter',
            fontSize: 16,
          },
        },
        {
          id: 'image-1',
          name: 'Image',
          kind: 'shape',
          locked: false,
          style: { opacity: 1, blendMode: 'normal', paintCount: 1, strokeCount: 0 },
        },
      ],
    }),
  );
  const pointer = alloc(input.length);
  assert.ok(Number.isInteger(pointer) && pointer >= 0);
  assert.ok(pointer + input.length <= memory.buffer.byteLength);
  new Uint8Array(memory.buffer, pointer, input.length).set(input);
  const resultPointer = run(pointer, input.length);
  const length = resultLen();
  assert.ok(Number.isInteger(length) && length > 0 && length <= 64 * 1024);
  assert.ok(resultPointer >= 0 && resultPointer + length <= memory.buffer.byteLength);
  const result = JSON.parse(decoder.decode(new Uint8Array(memory.buffer, resultPointer, length)));
  assert.equal(typeof result.summary, 'string');
  assert.ok(Array.isArray(result.lines) && Array.isArray(result.renames));
  if (directory === 'style-audit') {
    assert.equal(result.renames.length, 0);
    for (const expected of [
      'Opacity: mixed',
      'Blend mode: mixed',
      'Paint count: mixed',
      'Stroke count: mixed',
      'Font family: Inter',
      'Font size: 16.0',
    ]) {
      assert.ok(
        result.lines.some((line) => line.includes(expected)),
        `missing ${expected}`,
      );
    }
  } else {
    assert.equal(result.renames.length, 2);
    assert.deepEqual(
      result.renames.map((item) => item.id),
      ['frame-1', 'image-1'],
    );
    assert.deepEqual(
      result.renames.map((item) => item.name),
      ['01 · Card', '02 · Image'],
    );
  }
}

if (!process.argv.includes('--package-only')) runBuild();
await mkdir(dist, { recursive: true });
for (const guest of guests) {
  const manifest = await readFile(join(root, guest.directory, 'manifest.json'));
  const wasm = await readFile(join(target, guest.binary));
  const metadata = JSON.parse(manifest.toString('utf8'));
  const thumbnail =
    metadata.thumbnail?.path === 'thumbnail.png'
      ? await readFile(join(root, guest.directory, 'thumbnail.png'))
      : undefined;
  if (manifest.length > 32 * 1024 || wasm.length > 1024 * 1024) {
    throw new Error(`${guest.directory} exceeds the manifest or WASM size limit`);
  }
  if (thumbnail && thumbnail.length > 256 * 1024) {
    throw new Error(`${guest.directory} exceeds the 256 KiB thumbnail size limit`);
  }
  await smoke(wasm, guest.directory);
  const bytes = packageZip(manifest, wasm, thumbnail);
  if (bytes.length > 2 * 1024 * 1024)
    throw new Error(`${guest.directory} exceeds the package size limit`);
  const path = join(dist, `${guest.directory}.varveplugin`);
  await writeFile(path, bytes);
  const hash = createHash('sha256').update(bytes).digest('hex');
  process.stdout.write(`${path} (${bytes.length} bytes, sha256 ${hash})\n`);
}
