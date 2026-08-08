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
  // Occupies the 4-byte slot that WGSL would otherwise insert as padding
  // before origin (vec2f requires 8-byte alignment at offset 24).
  rotation: f32,
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
  // Affine: transform=vec4(a,b,c,d), transform2=vec2(e,f) → x'=a·x+c·y+e, y'=b·x+d·y+f
  // (kurbo / canvas / @varve/shared affine convention). Scalar form avoids
  // WGSL matCxR*vecC column-count traps — see varve-bridge wgsl_validation.
  let world = vec2f(
    input.transform.x * input.localPos.x + input.transform.z * input.localPos.y + input.transform2.x,
    input.transform.y * input.localPos.x + input.transform.w * input.localPos.y + input.transform2.y,
  );
  // Matches buildWorldToScreenAffine / applyCameraTransform: origin → zoom →
  // rotate about viewport centre → pan.
  let zoomed = vec2f(
    (world.x - camera.origin.x) * camera.zoom,
    (world.y - camera.origin.y) * camera.zoom,
  );
  let cx = camera.viewportW * 0.5;
  let cy = camera.viewportH * 0.5;
  let dx = zoomed.x - cx;
  let dy = zoomed.y - cy;
  let c = cos(camera.rotation);
  let s = sin(camera.rotation);
  let screen = vec2f(
    cx + camera.pan.x + dx * c - dy * s,
    cy + camera.pan.y + dx * s + dy * c,
  );
  let ndcX = (screen.x / camera.viewportW) * 2.0 - 1.0;
  let ndcY = 1.0 - (screen.y / camera.viewportH) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  // Premultiply here: canvas configured with alphaMode=premultiplied and
  // pipelines blend with one / one-minus-src-alpha.
  out.color = vec4f(input.color.rgb * input.color.a, input.color.a);
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
    let module = parse_str(wgsl).unwrap_or_else(|e| panic!("{name}: WGSL parse failed: {e}"));

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
    validate(
        SOLID_VERTEX_WGSL,
        "CIRCLE_VERTEX_WGSL (= SOLID_VERTEX_WGSL)",
        true,
    );
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
    validate(
        SEPARABLE_BLUR_H_WGSL,
        "separableBlurH (gpuAccelerator)",
        true,
    );
}

#[test]
fn separable_blur_v_wgsl() {
    validate(
        SEPARABLE_BLUR_V_WGSL,
        "separableBlurV (gpuAccelerator)",
        true,
    );
}

// ---- effect kernels (generated) ----
// Generated by packages/compositor/scripts/gen-wgsl-mirrors.mjs — do not edit.

const RGBSPLIT_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

fn remapCoord(v: f32, w: i32, border: u32) -> f32 {
  let i = i32(floor(v));
  if (border == 3u) {
    let m = ((i % w) + w) % w;
    return f32(m);
  }
  if (border == 2u) {
    let period = 2 * w;
    var m = ((i % period) + period) % period;
    if (m >= w) { m = period - m - 1; }
    return f32(m);
  }
  return clamp(v, 0.0, f32(w - 1));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

fn sampleChannel(src: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32, border: u32) -> vec4f {
  if (border == 0u) {
    if (x < 0.0 || x > f32(w - 1) || y < 0.0 || y > f32(h - 1)) {
      return vec4f(0.0);
    }
    return sampleBilinearClamped(src, samp, x, y, w, h);
  }
  let rx = remapCoord(x, w, border);
  let ry = remapCoord(y, h, border);
  return sampleBilinearClamped(src, samp, rx, ry, w, h);
}

@compute @workgroup_size(8, 8, 1)
fn rgbSplitMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let intensity = p[13];
  let scale = p[14];
  let redX = p[1] * scale * intensity;
  let redY = p[2] * scale * intensity;
  let greenX = p[3] * scale * intensity;
  let greenY = p[4] * scale * intensity;
  let blueX = p[5] * scale * intensity;
  let blueY = p[6] * scale * intensity;
  let fxx = f32(x);
  let fyy = f32(y);
  let r = sampleChannel(src, samp, fxx + redX, fyy + redY, w, h, u32(p[12]));
  let g = sampleChannel(src, samp, fxx + greenX, fyy + greenY, w, h, u32(p[12]));
  let b = sampleChannel(src, samp, fxx + blueX, fyy + blueY, w, h, u32(p[12]));
  let a = textureLoad(src, vec2i(x, y), 0).a;
  let pr = r.rgb * a;
  let pg = g.rgb * a;
  let pb = b.rgb * a;
  let outR = select(pr.r, pr.r / max(a, 1.0 / 255.0), a > 0.0);
  let outG = select(pg.g, pg.g / max(a, 1.0 / 255.0), a > 0.0);
  let outB = select(pb.b, pb.b / max(a, 1.0 / 255.0), a > 0.0);
  textureStore(dst, vec2i(x, y), vec4f(clamp(outR * 255.0, 0.0, 255.0), clamp(outG * 255.0, 0.0, 255.0), clamp(outB * 255.0, 0.0, 255.0), a * 255.0) / 255.0);
}"#;

const CRT_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

fn phosphorMask(mask: i32, x: f32, y: f32, pitch: f32) -> vec3f {
  let px = x % pitch;
  let t = px / pitch;
  if (mask == 1) {
    if (t < 0.34) { return vec3f(1.0, 0.22, 0.22); }
    if (t < 0.67) { return vec3f(0.22, 1.0, 0.22); }
    return vec3f(0.22, 0.22, 1.0);
  }
  if (mask == 2) {
    if (t < 0.34) { return vec3f(0.22, 0.22, 1.0); }
    if (t < 0.67) { return vec3f(0.22, 1.0, 0.22); }
    return vec3f(1.0, 0.22, 0.22);
  }
  if (mask == 3) {
    if (t < 0.5) { return vec3f(1.0, 0.35, 0.35); }
    return vec3f(0.35, 0.35, 1.0);
  }
  if (mask == 4) {
    let py = y % pitch;
    let dot = sqrt((t - 0.5) * (t - 0.5) + (py / pitch - 0.5) * (py / pitch - 0.5)) * 2.0;
    let dark = select(1.0, 0.2, dot > 0.85);
    return vec3f(dark, dark, dark);
  }
  return vec3f(1.0);
}

