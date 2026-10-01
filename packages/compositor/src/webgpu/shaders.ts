/**
 * WGSL shaders for solid-fill vector primitives (rect, circle, line).
 *
 * Camera-uniform struct matches the JS buffer layout in `backend.ts`:
 *   [pan.x, pan.y, zoom, viewportW, viewportH, rotation, origin.x, origin.y]
 * WGSL alignment: rotation fills the 4-byte slot before origin (vec2f @ 24).
 * Total size = 32 bytes.
 *
 * World→screen matches `@varve/shared` `buildWorldToScreenAffine` /
 * `applyCameraTransform` (floating origin, zoom, rotate about viewport
 * centre, pan). Affine on vertices is kurbo/canvas `a·x+c·y+e` /
 * `b·x+d·y+f` with transform=vec4(a,b,c,d), transform2=vec2(e,f).
 *
 * Both stages antialias analytically: the fragment derives ~1 device-pixel
 * edge coverage from fwidth, and the vertex expands its quad ~1 px outward
 * so the outside half of the band has geometry. The solid stage receives its
 * geometry as unit-quad local coordinates (the CPU folds the authored rect
 * or line parallelogram into the item affine) because unit-square distance is
 * the only per-fragment edge metric available without extra attributes.
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
  @location(1) local: vec2f,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  // Affine: transform=vec4(a,b,c,d), transform2=vec2(e,f) → x'=a·x+c·y+e, y'=b·x+d·y+f
  // (kurbo / canvas / @varve/shared affine convention). Scalar form avoids
  // WGSL matCxR*vecC column-count traps — see varve-bridge wgsl_validation.
  //
  // localPos is the unit quad (0..1)² — the CPU folds the authored rect (or
  // line parallelogram) into the item affine. Expand the quad ~1 device
  // pixel outward so the analytic edge-coverage band has geometry on the
  // outside of the boundary; the fragment stage clamps coverage to zero
  // beyond it. Screen scale per local axis = camera zoom times the affine
  // column length (camera rotation preserves length).
  let scaleX = camera.zoom * sqrt(input.transform.x * input.transform.x + input.transform.y * input.transform.y);
  let scaleY = camera.zoom * sqrt(input.transform.z * input.transform.z + input.transform.w * input.transform.w);
  let marginX = 1.0 / max(scaleX, 1e-6);
  let marginY = 1.0 / max(scaleY, 1e-6);
  let local = vec2f(
    select(input.localPos.x - marginX, input.localPos.x + marginX, input.localPos.x > 0.5),
    select(input.localPos.y - marginY, input.localPos.y + marginY, input.localPos.y > 0.5),
  );
  let world = vec2f(
    input.transform.x * local.x + input.transform.z * local.y + input.transform2.x,
    input.transform.y * local.x + input.transform.w * local.y + input.transform2.y,
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
  out.local = local;
  return out;
}
`;

export const SOLID_FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn fs_main(
  @location(0) color: vec4f,
  @location(1) local: vec2f,
) -> @location(0) vec4f {
  // Analytic edge coverage against the unit quad. s is the distance to the
  // nearest edge in local units; fwidth(s) converts it to per-pixel change,
  // so s / aa + 0.5 spans about one device pixel across the boundary —
  // matching Canvas2D's antialiased edge instead of a hard staircase. The
  // vertex stage expands the quad ~1 px outward so the outside half of the
  // band has geometry; beyond it coverage clamps to 0 and the premultiplied
  // blend adds nothing. Aligned edges keep full coverage (fragment centers
  // sit >= 0.5 px inside), so pixel-aligned rects stay crisp.
  let s = min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y));
  let aa = max(fwidth(s), 1e-9);
  let coverage = clamp(s / aa + 0.5, 0.0, 1.0);
  return vec4f(color.rgb * coverage, color.a * coverage);
}
`;

/**
 * Oval vertex stage: same camera/affine math as `SOLID_VERTEX_WGSL` plus the
 * object-local position and the per-vertex oval parameters as varyings. The
 * fragment coverage test must run in local space: a screen-space
 * `distance(pos, center) > r` test is only correct when the composed
 * transform is conformal (uniform scale + rotation). A non-uniform item scale
 * or a skew maps the local oval to a differently-proportioned ellipse, and
 * the screen-space test would then clip it back to a circle of radius `r`.
 * `circle` carries (cx, cy, rx, ry); a circle is the rx == ry case, so both
 * primitive kinds share this stage. The quad is expanded ~1 px outward before
 * rasterization so the fragment's analytic edge-coverage band has geometry on
 * the outside of the oval boundary.
 */
export const CIRCLE_VERTEX_WGSL = /* wgsl */ `
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
  @location(4) circle: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) local: vec2f,
  @location(2) circle: vec4f,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  // Expand the bounding quad ~1 device pixel outward (screen scale = camera
  // zoom times the affine column length; rotation preserves length) so the
  // fragment's analytic edge-coverage band has geometry outside the oval
  // boundary. Coverage clamps to zero beyond the band.
  let scaleX = camera.zoom * sqrt(input.transform.x * input.transform.x + input.transform.y * input.transform.y);
  let scaleY = camera.zoom * sqrt(input.transform.z * input.transform.z + input.transform.w * input.transform.w);
  let marginX = 1.0 / max(scaleX, 1e-6);
  let marginY = 1.0 / max(scaleY, 1e-6);
  let local = vec2f(
    input.localPos.x + sign(input.localPos.x - input.circle.x) * marginX,
    input.localPos.y + sign(input.localPos.y - input.circle.y) * marginY,
  );
  let world = vec2f(
    input.transform.x * local.x + input.transform.z * local.y + input.transform2.x,
    input.transform.y * local.x + input.transform.w * local.y + input.transform2.y,
  );
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
  out.color = vec4f(input.color.rgb * input.color.a, input.color.a);
  out.local = local;
  out.circle = input.circle;
  return out;
}
`;

export const CIRCLE_FRAGMENT_WGSL = /* wgsl */ `
@fragment
fn fs_main(
  @location(0) color: vec4f,
  @location(1) local: vec2f,
  @location(2) circle: vec4f,
) -> @location(0) vec4f {
  // Local-space normalized radial distance: exact for every affine item
  // transform and for both radii (a circle is the rx == ry case). Radii are
  // clamped away from zero so a degenerate oval evaluates to a huge q instead
  // of NaN derivatives.
  let radii = max(circle.zw, vec2f(1e-6));
  let q = length((local - circle.xy) / radii);
  // Analytic edge coverage: fwidth(q) is the per-pixel change of the
  // normalized radius (1 / radius-in-pixels at the boundary), so
  // (1 - q) / aa + 0.5 spans about one device pixel across the edge —
  // matching Canvas2D's antialiasing instead of the previous hard discard.
  // The vertex stage expands the quad ~1 px outward so the outside half of
  // the band has geometry; beyond it coverage clamps to 0 and the
  // premultiplied blend adds nothing.
  let aa = max(fwidth(q), 1e-9);
  let coverage = clamp((1.0 - q) / aa + 0.5, 0.0, 1.0);
  return vec4f(color.rgb * coverage, color.a * coverage);
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
