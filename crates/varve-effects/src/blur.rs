//! Gaussian blur in linear light — faithful port of
//! `packages/engine/src/blur.ts` (`gaussianBlurLinearLight` +
//! `gaussianBlurSeparable`). Used by the bloom kernel.

use crate::{clamp_byte, js_round, prng::srgb_to_linear};

fn clamp_edge(x: i64, size: i64) -> i64 {
    if x < 0 {
        0
    } else if x >= size {
        size - 1
    } else {
        x
    }
}

/// Gaussian kernel weights for a radius — port of `gaussianKernel`.
pub fn gaussian_kernel(radius: i64) -> Vec<f64> {
    if radius == 0 {
        return vec![1.0];
    }
    let sigma = radius as f64 / 3.0;
    let size = (2 * radius + 1) as usize;
    let mut kernel = vec![0.0f64; size];
    let mut sum = 0.0;
    for i in 0..size {
        let x = i as f64 - radius as f64;
        let v = (-(x * x) / (2.0 * sigma * sigma)).exp();
        kernel[i] = v;
        sum += v;
    }
    let inv_sum = 1.0 / sum;
    for k in kernel.iter_mut() {
        *k *= inv_sum;
    }
    kernel
}

fn premultiply(data: &mut [u8]) {
    for i in (0..data.len()).step_by(4) {
        let a = data[i + 3];
        if a == 255 {
            continue;
        }
        if a == 0 {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            continue;
        }
        data[i] = clamp_byte((data[i] as f64 * a as f64) / 255.0);
        data[i + 1] = clamp_byte((data[i + 1] as f64 * a as f64) / 255.0);
        data[i + 2] = clamp_byte((data[i + 2] as f64 * a as f64) / 255.0);
    }
}

fn unpremultiply(data: &mut [u8]) {
    for i in (0..data.len()).step_by(4) {
        let a = data[i + 3];
        if a == 0 || a == 255 {
            continue;
        }
        let inv = 255.0 / a as f64;
        data[i] = clamp_byte(data[i] as f64 * inv);
        data[i + 1] = clamp_byte(data[i + 1] as f64 * inv);
        data[i + 2] = clamp_byte(data[i + 2] as f64 * inv);
    }
}

/// Convolve with a 1D kernel in one direction — port of `convolve1D`.
#[allow(clippy::too_many_arguments)]
fn convolve1d(
    src: &[u8],
    dst: &mut [u8],
    w: u32,
    h: u32,
    kernel: &[f64],
    horizontal: bool,
) {
    let radius = (kernel.len() as i64 - 1) / 2;
    let w = w as i64;
    let h = h as i64;
    if horizontal {
        for y in 0..h {
            for x in 0..w {
                let mut r = 0.0f64;
                let mut g = 0.0f64;
                let mut b = 0.0f64;
                let mut a = 0.0f64;
                for (k, kw) in kernel.iter().enumerate() {
                    let sx = clamp_edge(x + k as i64 - radius, w);
                    let idx = ((y * w + sx) * 4) as usize;
                    r += src[idx] as f64 * kw;
                    g += src[idx + 1] as f64 * kw;
                    b += src[idx + 2] as f64 * kw;
                    a += src[idx + 3] as f64 * kw;
                }
                let idx = ((y * w + x) * 4) as usize;
                dst[idx] = clamp_byte(r);
                dst[idx + 1] = clamp_byte(g);
                dst[idx + 2] = clamp_byte(b);
                dst[idx + 3] = clamp_byte(a);
            }
        }
    } else {
        for x in 0..w {
            for y in 0..h {
                let mut r = 0.0f64;
                let mut g = 0.0f64;
                let mut b = 0.0f64;
                let mut a = 0.0f64;
                for (k, kw) in kernel.iter().enumerate() {
                    let sy = clamp_edge(y + k as i64 - radius, h);
                    let idx = ((sy * w + x) * 4) as usize;
                    r += src[idx] as f64 * kw;
                    g += src[idx + 1] as f64 * kw;
                    b += src[idx + 2] as f64 * kw;
                    a += src[idx + 3] as f64 * kw;
                }
                let idx = ((y * w + x) * 4) as usize;
                dst[idx] = clamp_byte(r);
                dst[idx + 1] = clamp_byte(g);
                dst[idx + 2] = clamp_byte(b);
                dst[idx + 3] = clamp_byte(a);
            }
        }
    }
}