@compute @workgroup_size(8, 8, 1)
fn crtWarpMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let curvature = p[0];
  let scanPeriod = max(1.5, p[1]);
  let scanStrength = clamp01(p[2]);
  let scanSoftness = clamp01(p[3]);
  let mask = i32(p[4]);
  let pitch = max(1.0, p[5]);
  let phIntensity = clamp01(p[6]);
  let vignette = clamp01(p[8]);
  let vignetteR = clamp01(p[9]);
  let cx = p[10];
  let cy = p[11];
  let brightness = clamp(p[12], -1.0, 1.0);
  let contrast = clamp(p[13], 0.0, 2.0);

  let halfW = f32(w) / 2.0;
  let halfH = f32(h) / 2.0;
  let warpK = curvature * 0.28;

  let fxx = f32(x);
  let fyy = f32(y);

  var sx = fxx;
  var sy = fyy;
  if (warpK > 0.0) {
    let nx = (fxx - halfW) / halfW;
    let ny = (fyy - halfH) / halfH;
    let r2 = nx * nx + ny * ny;
    let scale = 1.0 + warpK * r2;
    sx = min(f32(w - 1), max(0.0, halfW + (nx * halfW) / scale));
    sy = min(f32(h - 1), max(0.0, halfH + (ny * halfH) / scale));
  }

  let s0 = textureLoad(src, vec2i(x, y), 0);
  let s = vec4f(s0.rgb * s0.a, s0.a);
  let a = s.a;

  // Warp sample (premultiplied).
  var r: f32 = 0.0; var g: f32 = 0.0; var b: f32 = 0.0;
  if (warpK > 0.0) {
    let c = sampleBilinearClamped(src, samp, sx, sy, w, h);
    let pm = vec4f(c.rgb * c.a, c.a);
    r = pm.r; g = pm.g; b = pm.b;
  } else {
    r = s.r; g = s.g; b = s.b;
  }

  // Convergence: red shifted +, blue shifted − (subpixel bilinear), 60% mix.
  if (cx != 0.0 || cy != 0.0) {
    let cr = sampleBilinearClamped(src, samp, fxx + cx, fyy + cy, w, h);
    let cb = sampleBilinearClamped(src, samp, fxx - cx, fyy - cy, w, h);
    r = r + (cr.r * cr.a - r) * 0.6;
    b = b + (cb.b * cb.a - b) * 0.6;
  }

  // Scanlines.
  if (scanStrength > 0.0) {
    let phase = ((fyy % scanPeriod) + scanPeriod) % scanPeriod;
    let pulse = 0.5 + 0.5 * cos((2.0 * 3.141592653589793 * phase) / scanPeriod);
    let depth = scanStrength * pow(pulse, 0.4 + scanSoftness * 2.2);
    r *= 1.0 - depth;
    g *= 1.0 - depth;
    b *= 1.0 - depth;
  }

  // Phosphor mask.
  if (mask != 0 && phIntensity > 0.0) {
    let m = phosphorMask(mask, fxx, fyy, pitch);
    let mi = phIntensity;
    r = r * (1.0 - mi) + r * m.r * mi;
    g = g * (1.0 - mi) + g * m.g * mi;
    b = b * (1.0 - mi) + b * m.b * mi;
  }

  // Vignette.
  if (vignette > 0.0) {
    let nx = (fxx - halfW) / (halfW * vignetteR * 2.0);
    let ny = (fyy - halfH) / (halfH * vignetteR * 2.0);
    let d = min(1.0, sqrt(nx * nx + ny * ny));
    let t = clamp01((d - 0.55) / (1.0 - 0.55));
    let vig = 1.0 - vignette * (t * t * (3.0 - 2.0 * t));
    r *= vig; g *= vig; b *= vig;
  }

  // Brightness/contrast.
  let gain = contrast;
  r = (r - 128.0) * gain + 128.0 + brightness * 128.0;
  g = (g - 128.0) * gain + 128.0 + brightness * 128.0;
  b = (b - 128.0) * gain + 128.0 + brightness * 128.0;

  textureStore(dst, vec2i(x, y), vec4f(r, g, b, a * 255.0) / 255.0);
}

// ── glow pass: 5x5 box blur of the warp output ──────────────────────────────

@group(2) @binding(1) var glowSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn crtGlowMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(glowSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var dy = -2; dy <= 2; dy = dy + 1) {
    for (var dx = -2; dx <= 2; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(glowSrc, vec2i(nx, ny), 0);
      n += 1.0;
    }
  }
  let avg = sum / n;
  // Clamp/round to byte precision like the CPU boxBlur3 (Math.round).
  textureStore(dst, vec2i(x, y), vec4f(round(avg.r * 255.0), round(avg.g * 255.0), round(avg.b * 255.0), round(avg.a * 255.0)) / 255.0);
}

// ── blend pass: a + (blur - a) * m, then unpremultiply ──────────────────────

@group(2) @binding(1) var blendA: texture_2d<f32>;
@group(2) @binding(2) var blendB: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn crtBlendMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blendA);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let glow = p[7];
  let m = glow * 0.5;
  let a = textureLoad(blendA, vec2i(x, y), 0);
  let b = textureLoad(blendB, vec2i(x, y), 0);
  var out = vec4f(
    clampByte(a.r * 255.0 + (b.r * 255.0 - a.r * 255.0) * m),
    clampByte(a.g * 255.0 + (b.g * 255.0 - a.g * 255.0) * m),
    clampByte(a.b * 255.0 + (b.b * 255.0 - a.b * 255.0) * m),
    a.a * 255.0,
  );
  // Unpremultiply.
  if (out.a > 0.0 && out.a < 255.0) {
    let inv = 255.0 / out.a;
    out.r = clampByte(out.r * inv);
    out.g = clampByte(out.g * inv);
    out.b = clampByte(out.b * inv);
  }
  textureStore(dst, vec2i(x, y), out / 255.0);
}"#;

