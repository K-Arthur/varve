#!/usr/bin/env node
/**
 * Verify the machine type of a native executable.
 *
 * This deliberately reads binary headers instead of trusting artifact names,
 * workflow matrix values, or the host architecture. It covers the formats
 * Varve ships: ELF (Linux), PE/COFF (Windows), and Mach-O (macOS).
 */
import { readFileSync } from 'node:fs';
import { normalizeArchitecture } from './targets.mjs';

const MACHINE_TYPES = Object.freeze({
  elf: Object.freeze({ x86_64: 0x3e, aarch64: 0xb7 }),
  pe: Object.freeze({ x86_64: 0x8664, aarch64: 0xaa64 }),
  macho: Object.freeze({ x86_64: 0x01000007, aarch64: 0x0100000c }),
});

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function readU16LE(bytes, offset) {
  return bytes.readUInt16LE(offset);
}

function readU32LE(bytes, offset) {
  return bytes.readUInt32LE(offset);
}

function readU32BE(bytes, offset) {
  return bytes.readUInt32BE(offset);
}

function inspectBinary(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 4) throw new Error(`${path}: file is too small to contain a binary header`);

  if (bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    if (bytes.length < 20) throw new Error(`${path}: truncated ELF header`);
    const machine = readU16LE(bytes, 18);
    const architecture = Object.entries(MACHINE_TYPES.elf).find(
      ([, value]) => value === machine,
    )?.[0];
    return { format: 'elf', machine, architecture: architecture ?? null };
  }

  if (bytes.subarray(0, 2).equals(Buffer.from([0x4d, 0x5a]))) {
    if (bytes.length < 0x40) throw new Error(`${path}: truncated PE DOS header`);
    const peOffset = readU32LE(bytes, 0x3c);
    if (
      bytes.length < peOffset + 6 ||
      !bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))
    ) {
      throw new Error(`${path}: MZ file has no valid PE header`);
    }
    const machine = readU16LE(bytes, peOffset + 4);
    const architecture = Object.entries(MACHINE_TYPES.pe).find(
      ([, value]) => value === machine,
    )?.[0];
    return { format: 'pe', machine, architecture: architecture ?? null };
  }

  const magic = bytes.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    // Fat headers store cputype in big-endian order. The little-endian magic
    // is accepted too because some inspection tools expose it that way.
    if (bytes.length < 12) throw new Error(`${path}: truncated fat Mach-O header`);
    const architecture =
      [readU32BE(bytes, 8), readU32LE(bytes, 8)]
        .flatMap(
          (cpu) =>
            Object.entries(MACHINE_TYPES.macho).find(([, value]) => value === cpu)?.[0] ?? [],
        )
        .find(Boolean) ?? null;
    return { format: 'macho-fat', machine: null, architecture };
  }

  const machoMagic = bytes.readUInt32LE(0);
  if (machoMagic === 0xfeedfacf || machoMagic === 0xcefaedfe) {
    if (bytes.length < 8) throw new Error(`${path}: truncated Mach-O header`);
    const machine = readU32LE(bytes, 4);
    const architecture = Object.entries(MACHINE_TYPES.macho).find(
      ([, value]) => value === machine,
    )?.[0];
    return { format: 'macho', machine, architecture: architecture ?? null };
  }

  throw new Error(`${path}: unrecognized native executable format`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.path || !args.architecture) {
    throw new Error('usage: verify-binary-architecture.mjs --path <file> --architecture <arch>');
  }
  const expected = normalizeArchitecture(args.architecture);
  const actual = inspectBinary(args.path);
  if (actual.architecture !== expected) {
    throw new Error(
      `${args.path}: architecture mismatch; expected ${expected}, found ${actual.architecture ?? 'unknown'} (${actual.format})`,
    );
  }
  process.stdout.write(
    `Verified ${args.path}: ${actual.format} machine=${actual.machine ?? 'fat'} architecture=${actual.architecture}\n`,
  );
}

if (process.argv[1]?.endsWith('verify-binary-architecture.mjs')) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

export { inspectBinary };
