/**
 * WGSL shaders for solid-fill vector primitives (rect, circle, line).
 */

export const SOLID_VERTEX_WGSL = /* wgsl */ `
struct CameraUniform {
  pan: vec2f,
  zoom: f32,
  viewportW: f32,
  viewportH: f32,
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
  let m = mat2x3f(
    vec3f(input.transform.x, input.transform.y, input.transform.z),
    vec3f(input.transform.w, input.transform2.x, input.transform2.y),
  );
  let world = m * vec3f(input.localPos.x, input.localPos.y, 1.0);
  let screen = vec2f(world.x * camera.zoom + camera.pan.x, world.y * camera.zoom + camera.pan.y);
  let ndcX = (screen.x / camera.viewportW) * 2.0 - 1.0;
  let ndcY = 1.0 - (screen.y / camera.viewportH) * 2.0;
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.color = input.color;
  return out;
}
`;

export const SOLID_FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn fs_main(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

export const CIRCLE_VERTEX_WGSL = SOLID_VERTEX_WGSL;

export const CIRCLE_FRAGMENT_WGSL = /* wgsl */ `
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
`;

/** Fullscreen triangle blit for compositing offscreen Canvas2D overlay onto WebGPU. */
export const BLIT_VERTEX_WGSL = /* wgsl */ `
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
`;

export const BLIT_FRAGMENT_WGSL = /* wgsl */ `
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(tex, samp, uv);
}
`;