const LIGHTLEAK_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightLeakMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let intensity = max(0.0, p[9]);
  let seed = u32(p[0]);
  let cx = f32(w) * clamp01(p[1]);
  let cy = f32(h) * clamp01(p[2]);
  let angle = p[3] * 3.141592653589793 / 180.0;
  let diag = sqrt(f32(w * w + h * h));
  let sizeParam = max(0.05, p[4]);
  let sigma = diag * sizeParam * 0.14;
  let softness = clamp01(p[5]);
  let noiseScale = clamp01(p[10]);
  let cosA = cos(angle);
  let sinA = sin(angle);
  let noiseFreq = (1.0 / max(1.0, diag * 0.02)) * (0.3 + noiseScale * 1.6);
  let octaves = 1 + i32(round(softness * 3.0));

  let col = hslToRgb01(p[6], clamp01(p[7]), clamp01(p[8]));

  let dx = f32(x) - cx;
  let dy = f32(y) - cy;
  let nx = dx * cosA - dy * sinA;
  let ny = dx * sinA + dy * cosA;
  let n = fbm2(nx * noiseFreq, ny * noiseFreq, seed, octaves);
  let g = exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma));
  let leak = n * g * intensity;
  if (leak <= 0.004) { return; }

  let s = textureLoad(src, vec2i(x, y), 0);
  let lr = col.r * leak;
  let lg = col.g * leak;
  let lb = col.b * leak;
  let out = vec4f(
    clampByte(255.0 - ((255.0 - s.r * 255.0) * (255.0 - lr)) / 255.0),
    clampByte(255.0 - ((255.0 - s.g * 255.0) * (255.0 - lg)) / 255.0),
    clampByte(255.0 - ((255.0 - s.b * 255.0) * (255.0 - lb)) / 255.0),
    s.a * 255.0,
  );
  textureStore(dst, vec2i(x, y), out / 255.0);
}"#;

const PALETTESNAP_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(1) @binding(0) var<storage, read_write> pal: array<f32, 384>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

