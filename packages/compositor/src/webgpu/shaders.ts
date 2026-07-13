/**
 * WGSL shaders for solid-fill vector primitives (rect, circle, line).
 *
 * Camera-uniform struct matches the JS buffer layout in `backend.ts`:
 *   [pan.x, pan.y, zoom, viewportW, viewportH, rotation, origin.x, origin.y]
 * WGSL alignment: rotation fills the 4-byte slot before origin (vec2f @ 24).
 * Total size = 32 bytes.
 *
 * World→screen matches `@strata/shared` `buildWorldToScreenAffine` /
 * `applyCameraTransform` (floating origin, zoom, rotate about viewport
 * centre, pan). Affine on vertices is kurbo/canvas `a·x+c·y+e` /
 * `b·x+d·y+f` with transform=vec4(a,b,c,d), transform2=vec2(e,f).
 */

export const SOLID_VERTEX_WGSL = /* wgsl */ `
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
  // (kurbo / canvas / @strata/shared affine convention). Scalar form avoids
  // WGSL matCxR*vecC column-count traps — see strata-bridge wgsl_validation.
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

/** Fullscreen triangle blit — retained for naga CI + future GPU overlay compose.
 * Not used by WebGPUBackend after the 2026-07-13 ownership invert (2D present
 * canvas composites non-GPU primitives directly). */
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
