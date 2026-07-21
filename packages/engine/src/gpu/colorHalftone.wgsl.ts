/**
 * WGSL compute shader for Color Halftone effect.
 *
 * Takes a source texture, applies per-channel AM screening at configurable
 * angles, and writes the result to a storage texture.
 *
 * All angles in radians (pre-computed on JS side).
 *
 * Input:   texture_2d<f32> @ group(0) binding(0)
 * Output:  texture_storage_2d<rgba8unorm, write> @ group(0) binding(1)
 * Uniform: @ group(0) binding(2) — flat fields (no alignment padding needed)
 */

export const COLOR_HALFTONE_COMPUTE_WGSL = /* wgsl */ `
struct CHParams {
  screenSize: f32,
  intensity: f32,
  mode: u32,
  dotShape: u32,
  angle0: f32,
  angle1: f32,
  angle2: f32,
  angle3: f32,
  inkR: f32,
  inkG: f32,
  inkB: f32,
  inkA: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var dstTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> p: CHParams;

fn dotDist(dx: f32, dy: f32, shape: u32) -> f32 {
  switch shape {
    case 0u { return sqrt(dx * dx + dy * dy); }
    case 1u { return max(abs(dx), abs(dy)); }
    case 2u { return (abs(dx) + abs(dy)) / 1.414213562; }
    case 3u { return abs(dy); }
    default { return sqrt(dx * dx + dy * dy); }
  }
}

fn screenChan(x: f32, y: f32, tone: f32, angle: f32, cellSize: f32, shape: u32) -> f32 {
  let rx = x * cos(angle) - y * sin(angle);
  let ry = x * sin(angle) + y * cos(angle);
  let wrappedX = fract(rx / cellSize);
  let wrappedY = fract(ry / cellSize);
  let dist = dotDist((wrappedX - 0.5) * 2.0, (wrappedY - 0.5) * 2.0, shape);
  let t = clamp(tone, 0.0, 1.0);
  let radius = sqrt(t);
  let edgeWidth = min(0.15, 1.0 / cellSize);
  return clamp((radius - dist) / edgeWidth + 0.5, 0.0, 1.0);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let w = textureDimensions(srcTex).x;
  let h = textureDimensions(srcTex).y;
  let x = i32(id.x);
  let y = i32(id.y);

  if (x >= i32(w) || y >= i32(h)) { return; }

  let px = textureLoad(srcTex, vec2i(x, y), 0);
  let r = px.r;
  let g = px.g;
  let b = px.b;
  let a = px.a;

  if (a <= 0.0) {
    textureStore(dstTex, vec2i(x, y), vec4f(0.0, 0.0, 0.0, 0.0));
    return;
  }

  let fx = f32(x);
  let fy = f32(y);
  let cellSize = max(2.0, round(72.0 / max(1.0, p.screenSize)));
  let inten = clamp(p.intensity, 0.0, 1.0);

  var nr: f32;
  var ng: f32;
  var nb: f32;

  switch p.mode {
    case 0u { // CMYK
      let c = screenChan(fx, fy, 1.0 - r, p.angle0, cellSize, p.dotShape);
      let m = screenChan(fx, fy, 1.0 - g, p.angle1, cellSize, p.dotShape);
      let yInk = screenChan(fx, fy, 1.0 - b, p.angle2, cellSize, p.dotShape);
      let k = screenChan(fx, fy, 1.0 - (0.299*r + 0.587*g + 0.114*b), p.angle3, cellSize, p.dotShape);
      nr = (1.0 - c) * (1.0 - k);
      ng = (1.0 - m) * (1.0 - k);
      nb = (1.0 - yInk) * (1.0 - k);
    }
    case 1u { // RGB
      nr = screenChan(fx, fy, r, p.angle0, cellSize, p.dotShape);
      ng = screenChan(fx, fy, g, p.angle1, cellSize, p.dotShape);
      nb = screenChan(fx, fy, b, p.angle2, cellSize, p.dotShape);
    }
    default { // Mono (mode 2)
      let lum = 0.299*r + 0.587*g + 0.114*b;
      let coverage = screenChan(fx, fy, lum, p.angle0, cellSize, p.dotShape);
      nr = p.inkR * coverage + r * (1.0 - coverage);
      ng = p.inkG * coverage + g * (1.0 - coverage);
      nb = p.inkB * coverage + b * (1.0 - coverage);
    }
  }

  let outR = r + (nr - r) * inten;
  let outG = g + (ng - g) * inten;
  let outB = b + (nb - b) * inten;

  textureStore(dstTex, vec2i(x, y), vec4f(outR, outG, outB, a));
}
`;