fn srgbToLinear01c(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn linearSrgbToOklabc(rgb: vec3f) -> vec3f {
  let m1 = mat3x3f(
    vec3f(0.4122214708, 0.2119034982, 0.0883024619),
    vec3f(0.5363325363, 0.6806995451, 0.2817188376),
    vec3f(0.0514459929, 0.1073969566, 0.6299787005),
  );
  let m2 = mat3x3f(
    vec3f(0.2104542553, 1.9779984951, 0.0259040371),
    vec3f(0.793617785, -2.428592205, 0.7827717662),
    vec3f(-0.0040720468, 0.4505937099, -0.808675766),
  );
  let lms = m1 * rgb;
  let lms3 = vec3f(pow(lms.x, 1.0 / 3.0), pow(lms.y, 1.0 / 3.0), pow(lms.z, 1.0 / 3.0));
  return m2 * lms3;
}

fn toLabc(rgb: vec3f, metric: i32) -> vec3f {
  if (metric == 3) {
    return linearSrgbToOklabc(vec3f(srgbToLinear01c(rgb.x), srgbToLinear01c(rgb.y), srgbToLinear01c(rgb.z)));
  }
  // Lab via XYZ D65 (matches the CPU paletteCore path).
  let rl = srgbToLinear01c(rgb.x);
  let gl = srgbToLinear01c(rgb.y);
  let bl = srgbToLinear01c(rgb.z);
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  let fx = select(7.787 * x + 16.0 / 116.0, pow(x, 1.0 / 3.0), x > 0.008856);
  let fy = select(7.787 * y + 16.0 / 116.0, pow(y, 1.0 / 3.0), y > 0.008856);
  let fz = select(7.787 * z + 16.0 / 116.0, pow(z, 1.0 / 3.0), z > 0.008856);
  return vec3f(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

fn distMetric(a: vec3f, b: vec3f, metric: i32) -> f32 {
  if (metric == 0) {
    let d = a - b;
    return dot(d, d);
  }
  if (metric == 1) {
    let la = vec3f(srgbToLinear01c(a.x), srgbToLinear01c(a.y), srgbToLinear01c(a.z));
    let lb = vec3f(srgbToLinear01c(b.x), srgbToLinear01c(b.y), srgbToLinear01c(b.z));
    let d = la - lb;
    return dot(d, d);
  }
  let d = toLabc(a, metric) - toLabc(b, metric);
  return dot(d, d);
}

@compute @workgroup_size(8, 8, 1)
fn paletteSnapMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let amount = p[0];
  let alphaCutoff = p[1];
  let metric = i32(p[3]);
  let dither = p[4] > 0.5;
  let ditherStrength = p[5];
  let seed = u32(p[2]);
  let paletteSize = i32(p[7]);

  let s = textureLoad(src, vec2i(x, y), 0);
  let a = s.a * 255.0;
  if (a / 255.0 < alphaCutoff || a <= 0.0) {
    textureStore(dst, vec2i(x, y), s);
    return;
  }

  let srgb = vec3f(s.r * 255.0, s.g * 255.0, s.b * 255.0);
  var best = vec3f(srgb);
  var bestD = 1e30;
  for (var i: i32 = 0; i < paletteSize; i = i + 1) {
    let pc = vec3f(pal[i * 3] * 255.0, pal[i * 3 + 1] * 255.0, pal[i * 3 + 2] * 255.0);
    let d = distMetric(srgb, pc, metric);
    if (d < bestD) {
      bestD = d;
      best = pc;
    }
  }

  var outR: f32 = s.r * 255.0;
  var outG: f32 = s.g * 255.0;
  var outB: f32 = s.b * 255.0;
  if (amount >= 1.0) {
    outR = best.x;
    outG = best.y;
    outB = best.z;
  } else {
    outR = outR + (best.x - outR) * amount;
    outG = outG + (best.y - outG) * amount;
    outB = outB + (best.z - outB) * amount;
  }

  // Bayer 4x4 dither on the quantization error (the CPU paletteSnap dither
  // path uses applyDither's bayer mode when requested).
  if (dither && ditherStrength > 0.0) {
    let bayer = mat4x4f(
      vec4f(0.0, 8.0, 2.0, 10.0),
      vec4f(12.0, 4.0, 14.0, 6.0),
      vec4f(3.0, 11.0, 1.0, 9.0),
      vec4f(15.0, 7.0, 13.0, 5.0),
    );
    let bx = x & 3;
    let by = y & 3;
    let th = (bayer[by][bx] + 0.5) / 16.0;
    let err = (best - vec3f(s.r * 255.0, s.g * 255.0, s.b * 255.0)) * ditherStrength;
    if (err.x > 0.0 && (err.x / 255.0) > th) { outR = min(255.0, outR + 255.0); }
    if (err.y > 0.0 && (err.y / 255.0) > th) { outG = min(255.0, outG + 255.0); }
    if (err.z > 0.0 && (err.z / 255.0) > th) { outB = min(255.0, outB + 255.0); }
  }

  textureStore(
    dst,
    vec2i(x, y),
    vec4f(clamp(outR, 0.0, 255.0), clamp(outG, 0.0, 255.0), clamp(outB, 0.0, 255.0), a) / 255.0,
  );
}"#;

const VHS_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let seed = u32(p[0]);
  let frameRate = max(1.0, p[1]);
  let time = max(0.0, p[2]);
  let frame = i32(floor(time * frameRate));
  let field = hash3(i32(seed), frame, 0, seed);

  let lumaNoise = clamp01(p[3]);
  let chromaNoise = clamp01(p[4]);
  let jitter = clamp01(p[6]);
  let tracking = clamp01(p[7]);
  let dropouts = clamp01(p[8]);
  let headSwitch = clamp01(p[9]);
  let tearing = clamp01(p[10]);
  let instability = clamp01(p[12]);

  let jitterPhase = seeded01(u32(round(field * 2147483648.0)) ^ 0x5f3759dfu);
  let trackingY = i32(floor(seeded01(u32(round(field * 2147483648.0)) ^ 0x9e3779b9u) * f32(h)));
  let tearCount = max(1, i32(round(tearing * 24.0)));
  let driftX = (jitterPhase - 0.5) * 2.0 * instability * 24.0;

  // Per-line jitter (CPU precomputes per line; compute per pixel here).
  let lineJitter = (hash3(i32(field), y, 1, seed) - 0.5) * 2.0 * jitter * 16.0;

  // Tear slices.
  var tearOffset = 0.0;
  if (tearing > 0.0) {
    let sliceH = max(4.0, floor(f32(h) / f32(tearCount)));
    let s = i32(floor(f32(y) / sliceH));
    tearOffset = round((hash3(i32(field), s, 2, seed) - 0.5) * 2.0 * tearing * 48.0);
  }

  let headOffset = select(
    0.0,
    round((hash3(i32(field), 9, 4, seed) - 0.5) * 2.0 * headSwitch * 40.0),
    y > i32(f32(h) * 0.92),
  );
  var trackOffset = 0.0;
  if (tracking > 0.0 && abs(f32(y) - f32(trackingY)) < max(2.0, f32(h) * 0.03)) {
    trackOffset = round((hash3(i32(field), y, 5, seed) - 0.5) * 2.0 * tracking * 24.0);
  }

  let shift = round(lineJitter + tearOffset + headOffset + trackOffset);
  let sx = ((x + i32(shift)) % w + w) % w;
  let s = textureLoad(src, vec2i(sx, y), 0);

  var r = s.r * 255.0;
  var g = s.g * 255.0;
  var b = s.b * 255.0;
  let a = s.a * 255.0;

  // Time instability: global slow drift.
  if (instability > 0.0 && driftX != 0.0) {
    let dx = i32(round(driftX));
    let sxo = ((x + dx) % w + w) % w;
    let s2 = textureLoad(src, vec2i(sxo, y), 0);
    r = r * 0.5 + s2.r * 255.0 * 0.5;
    g = g * 0.5 + s2.g * 255.0 * 0.5;
    b = b * 0.5 + s2.b * 255.0 * 0.5;
  }

  // Per-pixel noise (CPU uses a sequential RNG stream; hash-based here).
  let rn = (hash3(x, y, frame, seed) - 0.5);
  if (lumaNoise > 0.0) {
    let n = rn * 2.0 * lumaNoise * 42.0;
    r += n;
    g += n;
    b += n;
  }
  if (chromaNoise > 0.0) {
    let n = (hash3(x, y, frame + 31, seed) - 0.5) * 2.0 * chromaNoise * 34.0;
    r += n;
    b -= n;
  }

  // Dropout rows.
  var isDropout = false;
  if (dropouts > 0.0) {
    let dropCount = i32(round(dropouts * 12.0));
    for (var i: i32 = 0; i < dropCount; i = i + 1) {
      let dy = i32(floor(hash3(i32(field), i, 3, seed) * f32(h)));
      if (dy == y || min(h - 1, dy + 1) == y) { isDropout = true; }
    }
  }
  if (isDropout) {
    let d = 0.55 + (hash3(x, y, frame + 17, seed) * 0.3);
    r = r * 0.3 + 255.0 * d * 0.7;
    g = g * 0.3 + 255.0 * d * 0.7;
    b = b * 0.3 + 255.0 * d * 0.7;
  }

  textureStore(dst, vec2i(x, y), vec4f(clampByte(r), clampByte(g), clampByte(b), a) / 255.0);
}

// ── chroma bleed: horizontal box on R/B ─────────────────────────────────────

@group(2) @binding(1) var bleedSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsBleed(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(bleedSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let bleed = clamp01(p[5]);
  let radius = max(1, i32(round(bleed * 12.0 * p[13])));
  var r: f32 = 0.0;
  var b: f32 = 0.0;
  var n: f32 = 0.0;
  for (var dx = -radius; dx <= radius; dx = dx + 1) {
    let nx = x + dx;
    if (nx < 0 || nx >= w) { continue; }
    let c = textureLoad(bleedSrc, vec2i(nx, y), 0);
    r += c.r * 255.0;
    b += c.b * 255.0;
    n += 1.0;
  }
  let cur = textureLoad(bleedSrc, vec2i(x, y), 0);
  let mix = bleed * 0.85;
  let outR = clampByte(cur.r * 255.0 + (r / max(n, 1.0) - cur.r * 255.0) * mix);
  let outB = clampByte(cur.b * 255.0 + (b / max(n, 1.0) - cur.b * 255.0) * mix);
  textureStore(dst, vec2i(x, y), vec4f(outR, cur.g * 255.0, outB, cur.a * 255.0) / 255.0);
}

// ── signal blur: 3x3 box blur blend ─────────────────────────────────────────

@group(2) @binding(1) var blurSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsBlur(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(blurSrc, vec2i(nx, ny), 0);
      n += 1.0;
    }
  }
  let cur = textureLoad(blurSrc, vec2i(x, y), 0);
  let m = clamp01(p[11]) * 0.6;
  let out = vec4f(
    clampByte(cur.r * 255.0 + (sum.r / n * 255.0 - cur.r * 255.0) * m),
    clampByte(cur.g * 255.0 + (sum.g / n * 255.0 - cur.g * 255.0) * m),
    clampByte(cur.b * 255.0 + (sum.b / n * 255.0 - cur.b * 255.0) * m),
    cur.a * 255.0,
  );
  textureStore(dst, vec2i(x, y), out / 255.0);
}"#;

