//! Naga-based WGSL compilation validation.
//!
//! Parses and validates every WGSL shader string used by the TypeScript
//! compositor and background-removal GPU accelerator.  No real GPU, no
//! WebGPU runtime — Naga validates offline in Rust CI.
//!
//! ## Updating shaders
//!
//! The WGSL source below is extracted from two TS files:
//!
//!   packages/compositor/src/webgpu/shaders.ts — SOLID_VERTEX_WGSL,
//!     SOLID_FRAGMENT_WGSL, CIRCLE_FRAGMENT_WGSL, BLIT_VERTEX_WGSL,
//!     BLIT_FRAGMENT_WGSL (CIRCLE_VERTEX_WGSL aliases SOLID_VERTEX_WGSL)
//!
//!   packages/engine/src/backgroundRemoval/gpuAccelerator.ts —
//!     _getHorizontalBlurShader(), _getVerticalBlurShader() method returns
//!
//! When a WGSL shader is added or changed in those files, copy the new
//! WGSL string into the corresponding `const` below and run:
//!   cargo test wgsl_validation -- --nocapture
//!
//! If naga reports a parse error the new WGSL contains a real syntax bug
//! that must be fixed before deploying.

use naga::front::wgsl::parse_str;
use naga::valid::{Capabilities, ValidationFlags, Validator};

// ---- shaders.ts ----

const SOLID_VERTEX_WGSL: &str = r#"
struct CameraUniform {
  pan: vec2f,
  zoom: f32,
  viewportW: f32,
  viewportH: f32,
  // 4 bytes implicit padding before origin (vec2f requires 8-byte alignment)
  origin: vec2f,
};

@group(0) @binding(0) var<uniform> camera: CameraUniform;

struct VertexInput {
  @location(0) localPos: vec2f,
  @location(1) color: vec4f,
  @location(2) transform: vec4f,
  @location(3) transform2: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  // Affine transform manually computed — naga 30 rejects mat2x3f * vec3f
  // despite it being valid WGSL (naga regression).
  let world = vec2f(
    input.transform.x * input.localPos.x + input.transform.z * input.localPos.y + input.transform.w,
    input.transform.y * input.localPos.x + input.transform2.x * input.localPos.y + input.transform2.y,
  );
  let screen = vec2f(
    (world.x - camera.origin.x) * camera.zoom + camera.pan.x,
    (world.y - camera.origin.y) * camera.zoom + camera.pan.y,
  );
  let ndcX = (screen.x / camera.viewportW) * 2.0 - 1.0;
  let ndcY = 1.0 - (screen.y / camera.viewportH) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.color = input.color;
  return out;
}
"#;

const SOLID_FRAGMENT_WGSL: &str = r#"
@fragment
fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
"#;

// CIRCLE_VERTEX_WGSL aliases SOLID_VERTEX_WGSL in the TS source — same shader.

const CIRCLE_FRAGMENT_WGSL: &str = r#"
struct CircleUniform {
  center: vec2f,
  radius: f32,
  _pad: f32,
};

@group(0) @binding(1) var<uniform> circle: CircleUniform;

@fragment
fn fs_main(
  @location(0) color: vec4f,
  @builtin(position) pos: vec4f,
) -> @location(0) vec4f {
  let d = distance(pos.xy, circle.center);
  if (d > circle.radius) {
    discard;
  }
  return color;
}
"#;

const BLIT_VERTEX_WGSL: &str = r#"
struct BlitUniform {
  viewportW: f32,
  viewportH: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> blit: BlitUniform;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  var out: VertexOutput;
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2f(x, y);
  return out;
}
"#;

const BLIT_FRAGMENT_WGSL: &str = r#"
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
"#;

// ---- gpuAccelerator.ts ----

const SEPARABLE_BLUR_H_WGSL: &str = r#"
struct Uniforms {
  width: i32,
  height: i32,
  radius: i32,
  kernelSize: i32,
  kernel: array<f32, 128>,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<storage, read> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  if (x >= uniforms.width || y >= uniforms.height) { return; }

  var sum = 0.0;
  for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
    let sx = clamp(x + k, 0, uniforms.width - 1);
    let idx = y * uniforms.width + sx;
    let kv = uniforms.kernel[k + uniforms.radius];
    sum += input[idx] * kv;
  }
  output[y * uniforms.width + x] = sum;
}
"#;

const SEPARABLE_BLUR_V_WGSL: &str = r#"
struct Uniforms {
  width: i32,
  height: i32,
  radius: i32,
  kernelSize: i32,
  kernel: array<f32, 128>,
};

@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<storage, read> uniforms: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = i32(id.x);
  let y = i32(id.y);
  if (x >= uniforms.width || y >= uniforms.height) { return; }

  var sum = 0.0;
  for (var k = -uniforms.radius; k <= uniforms.radius; k++) {
    let sy = clamp(y + k, 0, uniforms.height - 1);
    let idx = sy * uniforms.width + x;
    let kv = uniforms.kernel[k + uniforms.radius];
    sum += input[idx] * kv;
  }
  output[y * uniforms.width + x] = sum;
}
"#;

// ---- helpers ----

fn validate(wgsl: &str, name: &str, has_entry_points: bool) {
    let module = parse_str(wgsl)
        .unwrap_or_else(|e| panic!("{name}: WGSL parse failed: {e}"));

    if has_entry_points {
        let mut validator = Validator::new(ValidationFlags::all(), Capabilities::all());
        if let Err(e) = validator.validate(&module) {
            // Print the diagnostic with the source for debugging.
            let rich = naga::error::ShaderError {
                source: wgsl.to_string(),
                label: Some(name.to_string()),
                inner: Box::new(e),
            };
            panic!("{name}: WGSL validation failed\n{rich}");
        }
    }
}

// ---- tests ----

#[test]
fn solid_vertex_wgsl() {
    validate(SOLID_VERTEX_WGSL, "SOLID_VERTEX_WGSL", true);
}

#[test]
fn solid_fragment_wgsl() {
    validate(SOLID_FRAGMENT_WGSL, "SOLID_FRAGMENT_WGSL", true);
}

#[test]
fn circle_vertex_wgsl() {
    // CIRCLE_VERTEX_WGSL aliases SOLID_VERTEX_WGSL in the TS source.
    // Validate it as a separate test to confirm the alias compiles.
    validate(SOLID_VERTEX_WGSL, "CIRCLE_VERTEX_WGSL (= SOLID_VERTEX_WGSL)", true);
}

#[test]
fn circle_fragment_wgsl() {
    validate(CIRCLE_FRAGMENT_WGSL, "CIRCLE_FRAGMENT_WGSL", true);
}

#[test]
fn blit_vertex_wgsl() {
    validate(BLIT_VERTEX_WGSL, "BLIT_VERTEX_WGSL", true);
}

#[test]
fn blit_fragment_wgsl() {
    validate(BLIT_FRAGMENT_WGSL, "BLIT_FRAGMENT_WGSL", true);
}

#[test]
fn separable_blur_h_wgsl() {
    validate(SEPARABLE_BLUR_H_WGSL, "separableBlurH (gpuAccelerator)", true);
}

#[test]
fn separable_blur_v_wgsl() {
    validate(SEPARABLE_BLUR_V_WGSL, "separableBlurV (gpuAccelerator)", true);
}
