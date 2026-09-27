import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parsePluginPackage } from './package';

const encoder = new TextEncoder();
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'com.example.analyzer',
    name: 'Selection Analyzer',
    publisher: 'Example Studio',
    version: '1.2.3',
    apiVersion: 1,
    entry: 'module.wasm',
    permissions: { required: ['selection.read'], optional: ['document.write'] },
    commands: [
      { id: 'analyze', title: 'Analyze selection', kind: 'analysis' },
      { id: 'rename', title: 'Rename layers', kind: 'rename' },
    ],
    inspector: [
      {
        id: 'summary',
        title: 'Selection summary',
        command: 'analyze',
        tab: 'properties',
        modes: ['design'],
      },
    ],
    ...overrides,
  };
}

interface TestEntry {
  name: string;
  data: Uint8Array;
  method?: number;
  flags?: number;
  madeBy?: number;
  externalAttributes?: number;
  corruptCrc?: boolean;
  corruptLocalSize?: boolean;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(bytes: Uint8Array, at: number, value: number): void {
  new DataView(bytes.buffer).setUint16(at, value, true);
}

function write32(bytes: Uint8Array, at: number, value: number): void {
  new DataView(bytes.buffer).setUint32(at, value, true);
}

function zip(entries: TestEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 6, entry.flags ?? 0);
    write16(local, 8, entry.method ?? 0);
    write32(local, 14, crc);
    write32(local, 18, entry.data.length);
    write32(local, 22, entry.data.length + (entry.corruptLocalSize ? 1 : 0));
    write16(local, 26, name.length);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    write32(central, 0, 0x02014b50);
    write16(central, 4, entry.madeBy ?? 20);
    write16(central, 6, 20);
    write16(central, 8, entry.flags ?? 0);
    write16(central, 10, entry.method ?? 0);
    write32(central, 16, crc ^ (entry.corruptCrc ? 1 : 0));
    write32(central, 20, entry.data.length);
    write32(central, 24, entry.data.length);
    write16(central, 28, name.length);
    write32(central, 38, entry.externalAttributes ?? 0);
    write32(central, 42, localOffset);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralSize = centrals.reduce((sum, entry) => sum + entry.length, 0);
  const out = new Uint8Array(localOffset + centralSize + 22);
  let cursor = 0;
  for (const entry of [...locals, ...centrals]) {
    out.set(entry, cursor);
    cursor += entry.length;
  }
  write32(out, cursor, 0x06054b50);
  write16(out, cursor + 8, entries.length);
  write16(out, cursor + 10, entries.length);
  write32(out, cursor + 12, centralSize);
  write32(out, cursor + 16, localOffset);
  return out;
}

function packageBytes(
  rawManifest: Record<string, unknown> | string = manifest(),
  entries?: TestEntry[],
): Uint8Array {
  return zip(
    entries ?? [
      {
        name: 'manifest.json',
        data: encoder.encode(
          typeof rawManifest === 'string' ? rawManifest : JSON.stringify(rawManifest),
        ),
      },
      { name: 'module.wasm', data: WASM },
    ],
  );
}

