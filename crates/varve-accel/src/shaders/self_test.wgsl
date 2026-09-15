// Bounded hardware self-test: writes a deterministic pattern that the host
// verifies after readback. Success moves the device to ExecutionVerified.

@group(0) @binding(0) var<storage, read_write> data: array<u32>;

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= arrayLength(&data)) {
    return;
  }
  data[index] = index * 3u + 7u;
}
