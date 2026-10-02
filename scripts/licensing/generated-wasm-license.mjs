/**
 * wasm-pack writes the producing crate's npm metadata into the shared runtime
 * asset directory. `just wasm-build-all` finishes with the open colour crate;
 * that package must retain its own permissive license instead of being
 * relabeled as the FSL engine that was built into the same directory earlier.
 */
export function generatedWasmLicenseViolation(metadata) {
  const expected =
    metadata.name === 'varve-colour'
      ? 'MIT OR Apache-2.0'
      : metadata.name === 'varve-wasm'
        ? 'FSL-1.1-MIT'
        : null;
  if (!expected) return `unrecognized WASM producer "${metadata.name ?? '(missing)'}"`;
  return metadata.license === expected
    ? null
    : `${metadata.name}: expected "${expected}", got "${metadata.license ?? '(missing)'}"`;
}
