// GPU port of the RGB split / chromatic-aberration kernel in
// crates/varve-effects/src/rgb_split.rs. Algorithm, border policies, and
// premultiply/unpremultiply ordering are intentionally identical; only the
// arithmetic width differs (f32 here, f64 on the CPU), so parity is verified
// with tolerances in effects.rs.
//
// Uniform layout (array<vec4<f32>, 5>):
//   p[0] = (width, height, mode, border)
//   p[1] = (redX, redY, 0, 0)
//   p[2] = (greenX, greenY, 0, 0)
//   p[3] = (blueX, blueY, amount, falloff)
//   p[4] = (angleRadians, centerX, centerY, maxRadius)

@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> params: array<vec4<f32>, 5>;

fn clampByte(v: f32) -> f32 {
  if (v <= 0.0) {
    return 0.0;
  }
  if (v >= 255.0) {
    return 255.0;
  }
  return floor(v + 0.5);
}

fn byteAt(packed: u32, channel: u32) -> f32 {
  return f32((packed >> (channel * 8u)) & 255u);
}

fn euclid(a: i32, m: i32) -> i32 {
  return ((a % m) + m) % m;
}

fn fetchRaw(x0: i32, y0: i32, w: i32, h: i32, border: u32) -> u32 {
  var ix = x0;
  var iy = y0;
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) {
    if (border == 0u) {
      return 0u;
    }
    if (border == 1u) {
      ix = clamp(ix, 0, w - 1);
      iy = clamp(iy, 0, h - 1);
    } else if (border == 2u) {
      ix = euclid(ix, w);
      iy = euclid(iy, h);
    } else {
      let periodX = 2 * w;
      ix = euclid(ix, periodX);
      if (ix >= w) {
        ix = periodX - ix - 1;
      }
      let periodY = 2 * h;
      iy = euclid(iy, periodY);
      if (iy >= h) {
        iy = periodY - iy - 1;
      }
    }
  }
  return src[iy * w + ix];
}

// Premultiplied channel sample; transparent taps premultiply to zero exactly
// like the CPU premultiply pass.
fn samplePremul(x0: i32, y0: i32, channel: u32, w: i32, h: i32, border: u32) -> f32 {
  let packed = fetchRaw(x0, y0, w, h, border);
  let alpha = byteAt(packed, 3u);
  let value = byteAt(packed, channel);
  return clampByte(value * alpha / 255.0);
}

fn interpolatePremul(sx: f32, sy: f32, channel: u32, w: i32, h: i32, border: u32) -> f32 {
  let x0 = floor(sx);
  let y0 = floor(sy);
  let fracX = sx - x0;
  let fracY = sy - y0;
  let xi = i32(x0);
  let yi = i32(y0);
  let a = samplePremul(xi, yi, channel, w, h, border);
  let b = samplePremul(xi + 1, yi, channel, w, h, border);
  let d = samplePremul(xi, yi + 1, channel, w, h, border);
  let e = samplePremul(xi + 1, yi + 1, channel, w, h, border);
  return clampByte(a + (b - a) * fracX + (d - a) * fracY + (a - b - d + e) * fracX * fracY);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let w = i32(params[0].x);
  let h = i32(params[0].y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) {
    return;
  }
  let mode = params[0].z;
  let border = u32(params[0].w);
  let packed = src[y * w + x];
  let alpha = byteAt(packed, 3u);

  var redX = params[1].x;
  var redY = params[1].y;
  var greenX = params[2].x;
  var greenY = params[2].y;
  var blueX = params[3].x;
  var blueY = params[3].y;

  if (mode > 0.5) {
    let amount = params[3].z;
    let falloff = params[3].w;
    let angle = params[4].x;
    let centerX = params[4].y;
    let centerY = params[4].z;
    let maxRadius = params[4].w;
    let radius = sqrt((f32(x) - centerX) * (f32(x) - centerX) + (f32(y) - centerY) * (f32(y) - centerY)) / maxRadius;
    let t = pow(max(radius, 0.0), falloff) * amount;
    redX = t * cos(angle);
    redY = t * sin(angle);
    greenX = 0.0;
    greenY = 0.0;
    blueX = -redX;
    blueY = -redY;
  }

  let fx = f32(x);
  let fy = f32(y);
  var r = interpolatePremul(fx + redX, fy + redY, 0u, w, h, border);
  var g = interpolatePremul(fx + greenX, fy + greenY, 1u, w, h, border);
  var b = interpolatePremul(fx + blueX, fy + blueY, 2u, w, h, border);

  if (alpha > 0.0 && alpha < 255.0) {
    let inv = 255.0 / alpha;
    r = clampByte(r * inv);
    g = clampByte(g * inv);
    b = clampByte(b * inv);
  }

  dst[y * w + x] = u32(r) | (u32(g) << 8u) | (u32(b) << 16u) | (u32(alpha) << 24u);
}
