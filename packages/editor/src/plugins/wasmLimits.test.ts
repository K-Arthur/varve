import { describe, expect, it } from 'vitest';
import { assertBoundedWasmSections } from './wasmLimits';

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...values]).buffer;
}

describe('guest allocation bounds', () => {
  it('accepts modules without self-allocated tables or memories', () => {
    expect(() => assertBoundedWasmSections(bytes())).not.toThrow();
  });

  it('rejects guest-defined memories before instantiation', () => {
    expect(() => assertBoundedWasmSections(bytes(5, 3, 1, 0, 1))).toThrow(
      'Guest-defined memories are not allowed',
    );
  });

  it('accepts only bounded function tables', () => {
    expect(() => assertBoundedWasmSections(bytes(4, 5, 1, 112, 1, 1, 2))).not.toThrow();
    expect(() => assertBoundedWasmSections(bytes(4, 4, 1, 112, 0, 1))).toThrow('maximum');
    expect(() => assertBoundedWasmSections(bytes(4, 6, 1, 112, 1, 1, 0x81, 0x08))).toThrow(
      'maximum',
    );
  });

  it('rejects sections that claim bytes beyond the package', () => {
    expect(() => assertBoundedWasmSections(bytes(5, 127))).toThrow('Truncated WebAssembly section');
  });
});