const LIGHTSHAFTS_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsRay(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let intensity = max(0.0, p[0]);
  if (intensity <= 0.0) { return; }
  let exposure = clamp(p[1], -1.0, 1.0);
  let decay = clamp01(p[2]);
  let density = clamp01(p[3]);
  let weight = clamp01(p[4]);
  let occlusionCode = i32(p[6]);
  let steps = max(4, min(96, i32(round(p[11]))));

  let lightX = f32(w) * clamp01(p[7]);
  let lightY = f32(h) * clamp01(p[8]);
  let isDirectional = p[9] > 0.5;
  let angle = p[10] * 3.141592653589793 / 180.0;
  let dirX = -cos(angle);
  let dirY = -sin(angle);
  let maxDist = sqrt(f32(w * w + h * h));

  let px = f32(x) + 0.5;
  let py = f32(y) + 0.5;
  var rayX: f32;
  var rayY: f32;
  if (isDirectional) {
    rayX = dirX;
    rayY = dirY;
  } else {
    let ddx = lightX - px;
    let ddy = lightY - py;
    var d = sqrt(ddx * ddx + ddy * ddy);
    if (d <= 0.000001) { d = 1.0; }
    rayX = ddx / d;
    rayY = ddy / d;
  }
  var distToLight = sqrt((lightX - px) * (lightX - px) + (lightY - py) * (lightY - py));
  if (isDirectional) { distToLight = maxDist; }
  let stepLen = max(1.0, distToLight / f32(steps));

  var acc: f32 = 0.0;
  var sampleX: f32 = px;
  var sampleY: f32 = py;
  var e: f32 = 1.0;
  for (var s: i32 = 0; s < steps; s = s + 1) {
    sampleX += rayX * stepLen;
    sampleY += rayY * stepLen;
    let si = min(w - 1, max(0, i32(floor(sampleX)))) + min(h - 1, max(0, i32(floor(sampleY)))) * w;
    let sc = textureLoad(src, vec2i(si % w, si / w), 0);
    var occ: f32;
    if (occlusionCode == 1) {
      occ = sc.a;
    } else {
      let lum = 0.2126 * sc.r * 255.0 + 0.7152 * sc.g * 255.0 + 0.0722 * sc.b * 255.0;
      occ = max(0.0, srgbByteToLinear01(lum) - 0.12) * weight;
    }
    acc += occ * e * density;
    e *= decay;
    if (sampleX < 0.0 || sampleX >= f32(w) || sampleY < 0.0 || sampleY >= f32(h)) { break; }
  }

  let stored = clamp(acc * 255.0, 0.0, 255.0);
  textureStore(dst, vec2i(x, y), vec4f(stored, stored, stored, 1.0) / 255.0);
}

// ── scatter blur ────────────────────────────────────────────────────────────

@group(2) @binding(1) var scatterSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsBlur(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(scatterSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let radius = max(1, i32(round(p[5] * 6.0)));
  var sum = vec3f(0.0);
  var n = 0.0;
  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(scatterSrc, vec2i(nx, ny), 0).rgb;
      n += 1.0;
    }
  }
  let avg = sum / max(n, 1.0);
  textureStore(dst, vec2i(x, y), vec4f(avg, 1.0));
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var scatter2: texture_2d<f32>;
@group(2) @binding(2) var src2: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(scatter2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let sc = textureLoad(scatter2, vec2i(x, y), 0);
  let srcv = textureLoad(src2, vec2i(x, y), 0);
  let s = sc.r * 255.0;
  let gain = p[0] * pow(2.0, p[1]);
  var lr = s * gain;
  var lg = s * gain;
  var lb = s * gain;
  if (p[12] > 0.5) {
    lr *= p[13];
    lg *= p[14];
    lb *= p[15];
  }
  textureStore(
    dst,
    vec2i(x, y),
    vec4f(
      clampByte(srcv.r * 255.0 + lr),
      clampByte(srcv.g * 255.0 + lg),
      clampByte(srcv.b * 255.0 + lb),
      srcv.a * 255.0,
    ) / 255.0,
  );
}"#;

