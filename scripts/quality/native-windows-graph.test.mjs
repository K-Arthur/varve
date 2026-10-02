import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyWindowsGpuGraph } from './native-windows-graph.mjs';

function fixture({
  allocatorWindows = '0.62.2',
  halWindows = '0.62.2',
  bareAllocator = false,
} = {}) {
  return `version = 4
[[package]]
name = "gpu-allocator"
version = "0.28.0"
dependencies = [
 "windows${bareAllocator ? '' : ` ${allocatorWindows}`}",
]
[[package]]
name = "wgpu-hal"
version = "30.0.1"
dependencies = [
 "gpu-allocator",
 "windows ${halWindows}",
]
[[package]]
name = "windows"
version = "0.61.3"
source = "registry+https://github.com/rust-lang/crates.io-index"
[[package]]
name = "windows"
version = "0.62.2"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;
}

test('both production locks use one D3D12 Windows type identity', () => {
  for (const path of ['Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock']) {
    const identity = verifyWindowsGpuGraph(readFileSync(path, 'utf8'));
    assert.ok(identity.windows);
  }
});

test('unrelated older Windows bindings can coexist with matching GPU bindings', () => {
  assert.deepEqual(verifyWindowsGpuGraph(fixture()), {
    hal: '30.0.1',
    allocator: '0.28.0',
    windows: '0.62.2',
  });
});

test('the actual CI mismatched allocator binding is rejected', () => {
  assert.throws(
    () => verifyWindowsGpuGraph(fixture({ allocatorWindows: '0.61.3' })),
    /D3D12 type mismatch/,
  );
});

test('missing or ambiguous dependency evidence fails closed', () => {
  assert.throws(() => verifyWindowsGpuGraph(fixture({ bareAllocator: true })), /ambiguous windows/);
  assert.throws(() => verifyWindowsGpuGraph(fixture({ allocatorWindows: '0.63.0' })), /Unresolved/);
  assert.throws(() => verifyWindowsGpuGraph('version = 4\n'), /Expected one wgpu-hal/);
});
