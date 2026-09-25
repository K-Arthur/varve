/** Host-owned worker. Guest packages contain WebAssembly bytes, never JS. */
import { assertBoundedWasmSections } from './wasmLimits';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MEMORY_PAGES = 64;
const MAX_MEMORY_PAGES = 256;

interface GuestRequest {
  operation: 'validate' | 'run';
  wasm: ArrayBuffer;
  input?: string;
}

type GuestExports = {
  alloc: (length: number) => number;
  run: (pointer: number, length: number) => number;
  result_len: () => number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkedSlice(memory: WebAssembly.Memory, pointer: number, length: number): Uint8Array {
  if (!Number.isInteger(pointer) || pointer < 0 || !Number.isInteger(length) || length < 0) {
    throw new Error('Guest returned an invalid memory range');
  }
  if (pointer + length > memory.buffer.byteLength) {
    throw new Error('Guest returned a memory range outside its allocation');
  }
  return new Uint8Array(memory.buffer, pointer, length);
}

export async function handleGuestRequest(
  request: GuestRequest,
): Promise<{ validated: true; output?: string }> {
  if (!(request.wasm instanceof ArrayBuffer) || request.wasm.byteLength > 1024 * 1024) {
    throw new Error('Guest module is missing or too large');
  }
  assertBoundedWasmSections(request.wasm);
  const module = await WebAssembly.compile(request.wasm);
  const imports = WebAssembly.Module.imports(module);
  if (
    imports.length !== 1 ||
    imports[0]?.module !== 'env' ||
    imports[0]?.name !== 'memory' ||
    imports[0]?.kind !== 'memory'
  ) {
    throw new Error('Guest must import only env.memory');
  }
  const exportsDescription = WebAssembly.Module.exports(module);
  if (
    exportsDescription.length !== 3 ||
    !['alloc', 'run', 'result_len'].every((name) =>
      exportsDescription.some((entry) => entry.name === name && entry.kind === 'function'),
    )
  )
    throw new Error('Guest may export only alloc, run, and result_len');
  // WebAssembly.instantiate executes the guest's start section. Reviewing or
  // installing a package must validate its shape without executing it.
  if (request.operation === 'validate') return { validated: true };
  if (request.operation !== 'run' || typeof request.input !== 'string') {
    throw new Error('Invalid guest request');
  }
  const memory = new WebAssembly.Memory({ initial: MEMORY_PAGES, maximum: MAX_MEMORY_PAGES });
  const instance = await WebAssembly.instantiate(module, { env: { memory } });
  const exports = instance.exports as unknown as Partial<GuestExports>;
  if (
    typeof exports.alloc !== 'function' ||
    typeof exports.run !== 'function' ||
    typeof exports.result_len !== 'function'
  ) {
    throw new Error('Guest ABI exports alloc, run, and result_len are required');
  }
  const input = new TextEncoder().encode(request.input);
  if (input.byteLength > MAX_INPUT_BYTES) throw new Error('Guest input exceeds 64 KiB');
  const inputPointer = exports.alloc(input.byteLength);
  checkedSlice(memory, inputPointer, input.byteLength).set(input);
  const outputPointer = exports.run(inputPointer, input.byteLength);
  const outputLength = exports.result_len();
  if (outputLength > MAX_OUTPUT_BYTES) throw new Error('Guest output exceeds 64 KiB');
  const output = new TextDecoder('utf-8', { fatal: true }).decode(
    checkedSlice(memory, outputPointer, outputLength),
  );
  return { validated: true, output };
}

self.onmessage = (event: MessageEvent<GuestRequest>) => {
  void handleGuestRequest(event.data)
    .then((result) => self.postMessage({ ok: true, ...result }))
    .catch((error: unknown) => self.postMessage({ ok: false, error: errorMessage(error) }));
};