describe('parsePluginPackage', () => {
  it('accepts a minimal stored package and hashes its exact bytes', async () => {
    const bytes = packageBytes();
    const parsed = await parsePluginPackage(bytes);
    expect(parsed.manifest.id).toBe('com.example.analyzer');
    expect(parsed.manifest.commands).toHaveLength(2);
    expect(parsed.wasm).toEqual(WASM);
    expect(parsed.wasm).not.toBe(WASM);
    const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    expect(parsed.sha256).toBe(Buffer.from(digest).toString('hex'));
  });

  it('accepts packages emitted by the existing ZIP dependency in stored mode', async () => {
    const bytes = zipSync(
      {
        'manifest.json': encoder.encode(JSON.stringify(manifest())),
        'module.wasm': WASM,
      },
      { level: 0 },
    );
    const parsed = await parsePluginPackage(bytes);
    expect(parsed.manifest.version).toBe('1.2.3');
    expect(parsed.wasm).toEqual(WASM);
  });

  it('maps legacy Logo and Codegen inspector modes to Design without duplicates', async () => {
    for (const legacyMode of ['logo', 'codegen']) {
      const parsed = await parsePluginPackage(
        packageBytes(
          manifest({
            inspector: [
              {
                id: 'summary',
                title: 'Selection summary',
                command: 'analyze',
                tab: 'properties',
                modes: [legacyMode],
              },
            ],
          }),
        ),
      );
      expect(parsed.manifest.inspector?.[0]?.modes).toEqual(['design']);
    }

    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            inspector: [
              {
                id: 'summary',
                title: 'Selection summary',
                command: 'analyze',
                tab: 'properties',
                modes: ['design', 'logo'],
              },
            ],
          }),
        ),
      ),
    ).rejects.toThrow(/invalid or duplicate inspector mode/i);
  });

  it.each([
    ['traversal', '../manifest.json'],
    ['absolute', '/manifest.json'],
    ['backslash', '..\\manifest.json'],
    ['case alias', 'Manifest.json'],
    ['Unicode alias', 'manife\u0301st.json'],
  ])('rejects %s paths', async (_label, path) => {
    await expect(
      parsePluginPackage(
        packageBytes(manifest(), [
          { name: path, data: encoder.encode(JSON.stringify(manifest())) },
          { name: 'module.wasm', data: WASM },
        ]),
      ),
    ).rejects.toThrow(/entry path|required entries/i);
  });

  it('rejects duplicate entries and an extra entry', async () => {
    const json = encoder.encode(JSON.stringify(manifest()));
    await expect(
      parsePluginPackage(
        packageBytes(manifest(), [
          { name: 'manifest.json', data: json },
          { name: 'manifest.json', data: json },
        ]),
      ),
    ).rejects.toThrow(/duplicate|required entries/i);
    await expect(
      parsePluginPackage(
        zip([
          { name: 'manifest.json', data: json },
          { name: 'module.wasm', data: WASM },
          { name: 'README.md', data: new Uint8Array() },
        ]),
      ),
    ).rejects.toThrow(/exactly two/i);
  });

  it.each([
    ['symlink', { madeBy: 0x0314, externalAttributes: 0xa0000000 }, /links/i],
    ['compression', { method: 8 }, /unsupported ZIP/i],
    ['encryption', { flags: 1 }, /unsupported ZIP/i],
    ['descriptor', { flags: 8 }, /unsupported ZIP/i],
    ['CRC', { corruptCrc: true }, /metadata disagree|CRC/i],
    ['local size', { corruptLocalSize: true }, /metadata disagree/i],
  ] as const)('rejects %s archives', async (_label, options, error) => {
    const bytes = packageBytes(manifest(), [
      { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest())), ...options },
      { name: 'module.wasm', data: WASM },
    ]);
    await expect(parsePluginPackage(bytes)).rejects.toThrow(error);
  });

  it('checks the stored payload against its declared CRC', async () => {
    const bytes = packageBytes();
    const firstPayloadOffset = 30 + encoder.encode('manifest.json').length;
    bytes[firstPayloadOffset] = bytes[firstPayloadOffset]! ^ 1;
    await expect(parsePluginPackage(bytes)).rejects.toThrow(/CRC mismatch/i);
  });

  it('rejects Zip64 markers, malformed headers and trailing junk', async () => {
    const zip64 = packageBytes();
    write32(zip64, zip64.length - 6, 0xffffffff);
    await expect(parsePluginPackage(zip64)).rejects.toThrow(/Zip64/i);
    const malformed = packageBytes();
    write32(malformed, 0, 0);
    await expect(parsePluginPackage(malformed)).rejects.toThrow(/local entry/i);
    const bytes = packageBytes();
    const trailing = new Uint8Array(bytes.length + 1);
    trailing.set(bytes);
    await expect(parsePluginPackage(trailing)).rejects.toThrow(/terminal ZIP|trailing/i);
  });

  it('enforces package, manifest and module byte limits before execution', async () => {
    await expect(parsePluginPackage(new Uint8Array(2 * 1024 * 1024 + 1))).rejects.toThrow(
      /package exceeds/i,
    );
    await expect(
      parsePluginPackage(
        packageBytes(manifest(), [
          { name: 'manifest.json', data: new Uint8Array(32 * 1024 + 1) },
          { name: 'module.wasm', data: WASM },
        ]),
      ),
    ).rejects.toThrow(/manifest.json exceeds/i);
    await expect(
      parsePluginPackage(
        packageBytes(manifest(), [
          { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest())) },
          { name: 'module.wasm', data: new Uint8Array(1024 * 1024 + 1) },
        ]),
      ),
    ).rejects.toThrow(/module.wasm exceeds/i);
  });

  it('rejects duplicate JSON keys, unknown executable fields and unsupported versions', async () => {
    const json = JSON.stringify(manifest());
    await expect(
      parsePluginPackage(
        packageBytes(json.replace('"apiVersion":1', '"apiVersion":1,"apiVersion":1')),
      ),
    ).rejects.toThrow(/duplicate JSON key/i);
    await expect(parsePluginPackage(packageBytes(manifest({ main: 'evil.js' })))).rejects.toThrow(
      /unsupported manifest field main/i,
    );
    await expect(parsePluginPackage(packageBytes(manifest({ apiVersion: 2 })))).rejects.toThrow(
      /unsupported manifest schema/i,
    );
    await expect(parsePluginPackage(packageBytes(manifest({ version: '01.2.3' })))).rejects.toThrow(
      /semver/i,
    );
  });

  it('requires every command to declare the selection access it consumes', async () => {
    await expect(
      parsePluginPackage(packageBytes(manifest({ permissions: { required: [], optional: [] } }))),
    ).rejects.toThrow(/commands require selection.read/i);
  });

  it('rejects unsafe permission and contribution contracts', async () => {
    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            permissions: { required: ['document.write'], optional: [] },
          }),
        ),
      ),
    ).rejects.toThrow(/requires selection.read/i);
    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            permissions: { required: ['selection.read'], optional: ['selection.read'] },
          }),
        ),
      ),
    ).rejects.toThrow(/duplicate permission/i);
    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            permissions: { required: ['selection.read'], optional: [] },
          }),
        ),
      ),
    ).rejects.toThrow(/rename commands require document.write/i);
    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            permissions: { required: ['selection.read'], optional: ['network.all'] },
          }),
        ),
      ),
    ).rejects.toThrow(/unsupported permission/i);
    await expect(
      parsePluginPackage(
        packageBytes(
          manifest({
            inspector: [{ id: 'summary', title: 'Summary', command: 'missing', tab: 'properties' }],
          }),
        ),
      ),
    ).rejects.toThrow(/unknown command/i);
  });

  it('rejects invalid WebAssembly entry bytes', async () => {
    await expect(
      parsePluginPackage(
        zip([
          { name: 'manifest.json', data: encoder.encode(JSON.stringify(manifest())) },
          { name: 'module.wasm', data: encoder.encode('not wasm') },
        ]),
      ),
    ).rejects.toThrow(/WebAssembly/i);
  });
});
