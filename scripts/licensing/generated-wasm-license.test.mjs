import assert from 'node:assert/strict';
import test from 'node:test';
import { generatedWasmLicenseViolation } from './generated-wasm-license.mjs';

test('accepts the open colour crate after the complete WASM build', () => {
  assert.equal(
    generatedWasmLicenseViolation({ name: 'varve-colour', license: 'MIT OR Apache-2.0' }),
    null,
  );
});

test('accepts the FSL engine after a base or SIMD WASM build', () => {
  assert.equal(generatedWasmLicenseViolation({ name: 'varve-wasm', license: 'FSL-1.1-MIT' }), null);
});

test('rejects relabeling the colour crate or the FSL engine', () => {
  assert.match(
    generatedWasmLicenseViolation({ name: 'varve-colour', license: 'FSL-1.1-MIT' }),
    /expected "MIT OR Apache-2.0"/,
  );
  assert.match(
    generatedWasmLicenseViolation({ name: 'varve-wasm', license: 'MIT OR Apache-2.0' }),
    /expected "FSL-1.1-MIT"/,
  );
});

test('rejects missing licenses and unknown generated package producers', () => {
  assert.match(generatedWasmLicenseViolation({ name: 'varve-wasm' }), /\(missing\)/);
  assert.match(
    generatedWasmLicenseViolation({ name: 'third-party', license: 'MIT OR Apache-2.0' }),
    /unrecognized WASM producer/,
  );
});
