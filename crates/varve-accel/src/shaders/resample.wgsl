// GPU port of image-rs `imageops::resize` separable resampling used by
// crates/varve-upscale (see image 0.25 `imageops/sample.rs`). The kernel
// functions, window bounds, weight normalization, and half-away-from-zero
// rounding are intentionally identical; accumulation is fused (one pass)
// instead of image-rs's vertical-then-horizontal passes, so results are
// verified with tolerances in effects.rs.
//
// Uniform layout (array<vec4<f32>, 3>):
//   p[0] = (srcWidth, srcHeight, dstWidth, dstHeight)
//   p[1] = (kind, ratioX, ratioY, invSratioX)
//   p[2] = (invSratioY, 0, 0, 0)
// kind: 0 nearest, 1 triangle, 2 catmullRom, 3 lanczos3.
// Ratios and reciprocals are precomputed on the host because GPU float
// division is not guaranteed correctly rounded, and one-ulp differences at
// pixel-centre boundaries flip nearest/bilinear taps versus image-rs.

@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> params: array<vec4<f32>, 3>;

const PI: f32 = 3.141592653589793;

fn clampByte(v: f32) -> f32 {
  if (v <= 0.0) {
    return 0.0;
  }
  if (v >= 255.0) {
    return 255.0;
  }
  return floor(v + 0.5);
}

fn sinc(t: f32) -> f32 {
  if (abs(t) < 1e-9) {
    return 1.0;
  }
  let a = t * PI;
  return sin(a) / a;
}

fn lanczos3Kernel(x: f32) -> f32 {
  if (abs(x) < 3.0) {
    return sinc(x) * sinc(x / 3.0);
  }
  return 0.0;
}

fn bcCubicSpline(x: f32, b: f32, c: f32) -> f32 {
  let a = abs(x);
  var k = 0.0;
  if (a < 1.0) {
    k = (12.0 - 9.0 * b - 6.0 * c) * a * a * a
      + (-18.0 + 12.0 * b + 6.0 * c) * a * a
      + (6.0 - 2.0 * b);
  } else if (a < 2.0) {
    k = (-b - 6.0 * c) * a * a * a
      + (6.0 * b + 30.0 * c) * a * a
      + (-12.0 * b - 48.0 * c) * a
      + (8.0 * b + 24.0 * c);
  }
  return k / 6.0;
}

fn triangleKernel(x: f32) -> f32 {
  if (abs(x) < 1.0) {
    return 1.0 - abs(x);
  }
  return 0.0;
}

fn kernel(x: f32, kind: u32) -> f32 {
  switch kind {
    case 1u: {
      return triangleKernel(x);
    }
    case 2u: {
      return bcCubicSpline(x, 0.0, 0.5);
    }
    case 3u: {
      return lanczos3Kernel(x);
    }
    default: {
      return 1.0;
    }
  }
}

fn supportOf(kind: u32) -> f32 {
  switch kind {
    case 1u: {
      return 1.0;
    }
    case 2u: {
      return 2.0;
    }
    case 3u: {
      return 3.0;
    }
    default: {
      return 0.0;
    }
  }
}

fn axisWindow(
  outIndex: i32,
  ratio: f32,
  srcSupport: f32,
  sourceLength: i32,
) -> vec2i {
  let inputPos = (f32(outIndex) + 0.5) * ratio;
  let leftRaw = i32(floor(inputPos - srcSupport));
  let left = clamp(leftRaw, 0, sourceLength - 1);
  let rightRaw = i32(ceil(inputPos + srcSupport));
  let right = clamp(rightRaw, left + 1, sourceLength);
  return vec2i(left, right);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let srcW = i32(params[0].x);
  let srcH = i32(params[0].y);
  let dstW = i32(params[0].z);
  let dstH = i32(params[0].w);
  let kind = u32(params[1].x);
  let ratioX = params[1].y;
  let ratioY = params[1].z;
  let invSratioX = params[1].w;
  let invSratioY = params[2].x;
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= dstW || y >= dstH) {
    return;
  }

  let support = supportOf(kind);
  let supportX = support * max(1.0, ratioX);
  let supportY = support * max(1.0, ratioY);

  let windowX = axisWindow(x, ratioX, supportX, srcW);
  let windowY = axisWindow(y, ratioY, supportY, srcH);
  let centerX = (f32(x) + 0.5) * ratioX - 0.5;
  let centerY = (f32(y) + 0.5) * ratioY - 0.5;

  var sumX = 0.0;
  var sumY = 0.0;
  var ix = windowX.x;
  loop {
    if (ix >= windowX.y) {
      break;
    }
    sumX = sumX + kernel((f32(ix) - centerX) * invSratioX, kind);
    ix = ix + 1;
  }
  var iy = windowY.x;
  loop {
    if (iy >= windowY.y) {
      break;
    }
    sumY = sumY + kernel((f32(iy) - centerY) * invSratioY, kind);
    iy = iy + 1;
  }
  let safeSumX = select(sumX, 1.0, abs(sumX) < 1e-12);
  let safeSumY = select(sumY, 1.0, abs(sumY) < 1e-12);

  var acc = vec4<f32>(0.0);
  iy = windowY.x;
  loop {
    if (iy >= windowY.y) {
      break;
    }
    let wy = kernel((f32(iy) - centerY) * invSratioY, kind) / safeSumY;
    var row = vec4<f32>(0.0);
    ix = windowX.x;
    loop {
      if (ix >= windowX.y) {
        break;
      }
      let wx = kernel((f32(ix) - centerX) * invSratioX, kind) / safeSumX;
      row = row + unpack4x8unorm(src[iy * srcW + ix]) * (wx * 255.0);
      ix = ix + 1;
    }
    acc = acc + row * wy;
    iy = iy + 1;
  }

  dst[y * dstW + x] = u32(clampByte(acc.x))
    | (u32(clampByte(acc.y)) << 8u)
    | (u32(clampByte(acc.z)) << 16u)
    | (u32(clampByte(acc.w)) << 24u);
}