/// Separable gaussian blur — port of `gaussianBlurSeparable`.
pub fn gaussian_blur_separable(data: &[u8], w: u32, h: u32, radius: i64) -> Vec<u8> {
    let pixels_len = (w * h * 4) as usize;
    if radius <= 0 {
        return data.to_vec();
    }
    if radius > 100 {
        let factor = ((radius as f64 / 100.0).ceil() as i64).min(4);
        let small_w = ((w as f64 / factor as f64).round()) as u32;
        let small_h = ((h as f64 / factor as f64).round()) as u32;
        let small_radius = ((radius as f64 / factor as f64).round()).max(1.0) as i64;

        let mut small_data = downsample_nearest(data, w, h, small_w, small_h);
        let kernel = gaussian_kernel(small_radius);
        premultiply(&mut small_data);
        let mut tmp = vec![0u8; small_data.len()];
        convolve1d(&small_data, &mut tmp, small_w, small_h, &kernel, true);
        convolve1d(&tmp, &mut small_data, small_w, small_h, &kernel, false);
        unpremultiply(&mut small_data);
        return upsample_nearest(&small_data, small_w, small_h, w, h);
    }

    let mut pixels = data.to_vec();
    premultiply(&mut pixels);
    let kernel = gaussian_kernel(radius);
    let mut tmp = vec![0u8; pixels_len];
    convolve1d(&pixels, &mut tmp, w, h, &kernel, true);
    convolve1d(&tmp, &mut pixels, w, h, &kernel, false);
    unpremultiply(&mut pixels);
    pixels
}

/// Nearest-neighbour downsample — port of `downsample` in blur.ts.
fn downsample_nearest(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let mut dst = vec![0u8; (dst_w * dst_h * 4) as usize];
    for y in 0..dst_h {
        for x in 0..dst_w {
            let sx = (x as f64 * src_w as f64 / dst_w as f64).floor() as u32;
            let sy = (y as f64 * src_h as f64 / dst_h as f64).floor() as u32;
            let ix = sx.min(src_w - 1);
            let iy = sy.min(src_h - 1);
            let src_idx = ((iy * src_w + ix) * 4) as usize;
            let dst_idx = ((y * dst_w + x) * 4) as usize;
            dst[dst_idx] = src[src_idx];
            dst[dst_idx + 1] = src[src_idx + 1];
            dst[dst_idx + 2] = src[src_idx + 2];
            dst[dst_idx + 3] = src[src_idx + 3];
        }
    }
    dst
}

/// Nearest-neighbour upsample — port of `upsample` in blur.ts.
fn upsample_nearest(src: &[u8], src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> Vec<u8> {
    let mut dst = vec![0u8; (dst_w * dst_h * 4) as usize];
    for y in 0..dst_h {
        for x in 0..dst_w {
            let sx = (x as f64 * src_w as f64 / dst_w as f64).floor() as u32;
            let sy = (y as f64 * src_h as f64 / dst_h as f64).floor() as u32;
            let ix = sx.min(src_w - 1);
            let iy = sy.min(src_h - 1);
            let src_idx = ((iy * src_w + ix) * 4) as usize;
            let dst_idx = ((y * dst_w + x) * 4) as usize;
            dst[dst_idx] = src[src_idx];
            dst[dst_idx + 1] = src[src_idx + 1];
            dst[dst_idx + 2] = src[src_idx + 2];
            dst[dst_idx + 3] = src[src_idx + 3];
        }
    }
    dst
}

/// Gaussian blur in linear light — port of `gaussianBlurLinearLight` in
/// blur.ts. Returns a new buffer; input untouched.
pub fn gaussian_blur_linear_light(data: &[u8], w: u32, h: u32, radius: i64) -> Vec<u8> {
    if radius <= 0 {
        return data.to_vec();
    }
    let mut pixels = data.to_vec();
    // Convert to linear light: srgbToLinear on each RGB channel, stored back
    // as bytes (clamped) — matches the TS `clampByte(srgbToLinear(r) * 255)`.
    for i in (0..pixels.len()).step_by(4) {
        let r = pixels[i] as f64;
        let g = pixels[i + 1] as f64;
        let b = pixels[i + 2] as f64;
        pixels[i] = clamp_byte(srgb_to_linear(r) * 255.0);
        pixels[i + 1] = clamp_byte(srgb_to_linear(g) * 255.0);
        pixels[i + 2] = clamp_byte(srgb_to_linear(b) * 255.0);
    }

    let blurred = gaussian_blur_separable(&pixels, w, h, radius);

    // Convert back to sRGB.
    let mut out = blurred;
    for i in (0..out.len()).step_by(4) {
        let r = out[i] as f64 / 255.0;
        let g = out[i + 1] as f64 / 255.0;
        let b = out[i + 2] as f64 / 255.0;
        out[i] = js_round(srgb_to_linear_out(r)) as u8;
        out[i + 1] = js_round(srgb_to_linear_out(g)) as u8;
        out[i + 2] = js_round(srgb_to_linear_out(b)) as u8;
    }
    out
}

/// Linear → sRGB byte (clamped) — matches `linearToSrgb` from @varve/shared
/// used by the TS blur. Returns the pre-round value for js_round.
fn srgb_to_linear_out(linear: f64) -> f64 {
    let v = if linear <= 0.0031308 {
        linear * 12.92
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    };
    v * 255.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_sums_to_one() {
        for radius in [1, 2, 4, 10] {
            let k = gaussian_kernel(radius);
            let sum: f64 = k.iter().sum();
            assert!((sum - 1.0).abs() < 1e-9, "radius {radius}: {sum}");
        }
    }

    #[test]
    fn blur_preserves_dimensions() {
        let data = vec![200u8; 8 * 6 * 4];
        let out = gaussian_blur_linear_light(&data, 8, 6, 3);
        assert_eq!(out.len(), 8 * 6 * 4);
    }
}
