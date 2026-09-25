#!/usr/bin/env node
/** Static local package check. Never instantiate or execute untrusted Wasm. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parsePluginPackage } from '../../packages/editor/src/plugins/package.ts';
import { assertBoundedWasmSections } from '../../packages/editor/src/plugins/wasmLimits.ts';

const path = process.argv[2];
if (!path) {
  process.stderr.write(
    'Usage: node --experimental-strip-types scripts/plugins/validate.mjs <file.varveplugin>\n',
  );
  process.exitCode = 2;
} else {
  try {
    const bytes = new Uint8Array(await readFile(resolve(path)));
    const pkg = await parsePluginPackage(bytes);
    const guestBytes = Uint8Array.from(pkg.wasm);
    assertBoundedWasmSections(guestBytes.buffer);
    const module = await WebAssembly.compile(guestBytes);
    const imports = WebAssembly.Module.imports(module);
    if (
      imports.length !== 1 ||
      imports[0].module !== 'env' ||
      imports[0].name !== 'memory' ||
      imports[0].kind !== 'memory'
    )
      throw new Error('Guest must import only env.memory');
    const exports = WebAssembly.Module.exports(module);
    if (
      exports.length !== 3 ||
      !['alloc', 'run', 'result_len'].every((name) =>
        exports.some((entry) => entry.name === name && entry.kind === 'function'),
      )
    )
      throw new Error('Guest may export only alloc, run, and result_len');
    process.stdout.write(
      `${pkg.manifest.id} ${pkg.manifest.version}\nAPI ${pkg.manifest.apiVersion}; commands: ${pkg.manifest.commands.map((command) => command.id).join(', ')}\nSHA-256 ${pkg.sha256}\nStatic package check passed. Guest execution begins only when a command runs.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