const CAUSTICS_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn causticsField(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let scalePx = max(4.0, p[0]);
  let depth = clamp01(p[1]);
  let count = max(2, min(8, i32(round(p[2]))));
  let complexity = clamp01(p[3]);
  let seed = u32(p[20]);
  let time = max(0.0, p[21]);
  let animSpeed = p[22];
  let tileable = p[23] > 0.5;
  let period = scalePx * 4.0;

  let px = f32(x) + 0.5;
  let py = f32(y) + 0.5;

  var hx: f32 = 0.0;
  var hy: f32 = 0.0;
  var hlap: f32 = 0.0;
  for (var i: i32 = 0; i < count; i = i + 1) {
    var kx: f32;
    var ky: f32;
    if (tileable) {
      let nx = max(1.0, round(seeded01(seed + u32(i * 101 + 1)) * 3.0));
      let my = max(1.0, round(seeded01(seed + u32(i * 101 + 2)) * 3.0));
      kx = (nx * 2.0 * 3.141592653589793) / period;
      ky = (my * 2.0 * 3.141592653589793) / period;
      if ((i & 1) == 0) { kx = -kx; }
      if ((i & 2) == 0) { ky = -ky; }
    } else {
      let angle = seeded01(seed + u32(i * 101)) * 3.141592653589793 * 2.0;
      kx = cos(angle) * (2.0 * 3.141592653589793) / period;
      ky = sin(angle) * (2.0 * 3.141592653589793) / period;
    }
    let amp = 1.0 / f32(i + 1);
    let phase = seeded01(seed + u32(i * 173)) * 3.141592653589793 * 2.0;
    let speed = 0.5 + seeded01(seed + u32(i * 233)) * 0.5;
    let arg = kx * px + ky * py + phase + speed * time * 3.141592653589793 * 2.0 * animSpeed;
    let s = sin(arg);
    let c = cos(arg);
    let k2 = kx * kx + ky * ky;
    hx += amp * kx * c;
    hy += amp * ky * c;
    hlap += -amp * k2 * s;
  }
  hx *= depth;
  hy *= depth;
  hlap *= depth;

  // Complexity: mix a fine secondary field into the laplacian.
  if (complexity > 0.0) {
    let n = seeded01(u32(round(hlap * 4096.0)) ^ (seed + u32(y * 31 + x * 7)));
    hlap = hlap * (1.0 - complexity) + (n - 0.5) * 0.05 * complexity;
  }

  textureStore(dst, vec2i(x, y), vec4f(hx, hy, hlap, 0.0) / 1.0);
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var field: texture_2d<f32>;
@group(2) @binding(2) var src2: texture_2d<f32>;
@group(2) @binding(3) var samp: sampler;

fn fieldBilinear(tex: texture_2d<f32>, fx: f32, fy: f32, w: i32, h: i32) -> vec4f {
  let gx = min(f32(w - 1), max(0.0, fx));
  let gy = min(f32(h - 1), max(0.0, fy));
  let x0 = i32(floor(gx));
  let y0 = i32(floor(gy));
  let x1 = min(w - 1, x0 + 1);
  let y1 = min(h - 1, y0 + 1);
  let fxx = gx - f32(x0);
  let fyy = gy - f32(y0);
  let a = textureLoad(tex, vec2i(x0, y0), 0);
  let b = textureLoad(tex, vec2i(x1, y0), 0);
  let c = textureLoad(tex, vec2i(x0, y1), 0);
  let d = textureLoad(tex, vec2i(x1, y1), 0);
  return a + (b - a) * fxx + (c - a) * fyy + (a - b - c + d) * fxx * fyy;
}

@compute @workgroup_size(8, 8, 1)
fn causticsComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let scalePx = max(4.0, p[0]);
  let refraction = clamp01(p[4]);
  let distortion = clamp01(p[10]);
  let sharpness = clamp01(p[5]);
  let brightness = max(0.0, p[7]);
  let contrast = max(0.0, p[8]);
  let dispersion = clamp01(p[9]);
  let output = i32(p[11]);
  let lightAngle = p[6] * 3.141592653589793 / 180.0;

  let f = fieldBilinear(field, f32(x) - 0.5, f32(y) - 0.5, w, h);
  let gx_ = f.x;
  let gy_ = f.y;
  let lap_ = f.z;

  let srcv = textureLoad(src2, vec2i(x, y), 0);

  let disp = 1.0 + dispersion * 0.6;
  let base = refraction * distortion * scalePx * 0.09;
  let offR = gx_ * base * disp;
  let offG = gx_ * base;
  let offB = gx_ * base * (2.0 - disp);
  let offRY = gy_ * base * disp;
  let offGY = gy_ * base;
  let offBY = gy_ * base * (2.0 - disp);

  var r: f32;
  var g: f32;
  var b: f32;
  if (output == 1) {
    r = srcv.r * 255.0;
    g = srcv.g * 255.0;
    b = srcv.b * 255.0;
  } else {
    r = sampleBilinearClamped(src2, samp, f32(x) + offR, f32(y) + offRY, w, h).r * 255.0;
    g = sampleBilinearClamped(src2, samp, f32(x) + offG, f32(y) + offGY, w, h).g * 255.0;
    b = sampleBilinearClamped(src2, samp, f32(x) + offB, f32(y) + offBY, w, h).b * 255.0;
  }

  let focusScale = (0.3 + sharpness * 1.2) * 0.06 * scalePx;
  let c = clamp01(0.45 + lap_ * focusScale * brightness);
  let lightDirX = cos(lightAngle);
  let lightDirY = sin(lightAngle);
  let shade = 0.5 + 0.5 * clamp(lightDirX * gx_ + lightDirY * gy_, -1.0, 1.0);
  let light = clamp01((c - 0.5) * contrast + 0.5);

  if (output == 2) {
    textureStore(dst, vec2i(x, y), vec4f(r, g, b, srcv.a * 255.0) / 255.0);
    return;
  }

  let bright = 0.55 + light * 0.9 * shade;
  var nr = r * bright;
  var ng = g * bright;
  var nb = b * bright;
  if (p[12] > 0.5) {
    let m = clamp01(light) * 0.5;
    nr = nr * (1.0 - m) + p[13] * 255.0 * light * m;
    ng = ng * (1.0 - m) + p[14] * 255.0 * light * m;
    nb = nb * (1.0 - m) + p[15] * 255.0 * light * m;
  }
  if (p[16] > 0.5) {
    nr = nr * 0.65 + nr * p[17] * 0.35;
    ng = ng * 0.65 + ng * p[18] * 0.35;
    nb = nb * 0.65 + nb * p[19] * 0.35;
  }
  textureStore(dst, vec2i(x, y), vec4f(clampByte(nr), clampByte(ng), clampByte(nb), srcv.a * 255.0) / 255.0);
}"#;

