import { describe, expect, it } from 'vitest';
import { assertBoundedWasmSections } from './wasmLimits';

function u32(value: number): number[] {
  const result: number[] = [];
  do {
    const next = value & 0x7f;
    value >>>= 7;
    result.push(next | (value === 0 ? 0 : 0x80));
  } while (value !== 0);
  return result;
}

function section(id: number, body: number[]): number[] {
  return [id, ...u32(body.length), ...body];
}

function wasm(
  options: { allocParameters?: number; definedMemory?: boolean; table?: number[] } = {},
) {
  const text = (value: string) => [...u32(value.length), ...new TextEncoder().encode(value)];
  const type = [
    3,
    0x60,
    options.allocParameters ?? 1,
    ...Array.from({ length: options.allocParameters ?? 1 }, () => 0x7f),
    1,
    0x7f,
    0x60,
    2,
    0x7f,
    0x7f,
    1,
    0x7f,
    0x60,
    0,
    1,
    0x7f,
  ];
  const imports = [1, ...text('env'), ...text('memory'), 2, 1, ...u32(64), ...u32(256)];
  const functionTypes = [3, 0, 1, 2];
  const exports = [3, ...text('alloc'), 0, 0, ...text('run'), 0, 1, ...text('result_len'), 0, 2];
  const body = [4, 0, 0x41, 0, 0x0b];
  const code = [3, ...body, ...body, ...body];
  return Uint8Array.from([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, type),
    ...section(2, imports),
    ...section(3, functionTypes),
    ...(options.table ? section(4, options.table) : []),
    ...(options.definedMemory ? section(5, [1, 0, 1]) : []),
    ...section(7, exports),
    ...section(10, code),
  ]).buffer;
}

describe('guest Wasm package profile', () => {
  it('accepts the exact numeric v1 function ABI and bounded imported memory', () => {
    const bytes = wasm();
    expect(() => assertBoundedWasmSections(bytes)).not.toThrow();
    expect(WebAssembly.validate(bytes)).toBe(true);
  });

  it('rejects a rooted 32 MiB GC array before compiling or instantiating it', () => {
    const bytes = Uint8Array.from(
      Buffer.from(
        'AGFzbQEAAAABEwReeAFgAX8Bf2ACf38Bf2AAAX8CEQEDZW52Bm1lbW9yeQIBQIACAwQDAQIDBgcBYwAB0AALBxwDBWFsbG9jAAADcnVuAAEKcmVzdWx0X2xlbgACChwDBABBAAsQAEGAgIAQ+wcAJAAjAPsPCwQAQQAL',
        'base64',
      ),
    ).buffer;
    expect(WebAssembly.validate(bytes)).toBe(true);
    expect(() => assertBoundedWasmSections(bytes)).toThrow('numeric function types only');
  });

  it('rejects a v1 export with a mismatched function signature', () => {
    const bytes = wasm({ allocParameters: 2 });
    expect(() => assertBoundedWasmSections(bytes)).toThrow('does not match the v1 ABI');
  });

  it('rejects a guest-defined memory before instantiation', () => {
    const bytes = wasm({ definedMemory: true });
    expect(() => assertBoundedWasmSections(bytes)).toThrow(
      'Guest-defined memories are not allowed',
    );
  });

  it('accepts only bounded function tables', () => {
    expect(() => assertBoundedWasmSections(wasm({ table: [1, 0x70, 1, 1, 2] }))).not.toThrow();
    expect(() => assertBoundedWasmSections(wasm({ table: [1, 0x70, 0, 1] }))).toThrow(
      'explicit maximums',
    );
    expect(() => assertBoundedWasmSections(wasm({ table: [1, 0x70, 1, 0, 0x81, 0x08] }))).toThrow(
      'at most 1024',
    );
  });

  it('rejects sections that claim bytes beyond the package', () => {
    const bytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 5, 127]).buffer;
    expect(() => assertBoundedWasmSections(bytes)).toThrow('Truncated WebAssembly section');
  });
});