const LENSFLARE_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lensFlareMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let brightness = max(0.0, p[0]);
  let seed = u32(p[1]);
  let scale = max(0.05, p[2]);
  let baseRadius = f32(min(w, h)) * 0.09 * scale;
  let ghostCount = max(0, min(8, i32(round(p[3]))));
  let ghostSpacing = max(0.0, p[4]);
  let halo = clamp01(p[5]);
  let blades = i32(round(p[6]));
  let apertureRotation = p[7] * 3.141592653589793 / 180.0;
  let streak = clamp01(p[8]);
  let anamorphic = clamp01(p[9]);
  let dispersion = clamp01(p[10]);

  let fxx = f32(x);
  let fyy = f32(y);
  let lx = f32(w) * clamp01(p[11]);
  let ly = f32(h) * clamp01(p[12]);
  let ax = f32(w) / 2.0 - lx;
  let ay = f32(h) / 2.0 - ly;
  var axisLen = sqrt(ax * ax + ay * ay);
  if (axisLen < 0.000001) { axisLen = 1.0; }
  let ux = ax / axisLen;
  let uy = ay / axisLen;

  var acc = vec3f(0.0);
  let bf = brightness;

  // Central halo.
  if (halo > 0.0) {
    let hr = baseRadius * 2.2;
    let dx = fxx - lx;
    let dy = fyy - ly;
    let d2 = dx * dx + dy * dy;
    let r2 = hr * hr;
    let v = exp(-d2 / (2.0 * r2)) * halo * 0.5 * bf;
    if (v >= 0.004) { acc += vec3f(v, v, v); }
  }

  // Ghosts along the axis opposite the source.
  for (var i: i32 = 1; i <= ghostCount; i = i + 1) {
    let g = seeded01(seed + u32(i * 7919));
    let gx = lx + ux * -1.0 * f32(i) * ghostSpacing * baseRadius * 1.6;
    let gy = ly + uy * -1.0 * f32(i) * ghostSpacing * baseRadius * 1.6;
    let gr = baseRadius * (0.55 - f32(i) * 0.04) * (0.7 + g * 0.6);
    let intensity = bf * (1.0 - f32(i) / f32(ghostCount + 1)) * 0.8;
    let dx = fxx - gx;
    let dy = fyy - gy;
    let d2 = dx * dx + dy * dy;
    if (gr * gr <= 0.0) { continue; }
    if (dispersion > 0.0) {
      let off = gr * dispersion;
      let cr = exp(-((fxx - (gx + off * ux)) * (fxx - (gx + off * ux)) + (fyy - (gy + off * uy)) * (fyy - (gy + off * uy))) / (2.0 * gr * gr)) * intensity;
      let cg = exp(-d2 / (2.0 * gr * gr)) * intensity * 0.7;
      let cb = exp(-((fxx - (gx - off * ux)) * (fxx - (gx - off * ux)) + (fyy - (gy - off * uy)) * (fyy - (gy - off * uy))) / (2.0 * gr * gr)) * intensity;
      if (cr >= 0.004) { acc.x += cr; }
      if (cg >= 0.004) { acc.y += cg; }
      if (cb >= 0.004) { acc.z += cb; }
    } else {
      let v = exp(-d2 / (2.0 * gr * gr)) * intensity;
      if (v >= 0.004) { acc += vec3f(v, v, v); }
    }
  }

  // Diffraction streaks (anamorphic-weighted cross).
  if (streak > 0.0) {
    let sr = baseRadius * (4.0 + anamorphic * 6.0);
    let sw = max(1.0, baseRadius * 0.045 * (1.0 - anamorphic * 0.6));
    let a1 = atan2(uy, ux);
    let c1 = cos(a1);
    let s1 = sin(a1);
    let dx = fxx - lx;
    let dy = fyy - ly;
    let along = dx * c1 + dy * s1;
    let perp = -dx * s1 + dy * c1;
    let v1 = exp(-(along * along) / (2.0 * sr * sr)) * exp(-(perp * perp) / (2.0 * max(0.6, sw * sw))) * streak * 0.9 * bf;
    if (v1 >= 0.004) { acc += vec3f(v1, v1, v1); }
    let a2 = atan2(ux, -uy);
    let c2 = cos(a2);
    let s2 = sin(a2);
    let sr2 = sr * (1.0 + anamorphic);
    let sw2 = sw * (1.0 + anamorphic);
    let along2 = dx * c2 + dy * s2;
    let perp2 = -dx * s2 + dy * c2;
    let v2 = exp(-(along2 * along2) / (2.0 * sr2 * sr2)) * exp(-(perp2 * perp2) / (2.0 * max(0.6, sw2 * sw2))) * streak * 0.5 * bf;
    if (v2 >= 0.004) { acc += vec3f(v2, v2, v2); }
  }

  // Aperture polygon star.
  if (blades >= 3) {
    let ar = baseRadius * 1.5;
    let inner = ar * 0.82;
    let dx = fxx - lx;
    let dy = fyy - ly;
    let dist = sqrt(dx * dx + dy * dy);
    if (dist <= ar) {
      let ang = atan2(dy, dx) + apertureRotation;
      let sector = (ang / 3.141592653589793) * f32(blades);
      let f = abs(sector - round(sector));
      let radAtAngle = inner + (ar - inner) * (1.0 - f);
      let inside = select(exp(-((dist - radAtAngle) * (dist - radAtAngle)) / (2.0 * 0.8)), 1.0, dist <= radAtAngle);
      let v = inside * bf * 0.55 * 0.6;
      if (v >= 0.004) { acc += vec3f(v, v, v); }
    }
  }

  let s = textureLoad(src, vec2i(x, y), 0);
  textureStore(
    dst,
    vec2i(x, y),
    vec4f(
      clampByte(s.r * 255.0 + acc.x * 255.0),
      clampByte(s.g * 255.0 + acc.y * 255.0),
      clampByte(s.b * 255.0 + acc.z * 255.0),
      s.a * 255.0,
    ) / 255.0,
  );
}"#;

const BLOOM_WGSL: &str = r#"
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}

@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBright(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let s = textureLoad(src, vec2i(x, y), 0);
  let lum = 0.2126 * s.r * 255.0 + 0.7152 * s.g * 255.0 + 0.0722 * s.b * 255.0;
  let lin = srgbByteToLinear01(lum);
  let thresh = p[0];
  let knee = p[1];
  var m: f32;
  if (knee <= 0.0) {
    m = select(0.0, 1.0, lin >= thresh);
  } else {
    let d = (lin - thresh) / knee;
    m = select(0.0, 1.0, d >= 1.0);
    m = select(m, d * 0.5 + 0.5, d > -1.0 && d < 1.0);
  }
  let f = m * m;
  textureStore(dst, vec2i(x, y), vec4f(s.r * f, s.g * f, s.b * f, s.a));
}

// ── downsample: 2x2 box average, written at full-res stride ────────────────

@group(2) @binding(1) var downSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomDown(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(downSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let px = gx * 2;
  let py = gy * 2;
  let c00 = textureLoad(downSrc, vec2i(px, py), 0);
  let c10 = textureLoad(downSrc, vec2i(min(w - 1, px + 1), py), 0);
  let c01 = textureLoad(downSrc, vec2i(px, min(h - 1, py + 1)), 0);
  let c11 = textureLoad(downSrc, vec2i(min(w - 1, px + 1), min(h - 1, py + 1)), 0);
  let avg = (c00 + c10 + c01 + c11) * 0.25;
  textureStore(dst, vec2i(px, py), avg);
}

// ── 5-tap separable blur at grid stride ─────────────────────────────────────

@group(2) @binding(1) var blurSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBlurH(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let py = gy * 2;
  let px = gx * 2;
  var sum = vec4f(0.0);
  let weights = array<f32, 5>(0.05, 0.2, 0.5, 0.2, 0.05);
  for (var k: i32 = -2; k <= 2; k = k + 1) {
    let nx = clamp(px + k * 2, 0, w - 1);
    sum += textureLoad(blurSrc, vec2i(nx, py), 0) * weights[k + 2];
  }
  textureStore(dst, vec2i(px, py), sum);
}

@group(2) @binding(1) var blurSrc2: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBlurV(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc2);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let py = gy * 2;
  let px = gx * 2;
  var sum = vec4f(0.0);
  let weights = array<f32, 5>(0.05, 0.2, 0.5, 0.2, 0.05);
  for (var k: i32 = -2; k <= 2; k = k + 1) {
    let ny = clamp(py + k * 2, 0, h - 1);
    sum += textureLoad(blurSrc2, vec2i(px, ny), 0) * weights[k + 2];
  }
  textureStore(dst, vec2i(px, py), sum);
}

// ── streak: horizontal smear on the coarsest grid ───────────────────────────

@group(2) @binding(1) var streakSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomStreak(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(streakSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 4 >= w || gy * 4 >= h) { return; }
  let py = gy * 4;
  let px = gx * 4;
  let lenPx = p[12];
  let steps = max(3, min(16, i32(round(lenPx / 6.0))));
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var s = -steps; s <= steps; s = s + 1) {
    let nx = clamp(px + s * 4, 0, w - 1);
    sum += textureLoad(streakSrc, vec2i(nx, py), 0);
    n += 1.0;
  }
  let avg = sum / max(n, 1.0);
  let cur = textureLoad(streakSrc, vec2i(px, py), 0);
  let mix = p[13] * 0.5;
  textureStore(dst, vec2i(px, py), cur + (avg - cur) * mix);
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var g2: texture_2d<f32>;
@group(2) @binding(2) var g4: texture_2d<f32>;
@group(2) @binding(3) var src2: texture_2d<f32>;
@group(2) @binding(4) var samp: sampler;

@compute @workgroup_size(8, 8, 1)
fn bloomComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let fxx = f32(x);
  let fyy = f32(y);
  let u2 = vec2f((fxx * 0.5 + 0.5) / f32(w), (fyy * 0.5 + 0.5) / f32(h));
  let u4 = vec2f((fxx * 0.25 + 0.5) / f32(w), (fyy * 0.25 + 0.5) / f32(h));

  let diffusion = p[4];
  let w2 = 1.0 + 2.0 * diffusion * 0.35;
  let w4 = 1.0 + 1.0 * diffusion * 0.35;
  let glow = (textureSampleLevel(g2, samp, u2, 0.0).rgb * w2 + textureSampleLevel(g4, samp, u4, 0.0).rgb * w4) / (w2 + w4);

  let s = textureLoad(src2, vec2i(x, y), 0);
  let tintMix = p[5];
  var gr = glow.r;
  var gg = glow.g;
  var gb = glow.b;
  if (tintMix > 0.0) {
    gr = gr + (gr * p[6] - gr) * tintMix;
    gg = gg + (gg * p[7] - gg) * tintMix;
    gb = gb + (gb * p[8] - gb) * tintMix;
  }
  let intensity = p[2];
  var outR: f32;
  var outG: f32;
  var outB: f32;
  if (p[9] > 0.5) {
    // add
    outR = clampByte(s.r * 255.0 + gr * 255.0 * intensity);
    outG = clampByte(s.g * 255.0 + gg * 255.0 * intensity);
    outB = clampByte(s.b * 255.0 + gb * 255.0 * intensity);
  } else {
    // screen
    let invR = 255.0 - s.r * 255.0;
    outR = clampByte(255.0 - (invR * (255.0 - gr * 255.0 * intensity)) / 255.0);
    let invG = 255.0 - s.g * 255.0;
    outG = clampByte(255.0 - (invG * (255.0 - gg * 255.0 * intensity)) / 255.0);
    let invB = 255.0 - s.b * 255.0;
    outB = clampByte(255.0 - (invB * (255.0 - gb * 255.0 * intensity)) / 255.0);
  }
  textureStore(dst, vec2i(x, y), vec4f(outR, outG, outB, s.a * 255.0) / 255.0);
}"#;

#[test]
fn effect_kernel_wgsl_compiles() {
    validate(RGBSPLIT_WGSL, "RGBSPLIT_WGSL", true);
    validate(CRT_WGSL, "CRT_WGSL", true);
    validate(LIGHTLEAK_WGSL, "LIGHTLEAK_WGSL", true);
    validate(PALETTESNAP_WGSL, "PALETTESNAP_WGSL", true);
    validate(VHS_WGSL, "VHS_WGSL", true);
    validate(LIGHTSHAFTS_WGSL, "LIGHTSHAFTS_WGSL", true);
    validate(CAUSTICS_WGSL, "CAUSTICS_WGSL", true);
    validate(LENSFLARE_WGSL, "LENSFLARE_WGSL", true);
    validate(BLOOM_WGSL, "BLOOM_WGSL", true);
}
